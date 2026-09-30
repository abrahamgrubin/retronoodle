import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CreateTeamRequest, TeamResponse, type Database } from '@retronoodle/shared';
import { can } from '../auth/can.js';
import { getTeamRole } from '../auth/membership.js';
import type { RealtimeBus } from '../realtime/RealtimeBus.js';

export interface TeamRoutesDeps {
  supabaseAdmin: SupabaseClient<Database>;
  requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  realtimeBus: RealtimeBus;
}

/** Routes: POST /teams, GET /teams/:id, GET /me/teams, DELETE /teams/:id/members/:userId (RN-005). */
export function registerTeamRoutes(app: FastifyInstance, deps: TeamRoutesDeps): void {
  const { supabaseAdmin, requireAuth, realtimeBus } = deps;

  app.post('/teams', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.user;
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    if (!can(user, 'team.create', null)) return reply.code(403).send({ error: 'forbidden' });

    const body = CreateTeamRequest.parse(request.body);

    const { data: team, error: teamError } = await supabaseAdmin
      .from('teams')
      .insert({ id: body.id, name: body.name, created_by: user.id })
      .select()
      .single();
    if (teamError || !team) {
      request.log.error({ err: teamError }, 'failed to create team');
      return reply.code(500).send({ error: 'team_create_failed' });
    }

    // Creator becomes admin (RN-005 acceptance criterion).
    const { error: memberError } = await supabaseAdmin
      .from('team_members')
      .insert({ team_id: team.id, user_id: user.id, role: 'admin' });
    if (memberError) {
      request.log.error({ err: memberError }, 'failed to add team creator as admin');
      return reply.code(500).send({ error: 'team_create_failed' });
    }

    return reply.code(201).send(
      TeamResponse.parse({
        id: team.id,
        name: team.name,
        createdBy: team.created_by,
        retroCadenceDays: team.retro_cadence_days,
        role: 'admin',
        createdAt: team.created_at,
      }),
    );
  });

  app.get<{ Params: { id: string } }>('/teams/:id', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.user;
    if (!user) return reply.code(401).send({ error: 'unauthorized' });

    const teamId = request.params.id;
    const role = await getTeamRole(supabaseAdmin, teamId, user.id);
    if (!can(user, 'team.read', { type: 'team', role })) {
      return reply.code(403).send({ error: 'forbidden' });
    }

    const { data: team, error } = await supabaseAdmin.from('teams').select().eq('id', teamId).maybeSingle();
    if (error) {
      request.log.error({ err: error }, 'failed to read team');
      return reply.code(500).send({ error: 'team_read_failed' });
    }
    if (!team) return reply.code(404).send({ error: 'not_found' });

    return TeamResponse.parse({
      id: team.id,
      name: team.name,
      createdBy: team.created_by,
      retroCadenceDays: team.retro_cadence_days,
      role,
      createdAt: team.created_at,
    });
  });

  app.get('/me/teams', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.user;
    if (!user) return reply.code(401).send({ error: 'unauthorized' });

    const { data: memberships, error: membershipError } = await supabaseAdmin
      .from('team_members')
      .select('team_id, role')
      .eq('user_id', user.id);
    if (membershipError || !memberships) {
      request.log.error({ err: membershipError }, 'failed to list memberships');
      return reply.code(500).send({ error: 'teams_list_failed' });
    }
    if (memberships.length === 0) return [];

    const teamIds = memberships.map((m) => m.team_id);
    const { data: teams, error: teamsError } = await supabaseAdmin.from('teams').select().in('id', teamIds);
    if (teamsError || !teams) {
      request.log.error({ err: teamsError }, 'failed to list teams');
      return reply.code(500).send({ error: 'teams_list_failed' });
    }

    const roleByTeamId = new Map(memberships.map((m) => [m.team_id, m.role]));
    return teams.map((team) =>
      TeamResponse.parse({
        id: team.id,
        name: team.name,
        createdBy: team.created_by,
        retroCadenceDays: team.retro_cadence_days,
        role: roleByTeamId.get(team.id),
        createdAt: team.created_at,
      }),
    );
  });

  app.delete<{ Params: { id: string; userId: string } }>(
    '/teams/:id/members/:userId',
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = request.user;
      if (!user) return reply.code(401).send({ error: 'unauthorized' });

      const { id: teamId, userId: targetUserId } = request.params;
      const role = await getTeamRole(supabaseAdmin, teamId, user.id);
      if (!can(user, 'team.member.remove', { type: 'team', role })) {
        return reply.code(403).send({ error: 'forbidden' });
      }

      const { error } = await supabaseAdmin
        .from('team_members')
        .delete()
        .eq('team_id', teamId)
        .eq('user_id', targetUserId);
      if (error) {
        request.log.error({ err: error }, 'failed to remove team member');
        return reply.code(500).send({ error: 'remove_member_failed' });
      }

      // Closes the removed member's open board client-side (RN-005 technical note).
      await realtimeBus.broadcastUser(targetUserId, { type: 'removed', payload: { teamId } });

      return reply.code(204).send();
    },
  );
}
