import { describe, expect, it, vi } from 'vitest';
import { runGroupCardsJob, type AnthropicMessagesClient, type GroupCardsDeps } from './groupCards.js';

const retroId = '00000000-0000-4000-8000-000000000001';
const facilitatorId = '00000000-0000-4000-8000-000000000002';
const columnId = '00000000-0000-4000-8000-000000000003';
const cardAId = '00000000-0000-4000-8000-000000000004';
const cardBId = '00000000-0000-4000-8000-000000000005';
const cardCId = '00000000-0000-4000-8000-000000000006';
const otherColumnId = '00000000-0000-4000-8000-000000000007';
const cardDId = '00000000-0000-4000-8000-000000000008';

function fakeSupabase(opts: { cards?: unknown[]; columns?: unknown[]; insertedIds?: string[] } = {}) {
  const {
    cards = [
      { id: cardAId, column_id: columnId, body: 'Deploys are slow' },
      { id: cardBId, column_id: columnId, body: 'The pipeline takes forever' },
      { id: cardCId, column_id: columnId, body: 'Great teamwork this sprint' },
    ],
    columns = [{ id: columnId, title: 'Mad' }],
    insertedIds = ['00000000-0000-4000-8000-0000000000aa'],
  } = opts;

  const insert = vi.fn().mockReturnValue({
    select: vi.fn().mockResolvedValue({
      data: insertedIds.map((id, i) => ({ id, name: `Group ${i}`, card_ids: [cardAId, cardBId] })),
      error: null,
    }),
  });

  return {
    from: vi.fn((table: string) => {
      if (table === 'retros') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { facilitator_id: facilitatorId } }) }) }) };
      }
      if (table === 'retro_columns') {
        return { select: () => ({ eq: () => ({ eq: async () => ({ data: columns }) }) }) };
      }
      if (table === 'cards') {
        return { select: () => ({ eq: () => ({ is: async () => ({ data: cards }) }) }) };
      }
      if (table === 'group_suggestions') {
        return { insert };
      }
      if (table === 'ai_usage') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
          upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  } as unknown as GroupCardsDeps['supabaseAdmin'];
}

function fakeAnthropic(responseText: string): AnthropicMessagesClient {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: responseText }],
        usage: { input_tokens: 100, output_tokens: 20 },
      }),
    },
  };
}

function baseDeps(overrides: Partial<GroupCardsDeps> = {}): GroupCardsDeps {
  return {
    supabaseAdmin: fakeSupabase(),
    realtimeBus: { broadcastUser: vi.fn() },
    anthropicApiKey: 'sk-test',
    monthlyCapUsd: undefined,
    logger: { info: vi.fn(), error: vi.fn() },
    ...overrides,
  };
}

