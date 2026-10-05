import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ActionItemStatusChangePayload,
  ActionItemStatusChangeResult,
  ActionItemStatusHistoryResponse,
  TeamActionItemsResponse,
  type Database,
} from '@retronoodle/shared';
import { can } from '../auth/can.js';
import { getTeamRole } from '../auth/membership.js';

export interface ActionItemRoutesDeps {
  supabaseAdmin: SupabaseClient<Database>;
  requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

/** Routes behind RN-024's team action-item list (`/teams/:id/actions`). This is a TanStack-Query
 * page, not the live retro board — there's no phase to gate against and no seq to order, so these
 * are plain REST routes, the same category as team creation (RN-005), never the
 * `/retros/:id/mutations` pipeline (that pipeline exists for retro-board writes specifically). */
export function registerActionItemRoutes(app: FastifyInstance, deps: ActionItemRoutesDeps): void {
  const { supabaseAdmin, requireAuth } = deps;

  app.get<{ Params: { teamId: string } }>('/teams/:teamId/actions', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.user;
    if (!user) return reply.code(401).send({ error: 'unauthorized' });

    const teamId = request.params.teamId;
    const role = await getTeamRole(supabaseAdmin, teamId, user.id);
    if (!can(user, 'actionItem.read', { type: 'team', role })) {
      return reply.code(403).send({ error: 'forbidden' });
    }

    const { data: items, error } = await supabaseAdmin.from('action_items').select().eq('team_id', teamId);
    if (error) {
      request.log.error({ err: error }, 'failed to list team action items');
      return reply.code(500).send({ error: 'action_items_list_failed' });
    }

    const ownerIds = [...new Set((items ?? []).map((i) => i.owner_id).filter((id): id is string => id !== null))];
    const ownerNameById = new Map<string, string>();
    if (ownerIds.length > 0) {
      const { data: owners, error: ownersError } = await supabaseAdmin.from('profiles').select('id, display_name').in('id', ownerIds);
      if (ownersError) {
        request.log.error({ err: ownersError }, 'failed to read action item owners');
        return reply.code(500).send({ error: 'action_items_list_failed' });
      }
      for (const o of owners ?? []) ownerNameById.set(o.id, o.display_name);
    }

    const retroIds = [...new Set((items ?? []).map((i) => i.source_retro_id))];
    const retroNameById = new Map<string, string>();
    if (retroIds.length > 0) {
      const { data: retros, error: retrosError } = await supabaseAdmin.from('retros').select('id, name').in('id', retroIds);
      if (retrosError) {
        request.log.error({ err: retrosError }, 'failed to read source retros for action items');
        return reply.code(500).send({ error: 'action_items_list_failed' });
      }
      for (const r of retros ?? []) retroNameById.set(r.id, r.name);
    }

    return TeamActionItemsResponse.parse({
      items: (items ?? []).map((i) => ({
        id: i.id,
        title: i.title,
        ownerId: i.owner_id,
        ownerName: i.owner_id ? (ownerNameById.get(i.owner_id) ?? null) : null,
        dueDate: i.due_date,
        status: i.status,
        origin: i.origin,
        completedAt: i.completed_at,
        sourceRetroId: i.source_retro_id,
        sourceRetroName: retroNameById.get(i.source_retro_id) ?? 'Unknown retro',
        updatedAt: i.updated_at,
      })),
    });
  });

