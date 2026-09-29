import { describe, expect, it } from 'vitest';
import { HealthResponse, parseRole, startsApi, startsWorker } from './index.js';

describe('parseRole', () => {
  it('defaults to all', () => {
    expect(parseRole(undefined)).toBe('all');
  });

  it('accepts api, worker and all', () => {
    expect(parseRole('api')).toBe('api');
    expect(parseRole('worker')).toBe('worker');
    expect(parseRole('all')).toBe('all');
  });

  it('rejects anything else', () => {
    expect(() => parseRole('web')).toThrow(/Invalid ROLE/);
  });
});

describe('role predicates', () => {
  it('api starts only the API', () => {
    expect(startsApi('api')).toBe(true);
    expect(startsWorker('api')).toBe(false);
  });

  it('worker starts only the worker', () => {
    expect(startsApi('worker')).toBe(false);
    expect(startsWorker('worker')).toBe(true);
  });

  it('all starts both', () => {
    expect(startsApi('all')).toBe(true);
    expect(startsWorker('all')).toBe(true);
  });
});

describe('HealthResponse', () => {
  it('accepts a valid body', () => {
    expect(HealthResponse.parse({ ok: true, time: new Date().toISOString() }).ok).toBe(true);
  });

  it('rejects ok: false', () => {
    expect(HealthResponse.safeParse({ ok: false, time: new Date().toISOString() }).success).toBe(false);
  });
});
