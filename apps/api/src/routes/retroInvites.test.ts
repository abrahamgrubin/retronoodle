import { afterEach, describe, expect, it } from 'vitest';
import type { Database } from '@retronoodle/shared';
import type { FastifyInstance } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptJoinCode, EMAIL_RETRO_INVITE_QUEUE, type RetroInviteJob } from '@retronoodle/worker';
import { buildServer } from '../server.js';
import type { AuthClaims } from '../auth/index.js';
import { chain } from '../testUtils/supabaseChain.js';
import { testAuthOptions } from '../testUtils/testAuth.js';
import { hashJoinCode } from '../joinCode.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const facilitatorId = '00000000-0000-4000-8000-000000000001';
const claims: AuthClaims = { sub: facilitatorId, email: 'ada@example.com' };
const AUTH_HEADER = { authorization: 'Bearer good-token' };
const retroId = '00000000-0000-4000-8000-0000000000bb';
const teamId = '00000000-0000-4000-8000-0000000000aa';
const bobId = '00000000-0000-4000-8000-000000000002';
const joinCode = 'the-plaintext-code';
const payloadKey = Buffer.alloc(32, 7);

const retroRow = {
  id: retroId,
  team_id: teamId,
  name: 'Sprint 1 retro',
  phase: 'write',
  facilitator_id: facilitatorId,
  join_code_hash: hashJoinCode(joinCode),
  deleted_at: null,
};

function verifyAccessToken(token: string): Promise<AuthClaims> {
  if (token !== 'good-token') throw new Error('invalid token');
  return Promise.resolve(claims);
}

function setup(opts: { retro?: Record<string, unknown>; withInvites?: boolean } = {}) {
  const sent: { queue: string; data: RetroInviteJob }[] = [];
  const supabaseAdmin = {
    from(table: string) {
      if (table === 'retros') return chain({ data: opts.retro ?? retroRow, error: null });
      if (table === 'team_members') return chain({ data: [{ user_id: bobId }], error: null });
      if (table === 'profiles') {
        // Honors `.in('id', ids)` like the real query, so only asked-for profiles come back.
        const all = [
          { id: facilitatorId, email: 'ada@example.com', display_name: 'Ada' },
          { id: bobId, email: 'Bob@Example.com', display_name: 'Bob' },
        ];
        const api = chain({ data: all, error: null });
        const terminal = { data: all, error: null as unknown };
        api.in = ((_col: string, ids: string[]) => {
          terminal.data = all.filter((p) => ids.includes(p.id));
          return api;
        }) as typeof api.in;
        api.then = ((resolve: (v: typeof terminal) => unknown) => Promise.resolve(resolve(terminal))) as typeof api.then;
        return api;
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient<Database>;
  const invites =
    opts.withInvites === false
      ? undefined
      : {
          jobs: {
            async send(queue: string, data: object) {
              sent.push({ queue, data: data as RetroInviteJob });
              return 'job-id';
            },
          },
          payloadKey,
        };
  return { sent, supabaseAdmin, invites };
}

async function post(body: unknown, opts?: Parameters<typeof setup>[0]) {
  const { sent, supabaseAdmin, invites } = setup(opts);
  app = await buildServer({
    webOrigin: 'http://localhost:5173',
    auth: testAuthOptions({ verifyAccessToken, supabaseAdmin, invites }),
  });
  const res = await app.inject({ method: 'POST', url: `/retros/${retroId}/invites`, headers: AUTH_HEADER, payload: body as object });
  return { res, sent };
}

describe('POST /retros/:id/invites', () => {
  it('queues one job per unique recipient, lowercased, never the facilitator, with the code encrypted', async () => {
    const { res, sent } = await post({
      joinCode,
      userIds: [bobId],
      emails: ['guest@other.com', 'BOB@example.com', 'ADA@example.com'],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ queued: 2, failed: 0 });
    expect(sent.map((s) => s.queue)).toEqual([EMAIL_RETRO_INVITE_QUEUE, EMAIL_RETRO_INVITE_QUEUE]);
    expect(sent.map((s) => s.data.to).sort()).toEqual(['bob@example.com', 'guest@other.com']);
    expect(sent[0]!.data.inviterName).toBe('Ada');
    expect(sent[0]!.data.retroName).toBe('Sprint 1 retro');
    // The plaintext code is not in the payload, but decrypts back with the key.
    expect(JSON.stringify(sent[0]!.data)).not.toContain(joinCode);
    expect(decryptJoinCode(payloadKey, sent[0]!.data.encryptedJoinCode)).toBe(joinCode);
  });

  it('accepts emails alone for people outside the team', async () => {
    const { res, sent } = await post({ joinCode, emails: ['guest@other.com'] });
    expect(res.statusCode).toBe(200);
    expect(sent).toHaveLength(1);
  });

  it('returns 409 stale_join_code when the code was regenerated', async () => {
    const { res, sent } = await post({ joinCode: 'an-old-code', emails: ['guest@other.com'] });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'stale_join_code' });
    expect(sent).toHaveLength(0);
  });

  it('returns 403 for someone who is not the facilitator', async () => {
    const { res, sent } = await post(
      { joinCode, emails: ['guest@other.com'] },
      { retro: { ...retroRow, facilitator_id: '00000000-0000-4000-8000-0000000000ff' } },
    );
    expect(res.statusCode).toBe(403);
    expect(sent).toHaveLength(0);
  });

  it('rejects a closed retro', async () => {
    const { res } = await post({ joinCode, emails: ['guest@other.com'] }, { retro: { ...retroRow, phase: 'closed' } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'retro_closed' });
  });

  it('rejects invalid email addresses', async () => {
    const { res } = await post({ joinCode, emails: ['not-an-email'] });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when nobody is left to email (only the facilitator)', async () => {
    const { res } = await post({ joinCode, emails: ['ada@example.com'] });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'no_recipients' });
  });

  it('returns 503 when email is not configured', async () => {
    const { res } = await post({ joinCode, emails: ['guest@other.com'] }, { withInvites: false });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'email_unavailable' });
  });
});

