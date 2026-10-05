import { afterEach, describe, expect, it } from 'vitest';
import { HealthResponse, MeResponse, type Database } from '@retronoodle/shared';
import type { FastifyInstance } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildServer } from './server.js';
import type { AuthClaims } from './auth/index.js';
import type { RealtimeBus } from './realtime/RealtimeBus.js';
import { testAuthOptions } from './testUtils/testAuth.js';

const noopRealtimeBus = { broadcastRetro: async () => {}, broadcastUser: async () => {} } as unknown as RealtimeBus;

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /health', () => {
  it('returns 200 with { ok: true, time }', async () => {
    app = await buildServer({ webOrigin: 'http://localhost:5173' });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = HealthResponse.parse(res.json());
    expect(body.ok).toBe(true);
    expect(Number.isNaN(Date.parse(body.time))).toBe(false);
  });

  it('includes serverTime on every object-shaped response (RN-012)', async () => {
    app = await buildServer({ webOrigin: 'http://localhost:5173' });
    const res = await app.inject({ method: 'GET', url: '/health' });
    const raw = res.json() as { serverTime?: unknown };
    expect(typeof raw.serverTime).toBe('string');
    expect(Number.isNaN(Date.parse(raw.serverTime as string))).toBe(false);
  });

  it('allows only the configured web origin', async () => {
    app = await buildServer({ webOrigin: 'https://retronoodle.com' });
    const allowed = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://retronoodle.com' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe('https://retronoodle.com');

    const other = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://evil.example' },
    });
    expect(other.headers['access-control-allow-origin']).not.toBe('https://evil.example');
  });

  // RN-027: "per-user and per-IP rate limits" — a global 300/minute baseline on every route,
  // distinct from routes/mutations.ts's own stricter, encapsulated 20/s-per-user limit on that
  // one route specifically. Keyed the same way (user if authenticated, else IP) — here always IP,
  // since /health has no auth.
  it('rate-limits at 300/minute per IP, globally, on an unauthenticated route', async () => {
    app = await buildServer({ webOrigin: 'http://localhost:5173' });

    for (let i = 0; i < 300; i++) {
      const res = await app.inject({ method: 'GET', url: '/health', remoteAddress: '203.0.113.5' });
      expect(res.statusCode).toBe(200);
    }

    const limited = await app.inject({ method: 'GET', url: '/health', remoteAddress: '203.0.113.5' });
    expect(limited.statusCode).toBe(429);

    // A different IP is unaffected — proves the bucket is keyed per-IP, not shared globally.
    const otherIp = await app.inject({ method: 'GET', url: '/health', remoteAddress: '203.0.113.6' });
    expect(otherIp.statusCode).toBe(200);
  }, 10000);
});

describe('GET /me', () => {
  const claims: AuthClaims = {
    sub: '00000000-0000-4000-8000-000000000001',
    email: 'ada@example.com',
    user_metadata: { full_name: 'Ada Lovelace', avatar_url: 'https://example.com/ada.png' },
  };

  function buildAuthedServer() {
    const upsertCalls: unknown[] = [];
    const supabaseAdmin = {
      from() {
        return {
          upsert(payload: unknown) {
            upsertCalls.push(payload);
            return {
              select() {
                return {
                  async single() {
                    return {
                      data: {
                        id: claims.sub,
                        display_name: 'Ada Lovelace',
                        email: 'ada@example.com',
                        avatar_url: 'https://example.com/ada.png',
                        timezone: (payload as { timezone: string }).timezone,
                        created_at: new Date().toISOString(),
                      },
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      },
    } as unknown as SupabaseClient<Database>;

    const auth = testAuthOptions({
      async verifyAccessToken(token) {
        if (token !== 'good-token') throw new Error('invalid token');
        return claims;
      },
      supabaseAdmin,
      realtimeBus: noopRealtimeBus,
    });

    return { upsertCalls, build: () => buildServer({ webOrigin: 'http://localhost:5173', auth }) };
  }

  it('returns 401 with no Authorization header', async () => {
    app = await buildAuthedServer().build();
    const res = await app.inject({ method: 'GET', url: '/me' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 for a token that fails verification', async () => {
    app = await buildAuthedServer().build();
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('upserts the profile using the X-Timezone header and returns it', async () => {
    const harness = buildAuthedServer();
    app = await harness.build();
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: 'Bearer good-token', 'x-timezone': 'America/New_York' },
    });

    expect(res.statusCode).toBe(200);
    const body = MeResponse.parse(res.json());
    expect(body.id).toBe(claims.sub);
    expect(body.displayName).toBe('Ada Lovelace');
    expect(body.avatarUrl).toBe('https://example.com/ada.png');
    expect(body.timezone).toBe('America/New_York');
    expect(harness.upsertCalls[0]).toMatchObject({
      id: claims.sub,
      display_name: 'Ada Lovelace',
      timezone: 'America/New_York',
    });
  });

  it('defaults to UTC when no X-Timezone header is sent', async () => {
    const harness = buildAuthedServer();
    app = await harness.build();
    await app.inject({ method: 'GET', url: '/me', headers: { authorization: 'Bearer good-token' } });
    expect(harness.upsertCalls[0]).toMatchObject({ timezone: 'UTC' });
  });

  it('is not registered when the server has no auth configured', async () => {
    app = await buildServer({ webOrigin: 'http://localhost:5173' });
    const res = await app.inject({ method: 'GET', url: '/me' });
    expect(res.statusCode).toBe(404);
  });
});
