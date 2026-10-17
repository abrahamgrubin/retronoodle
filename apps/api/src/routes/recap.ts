import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Recap, RecapResponse, type Database } from '@retronoodle/shared';
import { can } from '../auth/can.js';
import { getTeamRole } from '../auth/membership.js';
import type { JobSender } from '../mutations/registry.js';

export interface RecapRoutesDeps {
  supabaseAdmin: SupabaseClient<Database>;
  requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  jobs?: JobSender;
}

/**
 * GET /retros/:id/recap (RN-045): "built from the DB" — `topicSummaries`/`decisions` are the
 * recap agent team's own stored output (`retro_recaps`, written once by ai.generateRecap at
 * close); `actionItems`/`undiscussedTopics`/`attendance` are computed live here on every request
 * instead, so e.g. an action item's status always reflects reality even if it changed after the
 * job ran once. No vote counts anywhere — explicitly left out of this story's scope.
 *
 * A closed retro with no `retro_recaps` row at all (pre-dating this feature, or a retro.close
 * whose own best-effort enqueue never landed) gets one seeded here rather than erroring — the
 * same self-healing `on conflict do nothing` insert retro.close itself does.
 */
export function registerRecapRoutes(app: FastifyInstance, deps: RecapRoutesDeps): void {
  const { supabaseAdmin, requireAuth, jobs } = deps;

  app.get<{ Params: { id: string } }>('/retros/:id/recap', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.user;
    if (!user) return reply.code(401).send({ error: 'unauthorized' });

    const retroId = request.params.id;
    const { data: retro, error: retroError } = await supabaseAdmin
      .from('retros')
      .select('team_id, facilitator_id, phase, name')
      .eq('id', retroId)
      .maybeSingle();
    if (retroError) {
      request.log.error({ err: retroError }, 'failed to read retro for recap');
      return reply.code(500).send({ error: 'recap_read_failed' });
    }
    if (!retro) return reply.code(404).send({ error: 'not_found' });

    const role = await getTeamRole(supabaseAdmin, retro.team_id, user.id);
    if (!can(user, 'retro.read', { type: 'retro', teamRole: role, facilitatorId: retro.facilitator_id })) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    // There's nothing to recap before the retro is actually closed — not a 403 (the viewer can
    // read the board itself just fine), just nothing at this URL yet.
    if (retro.phase !== 'closed') return reply.code(404).send({ error: 'not_found' });
    const isFacilitator = retro.facilitator_id === user.id;

    const { data: initialRecapRow, error: recapError } = await supabaseAdmin
      .from('retro_recaps')
      .select('status, topic_summaries, decisions, generated_at, additional_notes')
      .eq('retro_id', retroId)
      .maybeSingle();
    if (recapError) {
      request.log.error({ err: recapError }, 'failed to read retro_recaps');
      return reply.code(500).send({ error: 'recap_read_failed' });
    }
    let recapRow = initialRecapRow;
    if (!recapRow) {
      await supabaseAdmin.from('retro_recaps').insert({ retro_id: retroId, status: 'pending' });
      if (jobs) {
        try {
          await jobs.send('ai.generateRecap', { retroId });
        } catch {
          // Swallowed deliberately, same as every other best-effort AI enqueue in this app.
        }
      }
      recapRow = { status: 'pending', topic_summaries: [], decisions: [], generated_at: null, additional_notes: '' };
    }

    if (recapRow.status !== 'ready') {
      return reply.send(
        RecapResponse.parse({
          teamId: retro.team_id,
          retroName: retro.name,
          isFacilitator,
          status: recapRow.status,
          recap: null,
          additionalNotes: recapRow.additional_notes,
        }),
      );
    }

    const [actionItemsResult, undiscussedResult, participantsResult] = await Promise.all([
      supabaseAdmin.from('action_items').select('id, title, owner_id, status').eq('source_retro_id', retroId),
      supabaseAdmin.from('topics').select('id, name').eq('retro_id', retroId).is('started_at', null),
      supabaseAdmin.from('retro_participants').select('user_id').eq('retro_id', retroId),
    ]);
    if (actionItemsResult.error || undiscussedResult.error || participantsResult.error) {
      request.log.error(
        { err: actionItemsResult.error ?? undiscussedResult.error ?? participantsResult.error },
        'failed to read recap supporting data',
      );
      return reply.code(500).send({ error: 'recap_read_failed' });
    }

    const actionItems = actionItemsResult.data ?? [];
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

    const recap = Recap.parse({
      retroId,
      topicSummaries: recapRow.topic_summaries,
      decisions: recapRow.decisions,
      actionItems: actionItems.map((a) => ({
        id: a.id,
        title: a.title,
        ownerName: a.owner_id ? (nameById.get(a.owner_id) ?? null) : null,
        status: a.status,
      })),
      undiscussedTopics: (undiscussedResult.data ?? []).map((t) => ({ topicId: t.id, topicName: t.name ?? 'Untitled group' })),
      attendance: participantIds.map((id) => ({ id, displayName: nameById.get(id) ?? 'Unknown' })),
      generatedAt: recapRow.generated_at,
    });

    return reply.send(
      RecapResponse.parse({
        teamId: retro.team_id,
        retroName: retro.name,
        isFacilitator,
        status: 'ready',
        recap,
        additionalNotes: recapRow.additional_notes,
      }),
    );
  });
}
