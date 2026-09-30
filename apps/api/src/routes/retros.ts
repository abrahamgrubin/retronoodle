import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CreateRetroRequest,
  JoinResponse,
  phaseDurationMinutes,
  RetroCreatedResponse,
  TemplateColumn,
  type Database,
} from '@retronoodle/shared';
import { can } from '../auth/can.js';
import { getTeamRole } from '../auth/membership.js';
import { timezoneFromHeader, upsertProfile } from '../auth/profile.js';
import { generateJoinCode, hashJoinCode } from '../joinCode.js';

export interface RetroRoutesDeps {
  supabaseAdmin: SupabaseClient<Database>;
  requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

type RetroRow = {
  id: string;
  team_id: string;
  name: string;
  phase: string;
  facilitator_id: string;
  template_id: string;
  template_source: string;
  created_at: string;
};

function toRetroCreatedResponse(retro: RetroRow, joinCode: string) {
  return RetroCreatedResponse.parse({
    id: retro.id,
    teamId: retro.team_id,
    name: retro.name,
    phase: retro.phase,
    facilitatorId: retro.facilitator_id,
    templateId: retro.template_id,
    templateSource: retro.template_source,
    createdAt: retro.created_at,
    joinCode,
  });
}

/** Routes: POST /teams/:teamId/retros, POST /retros/:id/join-link/regenerate, GET /join/:code
 * (RN-006). Join codes are never stored in plaintext — only their hash — so both the create and
 * regenerate responses are the one and only time the caller sees the code. */
export function registerRetroRoutes(app: FastifyInstance, deps: RetroRoutesDeps): void {
  const { supabaseAdmin, requireAuth } = deps;

  app.post<{ Params: { teamId: string } }>(
    '/teams/:teamId/retros',
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = request.user;
      if (!user) return reply.code(401).send({ error: 'unauthorized' });

      const teamId = request.params.teamId;
      const role = await getTeamRole(supabaseAdmin, teamId, user.id);
      if (!can(user, 'retro.create', { type: 'team', role })) {
        return reply.code(403).send({ error: 'forbidden' });
      }

      const body = CreateRetroRequest.parse(request.body);

      // A retro never sits in `setup` (RN-010): it starts in Review if the team has carried-over
      // action items still open, and Write otherwise — "Review is skipped automatically when the
      // team has no open or in-progress items."
      const { data: carriedItems, error: carriedItemsError } = await supabaseAdmin
        .from('action_items')
        .select('id')
        .eq('team_id', teamId)
        .in('status', ['open', 'in_progress'])
        .limit(1);
      if (carriedItemsError) {
        request.log.error({ err: carriedItemsError }, 'failed to check for carried-over action items');
        return reply.code(500).send({ error: 'retro_create_failed' });
      }
      const initialPhase = (carriedItems?.length ?? 0) > 0 ? 'review' : 'write';
      // RN-012: both review and write have a default duration, so this is never null in
      // practice — the retro starts its countdown from the moment it's created.
      const initialPhaseDeadline = new Date(Date.now() + phaseDurationMinutes(initialPhase)! * 60_000).toISOString();

      // The template must be a built-in or belong to this team — not some other team's.
      const { data: template } = await supabaseAdmin
        .from('templates')
        .select('id, team_id, source, columns')
        .eq('id', body.templateId)
        .maybeSingle();
      if (!template || (template.team_id !== null && template.team_id !== teamId)) {
        return reply.code(400).send({ error: 'invalid_template' });
      }
      const templateColumns = TemplateColumn.array().parse(template.columns);

      const joinCode = generateJoinCode();
      const { data: retro, error } = await supabaseAdmin
        .from('retros')
        .insert({
          id: body.id,
          team_id: teamId,
          facilitator_id: user.id,
          template_id: body.templateId,
          template_source: template.source,
          name: body.name,
          phase: initialPhase,
          phase_deadline: initialPhaseDeadline,
          join_code_hash: hashJoinCode(joinCode),
        })
        .select()
        .single();
      if (error || !retro) {
        request.log.error({ err: error }, 'failed to create retro');
        return reply.code(500).send({ error: 'retro_create_failed' });
      }

      // Copy the template's columns onto the retro now, at creation (RN-007) — there's no
      // phase-transition mechanism yet (that's RN-010), and a retro needs its columns from the
      // moment it exists. Later template edits never touch this: it's a one-time copy, not a
      // live reference. The code always appends one Action items column last; templates never
      // store it themselves.
      const columnsToInsert = [
        ...templateColumns.map((column, index) => ({
          id: randomUUID(),
          retro_id: retro.id,
          title: column.title,
          prompt: column.prompt ?? null,
          color: column.color,
          kind: 'standard',
          position: index,
        })),
        {
          id: randomUUID(),
          retro_id: retro.id,
          title: 'Action items',
          prompt: null,
          color: 'blue',
          kind: 'action_items',
          position: templateColumns.length,
        },
      ];
      const { error: columnsError } = await supabaseAdmin.from('retro_columns').insert(columnsToInsert);
      if (columnsError) {
        request.log.error({ err: columnsError }, 'failed to copy template columns onto retro');
        return reply.code(500).send({ error: 'retro_create_failed' });
      }

      return reply.code(201).send(toRetroCreatedResponse(retro, joinCode));
    },
  );

