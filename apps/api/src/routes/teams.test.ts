import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@retronoodle/shared';
import type { FastifyInstance } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildServer } from '../server.js';
import type { AuthClaims } from '../auth/index.js';
import type { RealtimeBus } from '../realtime/RealtimeBus.js';
import { chain } from '../testUtils/supabaseChain.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const claims: AuthClaims = { sub: '00000000-0000-4000-8000-000000000001', email: 'ada@example.com' };
const AUTH_HEADER = { authorization: 'Bearer good-token' };

function verifyAccessToken(token: string): Promise<AuthClaims> {
  if (token !== 'good-token') throw new Error('invalid token');
  return Promise.resolve(claims);
}

describe('team routes (RN-005)', () => {
  describe('POST /teams', () => {
    it('creates the team and makes the creator an admin', async () => {
      const teamRow = {
        id: '00000000-0000-4000-8000-0000000000aa',
        name: 'Platform Team',
        created_by: claims.sub,
        retro_cadence_days: 14,
        created_at: new Date().toISOString(),
      };
      const teamsCalls: unknown[][] = [];
      const memberCalls: unknown[][] = [];
      const supabaseAdmin = {
        from(table: string) {
          if (table === 'teams') return chain({ data: teamRow, error: null }, teamsCalls);
          if (table === 'team_members') return chain({ data: null, error: null }, memberCalls);
          throw new Error(`unexpected table ${table}`);
        },
      } as unknown as SupabaseClient<Database>;

      app = await buildServer({
        webOrigin: 'http://localhost:5173',
        auth: { verifyAccessToken, supabaseAdmin, realtimeBus: {} as RealtimeBus },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/teams',
        headers: AUTH_HEADER,
        payload: { id: teamRow.id, name: teamRow.name },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.role).toBe('admin');
      expect(body.id).toBe(teamRow.id);
      expect(teamsCalls[0]).toEqual(['insert', { id: teamRow.id, name: teamRow.name, created_by: claims.sub }]);
      expect(memberCalls[0]).toEqual(['insert', { team_id: teamRow.id, user_id: claims.sub, role: 'admin' }]);
    });
  });

  describe('GET /teams/:id', () => {
    const teamId = '00000000-0000-4000-8000-0000000000bb';
    const teamRow = {
      id: teamId,
      name: 'Platform Team',
      created_by: '00000000-0000-4000-8000-000000000099',
      retro_cadence_days: 14,
      created_at: new Date().toISOString(),
    };

    function build(role: 'admin' | 'member' | null) {
      const supabaseAdmin = {
        from(table: string) {
          if (table === 'team_members') return chain({ data: role ? { role } : null, error: null });
          if (table === 'teams') return chain({ data: teamRow, error: null });
          throw new Error(`unexpected table ${table}`);
        },
      } as unknown as SupabaseClient<Database>;

      return buildServer({
        webOrigin: 'http://localhost:5173',
        auth: { verifyAccessToken, supabaseAdmin, realtimeBus: {} as RealtimeBus },
      });
    }

    it('returns the team for a member', async () => {
      app = await build('member');
      const res = await app.inject({ method: 'GET', url: `/teams/${teamId}`, headers: AUTH_HEADER });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: teamId, role: 'member' });
    });

    it('returns 403 for a non-member', async () => {
      app = await build(null);
      const res = await app.inject({ method: 'GET', url: `/teams/${teamId}`, headers: AUTH_HEADER });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('GET /me/teams', () => {
    it('lists every team the caller belongs to, with their role on each', async () => {
      const team1 = '00000000-0000-4000-8000-000000000101';
      const team2 = '00000000-0000-4000-8000-000000000102';
      const memberships = [
        { team_id: team1, role: 'admin' },
        { team_id: team2, role: 'member' },
      ];
      const teams = [
        { id: team1, name: 'Team One', created_by: claims.sub, retro_cadence_days: 14, created_at: 'now' },
        {
          id: team2,
          name: 'Team Two',
          created_by: '00000000-0000-4000-8000-000000000099',
          retro_cadence_days: 14,
          created_at: 'now',
        },
      ];
      const supabaseAdmin = {
        from(table: string) {
          if (table === 'team_members') return chain({ data: memberships, error: null });
          if (table === 'teams') return chain({ data: teams, error: null });
          throw new Error(`unexpected table ${table}`);
        },
      } as unknown as SupabaseClient<Database>;

      app = await buildServer({
        webOrigin: 'http://localhost:5173',
        auth: { verifyAccessToken, supabaseAdmin, realtimeBus: {} as RealtimeBus },
      });

      const res = await app.inject({ method: 'GET', url: '/me/teams', headers: AUTH_HEADER });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(2);
      expect(body.find((t: { id: string }) => t.id === team1).role).toBe('admin');
      expect(body.find((t: { id: string }) => t.id === team2).role).toBe('member');
    });

    it('returns an empty array for a user with no teams', async () => {
      const supabaseAdmin = {
        from(table: string) {
          if (table === 'team_members') return chain({ data: [], error: null });
          throw new Error(`unexpected table ${table}`);
        },
      } as unknown as SupabaseClient<Database>;

      app = await buildServer({
        webOrigin: 'http://localhost:5173',
        auth: { verifyAccessToken, supabaseAdmin, realtimeBus: {} as RealtimeBus },
      });

      const res = await app.inject({ method: 'GET', url: '/me/teams', headers: AUTH_HEADER });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });
  });

  describe('DELETE /teams/:id/members/:userId', () => {
    const teamId = '00000000-0000-4000-8000-0000000000cc';
    const targetUserId = '00000000-0000-4000-8000-0000000000dd';

    function build(callerRole: 'admin' | 'member' | null) {
      const deleteCalls: unknown[][] = [];
      const supabaseAdmin = {
        from(table: string) {
          if (table !== 'team_members') throw new Error(`unexpected table ${table}`);
          // Two different chains off the same table: the role lookup (select) and the removal
          // (delete) — teams.ts calls them in that order within the one handler.
          return {
            select: () => chain({ data: callerRole ? { role: callerRole } : null, error: null }),
            delete: () => chain({ data: null, error: null }, deleteCalls),
          };
        },
      } as unknown as SupabaseClient<Database>;

      const broadcastUser = vi.fn(async () => {});
      const realtimeBus = { broadcastUser, broadcastRetro: vi.fn(async () => {}) } as unknown as RealtimeBus;

      return {
        deleteCalls,
        broadcastUser,
        build: () =>
          buildServer({
            webOrigin: 'http://localhost:5173',
            auth: { verifyAccessToken, supabaseAdmin, realtimeBus },
          }),
      };
    }

    it('an admin can remove a member, and the removed user is broadcast to', async () => {
      const harness = build('admin');
      app = await harness.build();
      const res = await app.inject({
        method: 'DELETE',
        url: `/teams/${teamId}/members/${targetUserId}`,
        headers: AUTH_HEADER,
      });

      expect(res.statusCode).toBe(204);
      expect(harness.deleteCalls).toEqual([
        ['eq', 'team_id', teamId],
        ['eq', 'user_id', targetUserId],
      ]);
      expect(harness.broadcastUser).toHaveBeenCalledWith(targetUserId, { type: 'removed', payload: { teamId } });
    });

    it('a plain member cannot remove another member', async () => {
      const harness = build('member');
      app = await harness.build();
      const res = await app.inject({
        method: 'DELETE',
        url: `/teams/${teamId}/members/${targetUserId}`,
        headers: AUTH_HEADER,
      });

      expect(res.statusCode).toBe(403);
      expect(harness.deleteCalls).toEqual([]);
      expect(harness.broadcastUser).not.toHaveBeenCalled();
    });
  });
});
