import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';
import type { AuthClaims } from '../auth/index.js';
import { chain } from '../testUtils/supabaseChain.js';
import { testAuthOptions } from '../testUtils/testAuth.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const claims: AuthClaims = { sub: '00000000-0000-4000-8000-000000000001', email: 'p@example.com' };
const AUTH_HEADER = { authorization: 'Bearer good-token' };
const retroId = '00000000-0000-4000-8000-0000000000aa';
const teamId = '00000000-0000-4000-8000-0000000000bb';
const facilitatorId = '00000000-0000-4000-8000-000000000099';

function verifyAccessToken(token: string): Promise<AuthClaims> {
  if (token === 'good-token') return Promise.resolve(claims);
  throw new Error('invalid token');
}

function supabaseWith(opts: { phase?: string; topics?: { id: string; started_at: string | null; ended_at: string | null }[]; insertError?: unknown }) {
  const { phase = 'discuss', topics = [], insertError = null } = opts;
  const insertFn = vi.fn();
  const from = vi.fn((table: string) => {
    if (table === 'retros') return chain({ data: { team_id: teamId, facilitator_id: facilitatorId, phase }, error: null });
    if (table === 'team_members') return chain({ data: { role: 'member' }, error: null });
    if (table === 'topics') return chain({ data: topics, error: null });
    if (table === 'speech_activity') {
      const c = chain({ data: null, error: insertError });
      const originalInsert = c.insert;
      c.insert = (...args: unknown[]) => {
        insertFn(...args);
        return originalInsert(...args);
      };
      return c;
    }
    throw new Error(`unexpected table ${table}`);
  });
  return { from, insertFn };
}

describe('POST /retros/:id/speech-activity', () => {
  it('204s and does nothing for an empty interval list', async () => {
    const { from } = supabaseWith({});
    app = await buildServer({ webOrigin: 'http://localhost', auth: testAuthOptions({ verifyAccessToken, supabaseAdmin: { from } as never }) });
    const res = await app.inject({
      method: 'POST',
      url: `/retros/${retroId}/speech-activity`,
      headers: AUTH_HEADER,
      payload: { intervals: [] },
    });
    expect(res.statusCode).toBe(204);
  });

  it('rejects outside Discuss/Wrap up', async () => {
    const { from } = supabaseWith({ phase: 'vote' });
    app = await buildServer({ webOrigin: 'http://localhost', auth: testAuthOptions({ verifyAccessToken, supabaseAdmin: { from } as never }) });
    const res = await app.inject({
      method: 'POST',
      url: `/retros/${retroId}/speech-activity`,
      headers: AUTH_HEADER,
      payload: { intervals: [{ startMs: 0, endMs: 1000 }] },
    });
    expect(res.statusCode).toBe(409);
  });

  it('tags each interval to the topic it falls in and inserts it', async () => {
    const { from, insertFn } = supabaseWith({
      topics: [{ id: '00000000-0000-4000-8000-0000000000d1', started_at: '2026-01-01T00:00:00.000Z', ended_at: null }],
    });
    app = await buildServer({ webOrigin: 'http://localhost', auth: testAuthOptions({ verifyAccessToken, supabaseAdmin: { from } as never }) });
    const topicStartMs = new Date('2026-01-01T00:00:00.000Z').getTime();
    const res = await app.inject({
      method: 'POST',
      url: `/retros/${retroId}/speech-activity`,
      headers: AUTH_HEADER,
      payload: { intervals: [{ startMs: topicStartMs + 500, endMs: topicStartMs + 1500 }] },
    });
    expect(res.statusCode).toBe(204);
    expect(insertFn).toHaveBeenCalledWith([
      expect.objectContaining({
        retro_id: retroId,
        user_id: claims.sub,
        topic_id: '00000000-0000-4000-8000-0000000000d1',
        start_ms: topicStartMs + 500,
        end_ms: topicStartMs + 1500,
      }),
    ]);
  });

  it('500s when the insert fails', async () => {
    const { from } = supabaseWith({ insertError: new Error('boom') });
    app = await buildServer({ webOrigin: 'http://localhost', auth: testAuthOptions({ verifyAccessToken, supabaseAdmin: { from } as never }) });
    const res = await app.inject({
      method: 'POST',
      url: `/retros/${retroId}/speech-activity`,
      headers: AUTH_HEADER,
      payload: { intervals: [{ startMs: 0, endMs: 1000 }] },
    });
    expect(res.statusCode).toBe(500);
  });
});