describe('runGroupCardsJob', () => {
  it('skips entirely when there is no API key — "manual grouping still works"', async () => {
    const supabaseAdmin = fakeSupabase();
    await runGroupCardsJob({ retroId }, baseDeps({ supabaseAdmin, anthropicApiKey: undefined }));
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it('skips entirely when the monthly AI spend cap is already reached', async () => {
    const supabaseAdmin = {
      from: vi.fn((table: string) => {
        if (table === 'ai_usage') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { total_cost_usd: '5.0000' } }) }) }) };
        throw new Error(`unexpected table ${table}`);
      }),
    } as unknown as GroupCardsDeps['supabaseAdmin'];
    const anthropic = fakeAnthropic('[]');
    await runGroupCardsJob({ retroId }, baseDeps({ supabaseAdmin, monthlyCapUsd: 5, createAnthropicClient: () => anthropic }));
    expect(anthropic.messages.create).not.toHaveBeenCalled();
  });

  it('validates, stores and broadcasts a valid suggestion to the facilitator only', async () => {
    const anthropic = fakeAnthropic(JSON.stringify([{ name: 'Slow pipeline', cardIds: [cardAId, cardBId] }]));
    const deps = baseDeps({ createAnthropicClient: () => anthropic });
    await runGroupCardsJob({ retroId }, deps);

    expect(deps.realtimeBus.broadcastUser).toHaveBeenCalledWith(
      facilitatorId,
      expect.objectContaining({
        type: 'group.suggestions',
        payload: { suggestions: [expect.objectContaining({ name: 'Group 0', cardIds: [cardAId, cardBId], columnId })] },
      }),
    );
  });

  it('drops a suggestion that references an unknown card id, keeping the rest', async () => {
    const unknownId = '00000000-0000-4000-8000-000000000099';
    const anthropic = fakeAnthropic(
      JSON.stringify([
        { name: 'Bad group', cardIds: [cardAId, unknownId] },
        { name: 'Good group', cardIds: [cardBId, cardCId] },
      ]),
    );
    const supabaseAdmin = fakeSupabase();
    const deps = baseDeps({ supabaseAdmin, createAnthropicClient: () => anthropic });
    await runGroupCardsJob({ retroId }, deps);

    const insertCall = (supabaseAdmin.from as ReturnType<typeof vi.fn>).mock.results.find(
      (r, i) => (supabaseAdmin.from as ReturnType<typeof vi.fn>).mock.calls[i]?.[0] === 'group_suggestions',
    );
    expect(insertCall).toBeDefined();
    const insertedRows = insertCall!.value.insert.mock.calls[0][0];
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toMatchObject({ name: 'Good group', card_ids: [cardBId, cardCId] });
  });

  it('drops a suggestion that mixes columns', async () => {
    const cards = [
      { id: cardAId, column_id: columnId, body: 'A' },
      { id: cardDId, column_id: otherColumnId, body: 'D' },
    ];
    const columns = [
      { id: columnId, title: 'Mad' },
      { id: otherColumnId, title: 'Sad' },
    ];
    const anthropic = fakeAnthropic(JSON.stringify([{ name: 'Mixed', cardIds: [cardAId, cardDId] }]));
    const supabaseAdmin = fakeSupabase({ cards, columns });
    const deps = baseDeps({ supabaseAdmin, createAnthropicClient: () => anthropic });
    await runGroupCardsJob({ retroId }, deps);

    expect(deps.realtimeBus.broadcastUser).not.toHaveBeenCalled();
  });

  it('retries once on invalid (non-JSON) output, then gives up silently', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'not json at all' }], usage: { input_tokens: 1, output_tokens: 1 } })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'still not json' }], usage: { input_tokens: 1, output_tokens: 1 } });
    const anthropic: AnthropicMessagesClient = { messages: { create } };
    const deps = baseDeps({ createAnthropicClient: () => anthropic });
    await runGroupCardsJob({ retroId }, deps);

    expect(create).toHaveBeenCalledTimes(2);
    expect(deps.realtimeBus.broadcastUser).not.toHaveBeenCalled();
  });

  it('strips a markdown code fence if the model wraps its answer in one', async () => {
    const anthropic = fakeAnthropic('```json\n[{"name": "Fenced", "cardIds": ["' + cardAId + '", "' + cardBId + '"]}]\n```');
    const deps = baseDeps({ createAnthropicClient: () => anthropic });
    await runGroupCardsJob({ retroId }, deps);
    expect(deps.realtimeBus.broadcastUser).toHaveBeenCalled();
  });

  it('does nothing when fewer than two groupable cards exist', async () => {
    const supabaseAdmin = fakeSupabase({ cards: [{ id: cardAId, column_id: columnId, body: 'Only one' }] });
    const anthropic = fakeAnthropic('[]');
    const deps = baseDeps({ supabaseAdmin, createAnthropicClient: () => anthropic });
    await runGroupCardsJob({ retroId }, deps);
    expect(anthropic.messages.create).not.toHaveBeenCalled();
  });

  it('logs token usage without ever including card text', async () => {
    const anthropic = fakeAnthropic(JSON.stringify([{ name: 'Slow pipeline', cardIds: [cardAId, cardBId] }]));
    const logger = { info: vi.fn(), error: vi.fn() };
    const deps = baseDeps({ createAnthropicClient: () => anthropic, logger });
    await runGroupCardsJob({ retroId }, deps);

    const usageLog = logger.info.mock.calls.map((c) => c[0] as string).find((msg) => msg.includes('ai usage'));
    expect(usageLog).toContain('in=100');
    expect(usageLog).toContain('out=20');
    expect(usageLog).not.toContain('Deploys are slow');
  });
});
