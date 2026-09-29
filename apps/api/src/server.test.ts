import { afterEach, describe, expect, it } from 'vitest';
import { HealthResponse } from '@retronoodle/shared';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './server.js';

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
});
