import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { actionItemCreateMutation } from './actionItemCreate.js';
import type { LockedRetro } from './registry.js';

const user = { id: '00000000-0000-4000-8000-000000000004', email: 'a@example.com', displayName: 'A', avatarUrl: null };
const actionItemId = '00000000-0000-4000-8000-000000000030';
const topicId = '00000000-0000-4000-8000-000000000010';
const ownerId = '00000000-0000-4000-8000-000000000005';

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

function actionItemRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: actionItemId,
    source_retro_id: '00000000-0000-4000-8000-000000000001',
    source_topic_id: null,
    title: 'Follow up with design',
    owner_id: null,
    due_date: null,
    status: 'open',
    origin: 'manual',
    completed_at: null,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

const basePayload = {
  id: actionItemId,
  title: 'Follow up with design',
  sourceTopicId: null,
  ownerId: null,
  dueDate: null,
  origin: 'manual' as const,
};

describe('actionItem.create', () => {
  it('creates a manual action item with no source topic — anyone, no ownership check', async () => {
    const query = vi.fn();
    query.mockResolvedValueOnce({ rows: [actionItemRow()] }); // insert ... returning
    const client = { query } as unknown as PoolClient;

    const result = await actionItemCreateMutation.apply({ client, retro: retroAt('wrap_up'), user, payload: basePayload });

    expect(result).toMatchObject({ actionItem: { id: actionItemId, title: 'Follow up with design', origin: 'manual', status: 'open' } });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('validates the source topic belongs to this retro when "Add as action item" is used', async () => {
    const query = vi.fn();
    query.mockResolvedValueOnce({ rows: [{ id: topicId }] }); // topic lookup
    query.mockResolvedValueOnce({ rows: [actionItemRow({ source_topic_id: topicId, origin: 'ai' })] }); // insert
    const client = { query } as unknown as PoolClient;

    const result = await actionItemCreateMutation.apply({
      client,
      retro: retroAt('discuss'),
      user,
      payload: { ...basePayload, sourceTopicId: topicId, origin: 'ai', ownerId },
    });

    expect(result).toMatchObject({ actionItem: { sourceTopicId: topicId, origin: 'ai' } });
  });

  it('rejects an unknown source topic', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });
    const client = { query } as unknown as PoolClient;

    await expect(
      actionItemCreateMutation.apply({ client, retro: retroAt('discuss'), user, payload: { ...basePayload, sourceTopicId: topicId } }),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' });
  });

  it('rejects outside Review, Discuss and Wrap up', async () => {
    for (const phase of ['write', 'group', 'vote', 'setup', 'closed']) {
      const client = { query: vi.fn() } as unknown as PoolClient;
      await expect(actionItemCreateMutation.apply({ client, retro: retroAt(phase), user, payload: basePayload })).rejects.toMatchObject({
        status: 409,
        code: 'phase_not_allowed',
      });
    }
  });

  it('allows it in Review too — "Items created in Review count as this retro\'s items"', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [actionItemRow()] });
    const client = { query } as unknown as PoolClient;

    await expect(
      actionItemCreateMutation.apply({ client, retro: retroAt('review'), user, payload: basePayload }),
    ).resolves.toMatchObject({ actionItem: { sourceTopicId: null } });
  });
});