  app.post<{ Params: { id: string } }>(
    '/retros/:id/join-link/regenerate',
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = request.user;
      if (!user) return reply.code(401).send({ error: 'unauthorized' });

      const { data: retro, error: fetchError } = await supabaseAdmin
        .from('retros')
        .select()
        .eq('id', request.params.id)
        .maybeSingle();
      if (fetchError) {
        request.log.error({ err: fetchError }, 'failed to read retro');
        return reply.code(500).send({ error: 'retro_read_failed' });
      }
      if (!retro) return reply.code(404).send({ error: 'not_found' });

      if (!can(user, 'retro.manageJoinLink', { type: 'retro', teamRole: null, facilitatorId: retro.facilitator_id })) {
        return reply.code(403).send({ error: 'forbidden' });
      }

      const joinCode = generateJoinCode();
      const { data: updated, error: updateError } = await supabaseAdmin
        .from('retros')
        .update({ join_code_hash: hashJoinCode(joinCode) })
        .eq('id', retro.id)
        .select()
        .single();
      if (updateError || !updated) {
        request.log.error({ err: updateError }, 'failed to regenerate join code');
        return reply.code(500).send({ error: 'regenerate_failed' });
      }

      return toRetroCreatedResponse(updated, joinCode);
    },
  );

  app.get<{ Params: { code: string } }>('/join/:code', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.user;
    if (!user) return reply.code(401).send({ error: 'unauthorized' });

    // Link-based access, not role-based — anyone holding a valid code may join (RN-006: "v0.1:
    // anyone with the link joins, no domain allowlist"), so this deliberately doesn't use can().
    const { data: retro, error } = await supabaseAdmin
      .from('retros')
      .select()
      .eq('join_code_hash', hashJoinCode(request.params.code))
      .maybeSingle();
    if (error) {
      request.log.error({ err: error }, 'failed to look up join code');
      return reply.code(500).send({ error: 'join_failed' });
    }
    // Also covers a regenerated (now-stale) code: its hash no longer matches any retro.
    if (!retro) return reply.code(404).send({ error: 'invalid_link' });
    if (retro.phase === 'closed') {
      return reply.code(410).send({ error: 'retro_closed', teamId: retro.team_id });
    }

    // team_members.user_id (and retro_participants.user_id) FKs to profiles.id — a brand-new
    // user landing straight here (never having hit GET /me) has no profile row yet.
    const { error: profileError } = await upsertProfile(supabaseAdmin, user, timezoneFromHeader(request.headers['x-timezone']));
    if (profileError) {
      request.log.error({ err: profileError }, 'failed to upsert profile before joining');
      return reply.code(500).send({ error: 'join_failed' });
    }

    // Idempotent: an existing member/participant isn't duplicated (RN-006 acceptance criterion).
    const { error: memberError } = await supabaseAdmin
      .from('team_members')
      .upsert({ team_id: retro.team_id, user_id: user.id, role: 'member' }, { onConflict: 'team_id,user_id', ignoreDuplicates: true });
    if (memberError) {
      request.log.error({ err: memberError }, 'failed to add team member via join link');
      return reply.code(500).send({ error: 'join_failed' });
    }

    const { error: participantError } = await supabaseAdmin
      .from('retro_participants')
      .upsert({ retro_id: retro.id, user_id: user.id }, { onConflict: 'retro_id,user_id', ignoreDuplicates: true });
    if (participantError) {
      request.log.error({ err: participantError }, 'failed to add retro participant via join link');
      return reply.code(500).send({ error: 'join_failed' });
    }

    return JoinResponse.parse({
      retroId: retro.id,
      teamId: retro.team_id,
      name: retro.name,
      phase: retro.phase,
    });
  });
}
