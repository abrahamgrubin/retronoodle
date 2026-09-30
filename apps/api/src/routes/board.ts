import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BoardResponse, type BoardCard, type Database, type RetroPhase, type VisibleBoardCard } from '@retronoodle/shared';
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

    const [columnsResult, cardsResult, lastEventResult] = await Promise.all([
      supabaseAdmin.from('retro_columns').select().eq('retro_id', retroId).order('position'),
      supabaseAdmin.from('cards').select().eq('retro_id', retroId),
      supabaseAdmin.from('retro_events').select('seq').eq('retro_id', retroId).order('seq', { ascending: false }).limit(1).maybeSingle(),
    ]);

    if (columnsResult.error || cardsResult.error || lastEventResult.error) {
      request.log.error(
        { columns: columnsResult.error, cards: cardsResult.error, event: lastEventResult.error },
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
          hidden: false,
        };
        return redactCard(full, redactCtx);
      }),
      seq: lastEventResult.data?.seq ?? 0,
      // RN-012: this specific response is what a late joiner's clock-offset calculation anchors
      // to, so it's set explicitly here rather than relying solely on the global serverTime hook
      // (server.ts) — that hook still covers every other response, this one just can't risk it.
      serverTime: new Date().toISOString(),
    });
  });
}
