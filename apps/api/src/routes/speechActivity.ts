import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SpeechActivityInterval, tagLineToTopic, TRANSCRIPTION_CAPTURE_PHASES, type Database } from '@retronoodle/shared';
import { z } from 'zod';
import { can } from '../auth/can.js';
import { getTeamRole } from '../auth/membership.js';

export interface SpeechActivityRoutesDeps {
  supabaseAdmin: SupabaseClient<Database>;
  requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

const SpeechActivityUploadBody = z.object({
  intervals: z.array(SpeechActivityInterval).max(100),
});

/**
 * POST /retros/:id/speech-activity (RN-035): on-device VAD intervals only — never audio, and
 * never routed through the mutation pipeline (telemetry, not retro content; same "bypasses the
 * audit log" precedent as RN-032's heartbeat route). `startMs`/`endMs` arrive already
 * clock-corrected (the client's own server-offset, computed the same way as the phase countdown
 * — see clock.ts) — this route trusts them as absolute epoch milliseconds and only adds the topic
 * tag (RN-034's own tagging function, reused rather than duplicated).
 */
export function registerSpeechActivityRoutes(app: FastifyInstance, deps: SpeechActivityRoutesDeps): void {
  const { supabaseAdmin, requireAuth } = deps;

  app.post<{ Params: { id: string } }>('/retros/:id/speech-activity', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.user;
    if (!user) return reply.code(401).send({ error: 'unauthorized' });

    const parsed = SpeechActivityUploadBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
    if (parsed.data.intervals.length === 0) return reply.code(204).send();

    const retroId = request.params.id;
    const { data: retro, error: retroError } = await supabaseAdmin
      .from('retros')
      .select('team_id, facilitator_id, phase')
      .eq('id', retroId)
      .maybeSingle();
    if (retroError) {
      request.log.error({ err: retroError }, 'failed to read retro for speech activity upload');
      return reply.code(500).send({ error: 'speech_activity_failed' });
    }
    if (!retro) return reply.code(404).send({ error: 'not_found' });

    const role = await getTeamRole(supabaseAdmin, retro.team_id, user.id);
    if (!can(user, 'retro.read', { type: 'retro', teamRole: role, facilitatorId: retro.facilitator_id })) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    if (!(TRANSCRIPTION_CAPTURE_PHASES as readonly string[]).includes(retro.phase)) {
      return reply.code(409).send({ error: 'phase_not_allowed' });
    }

    const { data: topics, error: topicsError } = await supabaseAdmin.from('topics').select('id, started_at, ended_at').eq('retro_id', retroId);
    if (topicsError) {
      request.log.error({ err: topicsError }, 'failed to read topics for speech activity tagging');
      return reply.code(500).send({ error: 'speech_activity_failed' });
    }
    const candidates = (topics ?? []).map((t) => ({
      id: t.id,
      startedAt: t.started_at ? new Date(t.started_at).getTime() : null,
      endedAt: t.ended_at ? new Date(t.ended_at).getTime() : null,
    }));

    const rows = parsed.data.intervals.map((interval) => ({
      retro_id: retroId,
      user_id: user.id,
      topic_id: tagLineToTopic({ startMs: interval.startMs }, candidates),
      start_ms: interval.startMs,
      end_ms: interval.endMs,
    }));

    const { error: insertError } = await supabaseAdmin.from('speech_activity').insert(rows);
    if (insertError) {
      request.log.error({ err: insertError }, 'failed to store speech activity');
      return reply.code(500).send({ error: 'speech_activity_failed' });
    }

    return reply.code(204).send();
  });
}
