import { describe, expect, it } from 'vitest';
import { redactForLogging, REDACTED } from './redact.js';

describe('redactForLogging', () => {
  it('redacts card text, notes and summary fields by key, anywhere in the object', () => {
    const input = {
      err: { message: 'insert failed' },
      card: { id: 'c1', body: 'The deploy pipeline is broken and nobody noticed for a week' },
      notes: 'Decided to pair more on Fridays',
      summary: {
        keyPoints: [{ text: 'We shipped late again', sources: ['c1'] }],
        decisions: [{ text: 'Pair more', sources: [] }],
        disagreements: [{ text: 'Some thought Fridays were a bad day', sources: [] }],
        proposedActionItems: [{ text: 'Automate the deploy checklist', sources: [] }],
      },
      topic: { groupSummaryTitle: 'Deploys', groupSummary: 'Deploys are flaky', discussionQuestions: ['Why?'] },
      actionItem: { title: 'Fix the flaky deploy' },
    };

    const result = redactForLogging(input) as Record<string, unknown>;

    expect((result.card as Record<string, unknown>).body).toBe(REDACTED);
    expect(result.notes).toBe(REDACTED);
    const summary = result.summary as Record<string, unknown>;
    expect(summary.keyPoints).toBe(REDACTED);
    expect(summary.decisions).toBe(REDACTED);
    expect(summary.disagreements).toBe(REDACTED);
    expect(summary.proposedActionItems).toBe(REDACTED);
    const topic = result.topic as Record<string, unknown>;
    expect(topic.groupSummaryTitle).toBe(REDACTED);
    expect(topic.groupSummary).toBe(REDACTED);
    expect(topic.discussionQuestions).toBe(REDACTED);
    expect((result.actionItem as Record<string, unknown>).title).toBe(REDACTED);

    // None of the forbidden text survives anywhere in the serialized output.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('deploy pipeline is broken');
    expect(serialized).not.toContain('pair more on Fridays');
    expect(serialized).not.toContain('shipped late');
    expect(serialized).not.toContain('Fix the flaky deploy');
  });

  it('redacts credential-shaped fields', () => {
    const input = {
      headers: { authorization: 'Bearer secret-token', cookie: 'session=abc' },
      user: { password: 'hunter2', accessToken: 'at_123', refreshToken: 'rt_456', apiKey: 'sk-xyz' },
      config: { serviceRoleKey: 'service-role-secret' },
      retro: { joinCode: 'abc123xyz' },
    };

    const result = redactForLogging(input) as Record<string, unknown>;
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('session=abc');
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('at_123');
    expect(serialized).not.toContain('rt_456');
    expect(serialized).not.toContain('sk-xyz');
    expect(serialized).not.toContain('service-role-secret');
    expect(serialized).not.toContain('abc123xyz');
  });

  it('redacts inside arrays and nested arrays of objects', () => {
    const input = { cards: [{ body: 'first card text' }, { body: 'second card text' }] };
    const serialized = JSON.stringify(redactForLogging(input));
    expect(serialized).not.toContain('first card text');
    expect(serialized).not.toContain('second card text');
  });

  it('preserves an Error instance\'s message, and redacts its own extra enumerable fields (Postgres-style detail)', () => {
    const err = new Error('duplicate key value violates unique constraint') as Error & { detail?: string; code?: string };
    err.detail = 'Key (body)=(some card text) already exists.';
    err.code = '23505';

    const result = redactForLogging({ err }) as { err: Record<string, unknown> };
    expect(result.err.message).toBe('duplicate key value violates unique constraint');
    expect(result.err.detail).toBe(REDACTED);
    expect(result.err.code).toBe('23505'); // not a sensitive key — preserved for debugging
  });

  it('redacts a plain (non-Error) PostgREST-style error object by key, same as any other object', () => {
    const err = { message: 'ok', details: 'fine', hint: null, code: '42P01', detail: 'Key (title)=(leaked) exists' };
    const result = redactForLogging({ err }) as { err: Record<string, unknown> };
    expect(result.err.detail).toBe(REDACTED);
    expect(result.err.message).toBe('ok'); // not in the denylist
  });

  it('leaves non-redactable values (primitives, null, a live-object-like class instance) untouched', () => {
    expect(redactForLogging('a plain string')).toBe('a plain string');
    expect(redactForLogging(42)).toBe(42);
    expect(redactForLogging(null)).toBeNull();
    expect(redactForLogging(undefined)).toBeUndefined();

    class FakeRequest {
      body = { body: 'should never be reached — this class is not plain-object-prototyped' };
    }
    const req = new FakeRequest();
    expect(redactForLogging(req)).toBe(req); // untouched, not walked into
  });

  it('handles circular references without looping forever', () => {
    const obj: Record<string, unknown> = { body: 'secret text' };
    obj.self = obj;
    const result = redactForLogging(obj) as Record<string, unknown>;
    expect(result.body).toBe(REDACTED);
    expect(result.self).toBe('[circular]');
  });
});
