import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Recap, RecapResponse, topicSummaryParagraph, type Database, type TopicSummaryPoint } from '@retronoodle/shared';
import { can } from '../auth/can.js';
import { getTeamRole } from '../auth/membership.js';

export interface RecapRoutesDeps {
  supabaseAdmin: SupabaseClient<Database>;
  requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

/**
 * GET /retros/:id/recap (RN-045): "built from the DB" — the same data the Wrap up screen showed,
 * read live on every request. No AI runs at close; topic summaries are each discussed topic's
 * latest `topic_summaries` version (topic-summarizer's output plus any facilitator edits), in
 * discussion order. Action items, undiscussed topics and attendance come from their own tables;
 * additional notes from `retro_recaps` (recap.editNotes). No vote counts anywhere.
 */
export function registerRecapRoutes(app: FastifyInstance, deps: RecapRoutesDeps): void {
  const { supabaseAdmin, requireAuth } = deps;

  app.get<{ Params: { id: string } }>('/retros/:id/recap', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.user;
    if (!user) return reply.code(401).send({ error: 'unauthorized' });

    const retroId = request.params.id;
    const { data: retro, error: retroError } = await supabaseAdmin
      .from('retros')
      .select('team_id, facilitator_id, phase, name, deleted_at')
      .eq('id', retroId)
      .maybeSingle();
    if (retroError) {
      request.log.error({ err: retroError }, 'failed to read retro for recap');
      return reply.code(500).send({ error: 'recap_read_failed' });
    }
    if (!retro || retro.deleted_at) return reply.code(404).send({ error: 'not_found' });

    const role = await getTeamRole(supabaseAdmin, retro.team_id, user.id);
    if (!can(user, 'retro.read', { type: 'retro', teamRole: role, facilitatorId: retro.facilitator_id })) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    // There's nothing to recap before the retro is actually closed — not a 403 (the viewer can
    // read the board itself just fine), just nothing at this URL yet.
    if (retro.phase !== 'closed') return reply.code(404).send({ error: 'not_found' });

    const [recapRowResult, topicsResult, actionItemsResult, participantsResult] = await Promise.all([
      supabaseAdmin.from('retro_recaps').select('additional_notes').eq('retro_id', retroId).maybeSingle(),
      supabaseAdmin.from('topics').select('id, name, ai_group_summary_title, discussion_order, started_at').eq('retro_id', retroId),
      supabaseAdmin.from('action_items').select('id, title, owner_id, status, created_at').eq('source_retro_id', retroId),
      supabaseAdmin.from('retro_participants').select('user_id').eq('retro_id', retroId),
    ]);
    const readError = recapRowResult.error ?? topicsResult.error ?? actionItemsResult.error ?? participantsResult.error;
    if (readError) {
      request.log.error({ err: readError }, 'failed to read recap data');
      return reply.code(500).send({ error: 'recap_read_failed' });
    }

    // Same label and order as the Wrap up screen (DiscussScreen.tsx's topicLabel, WrapUpScreen's
    // byOrder).
    const topics = [...(topicsResult.data ?? [])].sort((a, b) => (a.discussion_order ?? '').localeCompare(b.discussion_order ?? ''));
    const labelOf = (t: (typeof topics)[number]) => t.ai_group_summary_title || t.name || 'Untitled group';
    const discussed = topics.filter((t) => t.started_at);

    const latestSummaryByTopic = new Map<string, string>();
    if (discussed.length > 0) {
      const { data: summaryRows, error: summariesError } = await supabaseAdmin
        .from('topic_summaries')
        .select('topic_id, version, key_points, decisions')
        .in('topic_id', discussed.map((t) => t.id))
        .order('topic_id')
        .order('version', { ascending: false });
      if (summariesError) {
        request.log.error({ err: summariesError }, 'failed to read topic summaries for recap');
        return reply.code(500).send({ error: 'recap_read_failed' });
      }
      for (const row of summaryRows ?? []) {
        if (latestSummaryByTopic.has(row.topic_id)) continue;
        latestSummaryByTopic.set(
          row.topic_id,
          topicSummaryParagraph({ keyPoints: row.key_points as TopicSummaryPoint[], decisions: row.decisions as TopicSummaryPoint[] }),
        );
      }
    }

    const actionItems = [...(actionItemsResult.data ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const ownerIds = [...new Set(actionItems.map((a) => a.owner_id).filter((id): id is string => id !== null))];
    const participantIds = (participantsResult.data ?? []).map((p) => p.user_id);
    // One profiles lookup covers both action-item owners and attendees — the same id-list-then-
    // join pattern board.ts uses for card authors/team members.
    const profileIds = [...new Set([...ownerIds, ...participantIds])];
    const nameById = new Map<string, string>();
    if (profileIds.length > 0) {
      const { data: profiles, error: profilesError } = await supabaseAdmin.from('profiles').select('id, display_name').in('id', profileIds);
      if (profilesError) {
        request.log.error({ err: profilesError }, 'failed to read profiles for recap');
        return reply.code(500).send({ error: 'recap_read_failed' });
      }
      for (const p of profiles ?? []) nameById.set(p.id, p.display_name);
    }

    // Facilitator first, then everyone else alphabetically — same as Wrap up's Attendance card.
    const attendance = participantIds
      .map((id) => ({ id, displayName: nameById.get(id) ?? 'Unknown', isFacilitator: id === retro.facilitator_id }))
      .sort((a, b) => (a.isFacilitator ? -1 : b.isFacilitator ? 1 : a.displayName.localeCompare(b.displayName)));

    const recap = Recap.parse({
      retroId,
      topicSummaries: discussed.map((t) => ({ topicId: t.id, topicName: labelOf(t), summary: latestSummaryByTopic.get(t.id) ?? null })),
      actionItems: actionItems.map((a) => ({
        id: a.id,
        title: a.title,
        ownerName: a.owner_id ? (nameById.get(a.owner_id) ?? null) : null,
        status: a.status,
      })),
      undiscussedTopics: topics.filter((t) => !t.started_at).map((t) => ({ topicId: t.id, topicName: labelOf(t) })),
      attendance,
    });

    return reply.send(
      RecapResponse.parse({
        teamId: retro.team_id,
        retroName: retro.name,
        isFacilitator: retro.facilitator_id === user.id,
        recap,
        additionalNotes: recapRowResult.data?.additional_notes ?? '',
      }),
    );
  });
}
