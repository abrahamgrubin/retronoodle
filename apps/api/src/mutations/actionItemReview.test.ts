import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { actionItemReviewMutation } from './actionItemReview.js';
import type { LockedRetro } from './registry.js';

const user = { id: '00000000-0000-4000-8000-000000000004', email: 'a@example.com', displayName: 'A', avatarUrl: null };
const actionItemId = '00000000-0000-4000-8000-000000000030';
const priorRetroId = '00000000-0000-4000-8000-000000000050';

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
    source_retro_id: priorRetroId,
    source_topic_id: null,
    title: 'Carried item',
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

const basePayload = { actionItemId, outcome: 'carried' as const };

describe('actionItem.review', () => {
  it('"Keep open" (carried) never touches status, just upserts the review row', async () => {
    const query = vi.fn();
    query.mockResolvedValueOnce({ rows: [{ status: 'open', source_retro_id: priorRetroId }] }); // lookup
    query.mockResolvedValueOnce({ rows: [] }); // review upsert
    query.mockResolvedValueOnce({ rows: [actionItemRow()] }); // final select
    const client = { query } as unknown as PoolClient;

    const result = await actionItemReviewMutation.apply({ client, retro: retroAt('review'), user, payload: basePayload });

    expect(result).toMatchObject({ outcome: 'carried', actionItem: { status: 'open' } });
    expect(query).toHaveBeenCalledTimes(3); // no status-change/history insert
    const upsertCall = query.mock.calls[1] as unknown[];
    expect(upsertCall[0]).toContain('on conflict (action_item_id, retro_id)');
    expect(upsertCall[1]).toEqual([actionItemId, retroAt('review').id, 'carried', user.id]);
  });

  it('"Done" stamps status/completed_at, logs the status change, and records the review outcome', async () => {
    const query = vi.fn();
    query.mockResolvedValueOnce({ rows: [{ status: 'open', source_retro_id: priorRetroId }] });
    query.mockResolvedValueOnce({ rows: [] }); // status update
    query.mockResolvedValueOnce({ rows: [] }); // status_changes insert
    query.mockResolvedValueOnce({ rows: [] }); // review upsert
    query.mockResolvedValueOnce({ rows: [actionItemRow({ status: 'done', completed_at: new Date('2026-01-02T00:00:00.000Z') })] });
    const client = { query } as unknown as PoolClient;

    const result = await actionItemReviewMutation.apply({
      client,
      retro: retroAt('review'),
      user,
      payload: { actionItemId, outcome: 'done' },
    });

    expect(result).toMatchObject({ outcome: 'done', actionItem: { status: 'done', completedAt: expect.any(String) } });
    const statusUpdateCall = query.mock.calls[1] as unknown[];
    expect(statusUpdateCall[0]).toContain('set status');
    expect(statusUpdateCall[1]).toEqual(['done', expect.any(Date), actionItemId]);
    const historyCall = query.mock.calls[2] as unknown[];
    expect(historyCall[0]).toContain('action_item_status_changes');
    expect(historyCall[1]).toEqual([actionItemId, 'open', 'done', user.id]);
  });

  it('"Drop" and "In progress" also update status, with no completed_at', async () => {
    for (const outcome of ['in_progress', 'dropped'] as const) {
      const query = vi.fn();
      query.mockResolvedValueOnce({ rows: [{ status: 'open', source_retro_id: priorRetroId }] });
      query.mockResolvedValueOnce({ rows: [] });
      query.mockResolvedValueOnce({ rows: [] });
      query.mockResolvedValueOnce({ rows: [] });
      query.mockResolvedValueOnce({ rows: [actionItemRow({ status: outcome })] });
      const client = { query } as unknown as PoolClient;

      await actionItemReviewMutation.apply({ client, retro: retroAt('review'), user, payload: { actionItemId, outcome } });
      const statusUpdateCall = query.mock.calls[1] as unknown[];
      expect(statusUpdateCall[1]).toEqual([outcome, null, actionItemId]);
    }
  });

  it('rejects an item that belongs to this retro — nothing to review for a brand-new item', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ status: 'open', source_retro_id: retroAt('review').id }] });
    const client = { query } as unknown as PoolClient;

    await expect(
      actionItemReviewMutation.apply({ client, retro: retroAt('review'), user, payload: basePayload }),
    ).rejects.toMatchObject({ status: 400, code: 'not_reviewable' });
  });

  it('rejects an unknown item', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });
    const client = { query } as unknown as PoolClient;

    await expect(
      actionItemReviewMutation.apply({ client, retro: retroAt('review'), user, payload: basePayload }),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' });
  });

  it('rejects outside Review', async () => {
    for (const phase of ['write', 'group', 'vote', 'discuss', 'wrap_up', 'setup', 'closed']) {
      const client = { query: vi.fn() } as unknown as PoolClient;
      await expect(
        actionItemReviewMutation.apply({ client, retro: retroAt(phase), user, payload: basePayload }),
      ).rejects.toMatchObject({ status: 409, code: 'phase_not_allowed' });
    }
  });
});