  app.get<{ Params: { teamId: string; itemId: string } }>(
    '/teams/:teamId/actions/:itemId/history',
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = request.user;
      if (!user) return reply.code(401).send({ error: 'unauthorized' });

      const { teamId, itemId } = request.params;
      const role = await getTeamRole(supabaseAdmin, teamId, user.id);
      if (!can(user, 'actionItem.read', { type: 'team', role })) {
        return reply.code(403).send({ error: 'forbidden' });
      }

      const { data: item, error: itemError } = await supabaseAdmin
        .from('action_items')
        .select('id')
        .eq('id', itemId)
        .eq('team_id', teamId)
        .maybeSingle();
      if (itemError) {
        request.log.error({ err: itemError }, 'failed to look up action item for history');
        return reply.code(500).send({ error: 'history_read_failed' });
      }
      if (!item) return reply.code(404).send({ error: 'not_found' });

      const { data: changes, error } = await supabaseAdmin
        .from('action_item_status_changes')
        .select()
        .eq('action_item_id', itemId)
        .order('created_at', { ascending: false });
      if (error) {
        request.log.error({ err: error }, 'failed to read action item status history');
        return reply.code(500).send({ error: 'history_read_failed' });
      }

      const actorIds = [...new Set((changes ?? []).map((c) => c.actor_id).filter((id): id is string => id !== null))];
      const actorNameById = new Map<string, string>();
      if (actorIds.length > 0) {
        const { data: actors, error: actorsError } = await supabaseAdmin.from('profiles').select('id, display_name').in('id', actorIds);
        if (actorsError) {
          request.log.error({ err: actorsError }, 'failed to read status-change actors');
          return reply.code(500).send({ error: 'history_read_failed' });
        }
        for (const a of actors ?? []) actorNameById.set(a.id, a.display_name);
      }

      return ActionItemStatusHistoryResponse.parse({
        entries: (changes ?? []).map((c) => ({
          id: c.id,
          fromStatus: c.from_status,
          toStatus: c.to_status,
          actorId: c.actor_id,
          actorName: c.actor_id ? (actorNameById.get(c.actor_id) ?? null) : null,
          createdAt: c.created_at,
        })),
      });
    },
  );

  app.post<{ Params: { teamId: string; itemId: string }; Body: unknown }>(
    '/teams/:teamId/actions/:itemId/status',
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = request.user;
      if (!user) return reply.code(401).send({ error: 'unauthorized' });

      const { teamId, itemId } = request.params;
      const role = await getTeamRole(supabaseAdmin, teamId, user.id);
      if (!can(user, 'actionItem.updateStatus', { type: 'team', role })) {
        return reply.code(403).send({ error: 'forbidden' });
      }

      let payload: ActionItemStatusChangePayload;
      try {
        payload = ActionItemStatusChangePayload.parse(request.body);
      } catch {
        return reply.code(400).send({ error: 'invalid_payload' });
      }

      const { data: existing, error: existingError } = await supabaseAdmin
        .from('action_items')
        .select('status')
        .eq('id', itemId)
        .eq('team_id', teamId)
        .maybeSingle();
      if (existingError) {
        request.log.error({ err: existingError }, 'failed to read action item before status change');
        return reply.code(500).send({ error: 'status_change_failed' });
      }
      if (!existing) return reply.code(404).send({ error: 'not_found' });

      // "Marking done stamps completed_at; reopening clears it" — any status other than 'done'
      // (including 'dropped') has no completion timestamp, so this is just a function of the
      // *new* status, not a special-cased "coming back from done" branch.
      const completedAt = payload.status === 'done' ? new Date().toISOString() : null;
      const { data: updated, error: updateError } = await supabaseAdmin
        .from('action_items')
        .update({ status: payload.status, completed_at: completedAt, updated_at: new Date().toISOString() })
        .eq('id', itemId)
        .select()
        .single();
      if (updateError || !updated) {
        request.log.error({ err: updateError }, 'failed to update action item status');
        return reply.code(500).send({ error: 'status_change_failed' });
      }

      // Not fatal to the caller — the status change itself already succeeded, and there's no
      // single transaction spanning both calls to roll back (plain supabase-js, not the mutation
      // pipeline's locked pg transaction). Losing one history row is logged, not surfaced.
      const { error: historyError } = await supabaseAdmin.from('action_item_status_changes').insert({
        action_item_id: itemId,
        from_status: existing.status,
        to_status: payload.status,
        actor_id: user.id,
      });
      if (historyError) {
        request.log.error({ err: historyError }, 'failed to record action item status history');
      }

      const { data: retro } = await supabaseAdmin.from('retros').select('name').eq('id', updated.source_retro_id).maybeSingle();
      let ownerName: string | null = null;
      if (updated.owner_id) {
        const { data: owner } = await supabaseAdmin.from('profiles').select('display_name').eq('id', updated.owner_id).maybeSingle();
        ownerName = owner?.display_name ?? null;
      }

      return ActionItemStatusChangeResult.parse({
        item: {
          id: updated.id,
          title: updated.title,
          ownerId: updated.owner_id,
          ownerName,
          dueDate: updated.due_date,
          status: updated.status,
          origin: updated.origin,
          completedAt: updated.completed_at,
          sourceRetroId: updated.source_retro_id,
          sourceRetroName: retro?.name ?? 'Unknown retro',
          updatedAt: updated.updated_at,
        },
      });
    },
  );
}
