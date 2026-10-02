import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { noteUpsertMutation } from './noteUpsert.js';
import type { LockedRetro } from './registry.js';

const user = { id: '00000000-0000-4000-8000-000000000004', email: 'a@example.com', displayName: 'A', avatarUrl: null };
const topicId = '00000000-0000-4000-8000-000000000010';
const columnId = '00000000-0000-4000-8000-000000000020';

function retroAt(phase: string): LockedRetro {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    team_id: '00000000-0000-4000-8000-000000000002',
    facilitator_id: '00000000-0000-4000-8000-000000000003',
    phase,
    cards_revealed: true,
    phase_deadline: null,
    vote_budget: 3,
  };
}

function topicRow() {
  return {
    id: topicId,
    column_id: columnId,
    name: 'A topic',
    vote_count: 1,
    discussion_order: 'a0',
    started_at: new Date('2026-01-01T00:00:00.000Z'),
    ended_at: null,
    ai_group_summary_title: null,
    ai_group_summary: null,
    ai_discussion_questions: null,
  };
}

const payload = { topicId, body: 'Decided to try pairing more.' };

describe('note.upsert', () => {
  it('inserts notes for a topic with none yet, and anyone (no ownership check) may do it', async () => {
    const query = vi.fn();
    query.mockResolvedValueOnce({ rows: [{ id: topicId }] }); // topic lookup
    query.mockResolvedValueOnce({ rows: [{ body: payload.body }] }); // upsert ... returning body
    query.mockResolvedValueOnce({ rows: [topicRow()] }); // plain topic select
    const client = { query } as unknown as PoolClient;

    const result = await noteUpsertMutation.apply({ client, retro: retroAt('discuss'), user, payload });

    expect(result).toMatchObject({ topic: { id: topicId, notes: payload.body } });
  });

  it('overwrites existing notes (upsert, not append)', async () => {
    const query = vi.fn();
    query.mockResolvedValueOnce({ rows: [{ id: topicId }] });
    query.mockResolvedValueOnce({ rows: [{ body: 'Replaced body' }] });
    query.mockResolvedValueOnce({ rows: [topicRow()] });
    const client = { query } as unknown as PoolClient;

    const result = await noteUpsertMutation.apply({ client, retro: retroAt('wrap_up'), user, payload: { topicId, body: 'Replaced body' } });

    expect(result).toMatchObject({ topic: { notes: 'Replaced body' } });
    const upsertCall = (client.query as ReturnType<typeof vi.fn>).mock.calls[1] as unknown[];
    expect(upsertCall[0]).toContain('on conflict (topic_id) do update');
  });

  it('rejects an unknown topic', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });
    const client = { query } as unknown as PoolClient;
    await expect(noteUpsertMutation.apply({ client, retro: retroAt('discuss'), user, payload })).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });
  });

  it('rejects outside Discuss/Wrap up', async () => {
    for (const phase of ['review', 'write', 'group', 'vote', 'setup', 'closed']) {
      const client = { query: vi.fn() } as unknown as PoolClient;
      await expect(noteUpsertMutation.apply({ client, retro: retroAt(phase), user, payload })).rejects.toMatchObject({
        status: 409,
        code: 'phase_not_allowed',
      });
    }
  });

  it('allows it in Wrap up too, not just Discuss', async () => {
    const query = vi.fn();
    query.mockResolvedValueOnce({ rows: [{ id: topicId }] });
    query.mockResolvedValueOnce({ rows: [{ body: payload.body }] });
    query.mockResolvedValueOnce({ rows: [topicRow()] });
    const client = { query } as unknown as PoolClient;

    await expect(noteUpsertMutation.apply({ client, retro: retroAt('wrap_up'), user, payload })).resolves.toMatchObject({
      topic: { notes: payload.body },
    });
  });
});
