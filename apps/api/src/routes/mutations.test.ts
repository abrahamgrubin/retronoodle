import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@retronoodle/shared';
import { buildServer } from '../server.js';
import type { AuthClaims } from '../auth/index.js';
import { testAuthOptions } from '../testUtils/testAuth.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const userA: AuthClaims = { sub: '00000000-0000-4000-8000-0000000000a1', email: 'a@example.com' };
const userB: AuthClaims = { sub: '00000000-0000-4000-8000-0000000000b1', email: 'b@example.com' };
const retroId = '00000000-0000-4000-8000-000000000001';

async function verifyAccessToken(token: string): Promise<AuthClaims> {
  if (token === 'token-a') return userA;
  if (token === 'token-b') return userB;
  throw new Error('invalid token');
}

// Rejections in these tests happen at validation time (unknown mutation type), before
// pool.connect() is ever called — a poisoned pool proves that.
const poisonedPool = {
  connect: () => {
    throw new Error('pool.connect() should not be called for a request that fails validation');
  },
} as unknown as Pool;

function build() {
  const supabaseAdmin = {} as SupabaseClient<Database>;
  return buildServer({
    webOrigin: 'http://localhost:5173',
    auth: testAuthOptions({ verifyAccessToken, supabaseAdmin, pool: poisonedPool }),
  });
}

describe('POST /retros/:id/mutations', () => {
  it('returns 401 with no Authorization header', async () => {
    app = await build();
    const res = await app.inject({ method: 'POST', url: `/retros/${retroId}/mutations`, payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 for an unregistered mutation type', async () => {
    app = await build();
    const res = await app.inject({
      method: 'POST',
      url: `/retros/${retroId}/mutations`,
      headers: { authorization: 'Bearer token-a' },
      payload: { mutationId: '00000000-0000-4000-8000-000000000099', type: 'nonexistent.type', payload: {} },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'unknown_mutation_type' });
  });

  it('returns 400 for a malformed envelope', async () => {
    app = await build();
    const res = await app.inject({
      method: 'POST',
      url: `/retros/${retroId}/mutations`,
      headers: { authorization: 'Bearer token-a' },
      payload: { type: 'card.create' }, // missing mutationId
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_mutation');
  });

  it('rate-limits at 20/s per user, keyed on the authenticated user, not shared by IP', async () => {
    app = await build();
    const badPayload = { mutationId: '00000000-0000-4000-8000-000000000099', type: 'nonexistent.type', payload: {} };

    // 20 requests from user A, from one IP, all land inside the window and are not rate-limited
    // (each still 400s — that's the validation rejection, not the rate limiter).
    for (let i = 0; i < 20; i++) {
      const res = await app.inject({
        method: 'POST',
        url: `/retros/${retroId}/mutations`,
        headers: { authorization: 'Bearer token-a' },
        payload: badPayload,
        remoteAddress: '203.0.113.1',
      });
      expect(res.statusCode).toBe(400);
    }

    // The 21st request from user A, same second, is rate-limited.
    const limited = await app.inject({
      method: 'POST',
      url: `/retros/${retroId}/mutations`,
      headers: { authorization: 'Bearer token-a' },
      payload: badPayload,
      remoteAddress: '203.0.113.1',
    });
    expect(limited.statusCode).toBe(429);

    // User B, from the SAME IP, is not affected — proves the bucket is keyed by user, not IP.
    // (If keyGenerator ever regresses to seeing an unset request.user and falling back to the
    // IP, this is exactly the case that would start failing.)
    const otherUser = await app.inject({
      method: 'POST',
      url: `/retros/${retroId}/mutations`,
      headers: { authorization: 'Bearer token-b' },
      payload: badPayload,
      remoteAddress: '203.0.113.1',
    });
    expect(otherUser.statusCode).toBe(400);
  });
});
