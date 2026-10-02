import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  BoardResponse,
  type BoardCard,
  type Database,
  type GroupSuggestion,
  type ReactionSummary,
  type RetroPhase,
  type VisibleBoardCard,
  type VotingProgress,
} from '@retronoodle/shared';
import { can } from '../auth/can.js';
import { getTeamRole } from '../auth/membership.js';
import { redactCard } from '../realtime/redact.js';

export interface BoardRoutesDeps {
  supabaseAdmin: SupabaseClient<Database>;
  requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

/** GET /retros/:id/board (RN-009): the initial snapshot plus its seq; the client applies any
 * events broadcast after that seq on top (RN-008's retroStore), rather than re-fetching. Each
 * card is passed through redact() (RN-011) for the requesting viewer before going out. */
export function registerBoardRoutes(app: FastifyInstance, deps: BoardRoutesDeps): void {
  const { supabaseAdmin, requireAuth } = deps;

  app.get<{ Params: { id: string } }>('/retros/:id/board', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.user;
    if (!user) return reply.code(401).send({ error: 'unauthorized' });

    const retroId = request.params.id;
    const { data: retro, error: retroError } = await supabaseAdmin
      .from('retros')
      .select()
      .eq('id', retroId)
      .maybeSingle();
    if (retroError) {
      request.log.error({ err: retroError }, 'failed to read retro for board');
      return reply.code(500).send({ error: 'board_read_failed' });
    }
    if (!retro) return reply.code(404).send({ error: 'not_found' });

    const role = await getTeamRole(supabaseAdmin, retro.team_id, user.id);
    if (!can(user, 'retro.read', { type: 'retro', teamRole: role, facilitatorId: retro.facilitator_id })) {
      return reply.code(403).send({ error: 'forbidden' });
    }

    const [columnsResult, cardsResult, topicsResult, lastEventResult] = await Promise.all([
      supabaseAdmin.from('retro_columns').select().eq('retro_id', retroId).order('position'),
      supabaseAdmin.from('cards').select().eq('retro_id', retroId),
      supabaseAdmin.from('topics').select().eq('retro_id', retroId),
      supabaseAdmin.from('retro_events').select('seq').eq('retro_id', retroId).order('seq', { ascending: false }).limit(1).maybeSingle(),
    ]);

    if (columnsResult.error || cardsResult.error || topicsResult.error || lastEventResult.error) {
      request.log.error(
        { columns: columnsResult.error, cards: cardsResult.error, topics: topicsResult.error, event: lastEventResult.error },
        'failed to read board data',
      );
      return reply.code(500).send({ error: 'board_read_failed' });
    }

    const cards = cardsResult.data ?? [];
    const authorIds = [...new Set(cards.map((c) => c.author_id))];
    const authorNameById = new Map<string, string>();
    if (authorIds.length > 0) {
      const { data: authors, error: authorsError } = await supabaseAdmin
        .from('profiles')
        .select('id, display_name')
        .in('id', authorIds);
      if (authorsError) {
        request.log.error({ err: authorsError }, 'failed to read card authors');
        return reply.code(500).send({ error: 'board_read_failed' });
      }
      for (const author of authors ?? []) authorNameById.set(author.id, author.display_name);
    }

    // RN-016: card_reactions has no retro_id of its own, so this depends on the card id list
    // above rather than joining alongside the other tables in the Promise.all. Skipped entirely
    // for an empty board.
    const cardIds = cards.map((c) => c.id);
    const reactionsByCard = new Map<string, Map<string, string[]>>();
    if (cardIds.length > 0) {
      const { data: reactionRows, error: reactionsError } = await supabaseAdmin
        .from('card_reactions')
        .select('card_id, user_id, emoji')
        .in('card_id', cardIds);
      if (reactionsError) {
        request.log.error({ err: reactionsError }, 'failed to read card reactions');
        return reply.code(500).send({ error: 'board_read_failed' });
      }
      for (const row of reactionRows ?? []) {
        const byEmoji = reactionsByCard.get(row.card_id) ?? new Map<string, string[]>();
        byEmoji.set(row.emoji, [...(byEmoji.get(row.emoji) ?? []), row.user_id]);
        reactionsByCard.set(row.card_id, byEmoji);
      }
    }
    // card_reactions.emoji is a plain `text` column, not the Emoji enum — BoardResponse.parse()
    // below is what actually validates every value is in the quick-set; this cast just keeps the
    // object-literal construction honest about the shape it intends to produce.
    function reactionsFor(cardId: string): ReactionSummary[] {
      const byEmoji = reactionsByCard.get(cardId);
      return byEmoji ? ([...byEmoji.entries()].map(([emoji, userIds]) => ({ emoji, userIds })) as ReactionSummary[]) : [];
    }

    // RN-017: "Participants who aren't the facilitator never receive suggestions" — true for the
    // initial snapshot here, not just the realtime broadcast (worker side, user:{id} only).
    // columnId isn't stored on group_suggestions itself (every member card already has one, and
    // the mutation that created the row already guaranteed they all agree) — derived here from
    // the cards already fetched above rather than a second join.
    let suggestions: GroupSuggestion[] | null = null;
    if (user.id === retro.facilitator_id) {
      const { data: pending, error: suggestionsError } = await supabaseAdmin
        .from('group_suggestions')
        .select('id, name, card_ids')
        .eq('retro_id', retroId)
        .eq('status', 'pending');
      if (suggestionsError) {
        request.log.error({ err: suggestionsError }, 'failed to read group suggestions');
        return reply.code(500).send({ error: 'board_read_failed' });
      }
      const cardColumnById = new Map(cards.map((c) => [c.id, c.column_id]));
      suggestions = (pending ?? [])
        .map((s): GroupSuggestion | null => {
          const columnId = cardColumnById.get(s.card_ids[0] ?? '');
          return columnId ? { id: s.id, name: s.name, columnId, cardIds: s.card_ids } : null;
        })
        .filter((s): s is GroupSuggestion => s !== null);
    }

    // RN-018: the viewer's own dot counts — "Hidden card text and votes never leave the server"
    // applies to votes too, so this is always scoped to `user.id`, never any other participant's.
    const { data: myVoteRows, error: myVotesError } = await supabaseAdmin
      .from('votes')
      .select('topic_id')
      .eq('retro_id', retroId)
      .eq('user_id', user.id);
    if (myVotesError) {
      request.log.error({ err: myVotesError }, 'failed to read own votes');
      return reply.code(500).send({ error: 'board_read_failed' });
    }
    const myVotesByTopic = new Map<string, number>();
    for (const row of myVoteRows ?? []) myVotesByTopic.set(row.topic_id, (myVotesByTopic.get(row.topic_id) ?? 0) + 1);
    const myVotes = [...myVotesByTopic.entries()].map(([topicId, count]) => ({ topicId, count }));

    // RN-018: "5 of 8 done voting" — the only cross-participant voting info anyone but the
    // facilitator-equivalent (nobody, here — every participant sees this) ever gets; only
    // meaningful while Vote is in progress, so null everywhere else. Deliberately not shared
    // with voteAdd.ts/voteRemove.ts's own computeVotingProgress (mutations/voteHelpers.ts) —
    // those run over the raw `pg` pool inside a locked transaction, this runs over
    // supabase-js/PostgREST outside one, so the two have nothing to usefully share.
    let votingProgress: VotingProgress | null = null;
    if (retro.phase === 'vote') {
      const [{ data: participantRows, error: participantsError }, { data: voteRows, error: votesError }] = await Promise.all([
        supabaseAdmin.from('retro_participants').select('user_id').eq('retro_id', retroId),
        supabaseAdmin.from('votes').select('user_id').eq('retro_id', retroId),
      ]);
      if (participantsError || votesError) {
        request.log.error({ participants: participantsError, votes: votesError }, 'failed to read voting progress');
        return reply.code(500).send({ error: 'board_read_failed' });
      }
      const countByUser = new Map<string, number>();
      for (const row of voteRows ?? []) countByUser.set(row.user_id, (countByUser.get(row.user_id) ?? 0) + 1);
      const done = [...countByUser.values()].filter((count) => count >= retro.vote_budget).length;
      votingProgress = { done, total: (participantRows ?? []).length };
    }

    const redactCtx = { viewerId: user.id, phase: retro.phase as RetroPhase, cardsRevealed: retro.cards_revealed };

    return BoardResponse.parse({
      retro: {
        id: retro.id,
        teamId: retro.team_id,
        name: retro.name,
        phase: retro.phase,
        facilitatorId: retro.facilitator_id,
        templateId: retro.template_id,
        templateSource: retro.template_source,
        cardsRevealed: retro.cards_revealed,
        phaseDeadline: retro.phase_deadline,
        voteBudget: retro.vote_budget,
      },
      columns: (columnsResult.data ?? []).map((c) => ({
        id: c.id,
        title: c.title,
        prompt: c.prompt,
        color: c.color,
        kind: c.kind,
        position: c.position,
      })),
      cards: cards.map((c): BoardCard => {
        const full: VisibleBoardCard = {
          id: c.id,
          columnId: c.column_id,
          authorId: c.author_id,
          authorName: authorNameById.get(c.author_id) ?? 'Unknown',
          body: c.body,
          position: c.position,
          createdAt: c.created_at,
          updatedAt: c.updated_at,
          topicId: c.topic_id,
          reactions: reactionsFor(c.id),
          hidden: false,
        };
        return redactCard(full, redactCtx);
      }),
      topics: (topicsResult.data ?? []).map((t) => ({ id: t.id, columnId: t.column_id, name: t.name, voteCount: t.vote_count })),
      suggestions,
      myVotes,
      votingProgress,
      seq: lastEventResult.data?.seq ?? 0,
      // RN-012: this specific response is what a late joiner's clock-offset calculation anchors
      // to, so it's set explicitly here rather than relying solely on the global serverTime hook
      // (server.ts) — that hook still covers every other response, this one just can't risk it.
      serverTime: new Date().toISOString(),
    });
  });
}