describe('GET /teams/:id/members', () => {
  it('lists teammates except the caller, with no email addresses', async () => {
    let teamMemberCalls = 0;
    const supabaseAdmin = {
      from(table: string) {
        // 1st read: the caller's own role (getTeamRole); 2nd: the team's member list.
        if (table === 'team_members') {
          return chain(teamMemberCalls++ === 0
            ? { data: { role: 'member' }, error: null }
            : { data: [{ user_id: facilitatorId }, { user_id: bobId }], error: null });
        }
        if (table === 'profiles') return chain({ data: [{ id: bobId, display_name: 'Bob', avatar_url: null }], error: null });
        throw new Error(`unexpected table ${table}`);
      },
    } as unknown as SupabaseClient<Database>;
    app = await buildServer({ webOrigin: 'http://localhost:5173', auth: testAuthOptions({ verifyAccessToken, supabaseAdmin }) });
    const res = await app.inject({ method: 'GET', url: `/teams/${teamId}/members`, headers: AUTH_HEADER });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ id: bobId, displayName: 'Bob', avatarUrl: null }]);
  });
});

describe('GET /teams/:id/members access', () => {
  it('returns 403 to a non-member', async () => {
    const supabaseAdmin = {
      from: () => chain({ data: null, error: null }),
    } as unknown as SupabaseClient<Database>;
    app = await buildServer({ webOrigin: 'http://localhost:5173', auth: testAuthOptions({ verifyAccessToken, supabaseAdmin }) });
    const res = await app.inject({ method: 'GET', url: `/teams/${teamId}/members`, headers: AUTH_HEADER });
    expect(res.statusCode).toBe(403);
  });
});
