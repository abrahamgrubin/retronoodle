import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { TemplateResponse, type Database } from '@retronoodle/shared';
import { can } from '../auth/can.js';
import { getTeamRole } from '../auth/membership.js';

export interface TemplateRoutesDeps {
  supabaseAdmin: SupabaseClient<Database>;
  requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

/** GET /teams/:teamId/templates (RN-007): builtin templates plus this team's own, for the
 * picker shown when creating a retro. */
export function registerTemplateRoutes(app: FastifyInstance, deps: TemplateRoutesDeps): void {
  const { supabaseAdmin, requireAuth } = deps;

  app.get<{ Params: { teamId: string } }>(
    '/teams/:teamId/templates',
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = request.user;
      if (!user) return reply.code(401).send({ error: 'unauthorized' });

      const teamId = request.params.teamId;
      const role = await getTeamRole(supabaseAdmin, teamId, user.id);
      if (!can(user, 'template.read', { type: 'team', role })) {
        return reply.code(403).send({ error: 'forbidden' });
      }

      const { data: templates, error } = await supabaseAdmin
        .from('templates')
        .select()
        .or(`team_id.is.null,team_id.eq.${teamId}`);
      if (error || !templates) {
        request.log.error({ err: error }, 'failed to list templates');
        return reply.code(500).send({ error: 'templates_list_failed' });
      }

      return templates.map((template) =>
        TemplateResponse.parse({
          id: template.id,
          name: template.name,
          source: template.source,
          columns: template.columns,
        }),
      );
    },
  );
}
