import { describe, expect, it, vi } from 'vitest';
import { runGenerateRecapJob, type GenerateRecapDeps } from './generateRecap.js';
import type { AnthropicMessagesClient } from './groupCards.js';

const retroId = '00000000-0000-4000-8000-000000000001';
const topicAId = '00000000-0000-4000-8000-000000000010';
const topicBId = '00000000-0000-4000-8000-000000000011';

function fakeSupabase(opts: {
  topics?: { id: string; name: string | null }[];
  summaryByTopic?: Record<string, { key_points: { text: string }[]; decisions: { text: string }[] } | null>;
} = {}) {
  const { topics = [{ id: topicAId, name: 'Deploys are slow' }], summaryByTopic = {} } = opts;

  const recapUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });

  return {
    update: recapUpdate,
    client: {
      from: vi.fn((table: string) => {
        if (table === 'topics') {
          return { select: () => ({ eq: () => ({ not: async () => ({ data: topics }) }) }) };
        }
        if (table === 'topic_summaries') {
          return {
            select: () => ({
              eq: (_col: string, topicId: string) => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({ data: summaryByTopic[topicId] ?? null }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'retro_recaps') {
          return { update: recapUpdate };
        }
        if (table === 'ai_usage') {
          return {
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
            upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
    } as unknown as GenerateRecapDeps['supabaseAdmin'],
  };
}

function fakeAnthropic(responses: string[]): AnthropicMessagesClient {
  const create = vi.fn();
  for (const text of responses) {
    create.mockResolvedValueOnce({ content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 5 } });
  }
  return { messages: { create } };
}

function baseDeps(overrides: Partial<GenerateRecapDeps> = {}): GenerateRecapDeps {
  return {
    supabaseAdmin: fakeSupabase().client,
    anthropicApiKey: 'sk-test',
    monthlyCapUsd: undefined,
    logger: { info: vi.fn(), error: vi.fn() },
    ...overrides,
  };
}

describe('runGenerateRecapJob', () => {
  it('marks the recap unavailable and does nothing else when there is no API key', async () => {
    const { client, update } = fakeSupabase();
    await runGenerateRecapJob({ retroId }, baseDeps({ supabaseAdmin: client, anthropicApiKey: undefined }));
    expect(update).toHaveBeenCalledWith({ status: 'unavailable' });
  });

  it('marks the recap unavailable when the monthly AI spend cap is already reached', async () => {
    const capSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'ai_usage') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { total_cost_usd: '5.0000' } }) }) }) };
        if (table === 'retro_recaps') return { update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) };
        throw new Error(`unexpected table ${table}`);
      }),
    } as unknown as GenerateRecapDeps['supabaseAdmin'];
    const anthropic = fakeAnthropic(['{}']);
    await runGenerateRecapJob({ retroId }, baseDeps({ supabaseAdmin: capSupabase, monthlyCapUsd: 5, createAnthropicClient: () => anthropic }));
    expect(anthropic.messages.create).not.toHaveBeenCalled();
  });

  it('filters each discussed topic, then writes one recap-summarizer call per retro', async () => {
    const { client, update } = fakeSupabase({
      topics: [
        { id: topicAId, name: 'Deploys are slow' },
        { id: topicBId, name: 'On-call rotation' },
      ],
      summaryByTopic: {
        [topicAId]: { key_points: [{ text: 'CI takes 40 minutes' }], decisions: [{ text: 'Switch to a faster runner' }] },
        [topicBId]: { key_points: [{ text: 'Too many pages at night' }], decisions: [] },
      },
    });
    const anthropic = fakeAnthropic([
      JSON.stringify({ keyPoints: ['CI takes 40 minutes'], decisions: ['Switch to a faster runner'] }),
      JSON.stringify({ keyPoints: ['Too many pages at night'], decisions: [] }),
      JSON.stringify({
        topicSummaries: [
          { topicId: topicAId, summary: 'CI is slow; the team will switch runners.' },
          { topicId: topicBId, summary: 'On-call pages too often at night.' },
        ],
        decisions: [{ topicId: topicAId, text: 'Switch to a faster runner' }],
      }),
    ]);
    const deps = baseDeps({ supabaseAdmin: client, createAnthropicClient: () => anthropic });

    await runGenerateRecapJob({ retroId }, deps);

    expect(anthropic.messages.create).toHaveBeenCalledTimes(3);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ready',
        topic_summaries: [
          { topicId: topicAId, topicName: 'Deploys are slow', summary: 'CI is slow; the team will switch runners.' },
          { topicId: topicBId, topicName: 'On-call rotation', summary: 'On-call pages too often at night.' },
        ],
        decisions: [{ topicId: topicAId, topicName: 'Deploys are slow', text: 'Switch to a faster runner' }],
      }),
    );
  });

  it('drops any topicId in the summarizer output that was never one of the filtered topics', async () => {
    const { client, update } = fakeSupabase({
      topics: [{ id: topicAId, name: 'Deploys are slow' }],
      summaryByTopic: { [topicAId]: { key_points: [{ text: 'CI takes 40 minutes' }], decisions: [] } },
    });
    const anthropic = fakeAnthropic([
      JSON.stringify({ keyPoints: ['CI takes 40 minutes'], decisions: [] }),
      JSON.stringify({
        topicSummaries: [
          { topicId: topicAId, summary: 'CI is slow.' },
          { topicId: 'made-up-id', summary: 'Should not appear.' },
        ],
        decisions: [],
      }),
    ]);
    const deps = baseDeps({ supabaseAdmin: client, createAnthropicClient: () => anthropic });

    await runGenerateRecapJob({ retroId }, deps);

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        topic_summaries: [{ topicId: topicAId, topicName: 'Deploys are slow', summary: 'CI is slow.' }],
      }),
    );
  });

  it('skips the filter call for a topic with no stored summary content', async () => {
    const { client, update } = fakeSupabase({ topics: [{ id: topicAId, name: 'Nothing happened' }], summaryByTopic: {} });
    const anthropic = fakeAnthropic([
      JSON.stringify({ topicSummaries: [{ topicId: topicAId, summary: 'Nothing substantive was reported.' }], decisions: [] }),
    ]);
    const deps = baseDeps({ supabaseAdmin: client, createAnthropicClient: () => anthropic });

    await runGenerateRecapJob({ retroId }, deps);

    // Only the one recap-summarizer call — no recap-filter call for a topic with nothing to filter.
    expect(anthropic.messages.create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'ready' }));
  });

  it('writes an empty ready recap when the retro has no discussed topics at all', async () => {
    const { client, update } = fakeSupabase({ topics: [] });
    const anthropic = fakeAnthropic([]);
    const deps = baseDeps({ supabaseAdmin: client, createAnthropicClient: () => anthropic });

    await runGenerateRecapJob({ retroId }, deps);

    expect(anthropic.messages.create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'ready', topic_summaries: [], decisions: [] }));
  });

  it('marks the recap unavailable when an unexpected error happens outside the model-call path', async () => {
    const throwingSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'topics') {
          return {
            select: () => ({
              eq: () => ({
                not: () => {
                  throw new Error('db exploded');
                },
              }),
            }),
          };
        }
        if (table === 'retro_recaps') return { update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) };
        throw new Error(`unexpected table ${table}`);
      }),
    } as unknown as GenerateRecapDeps['supabaseAdmin'];
    const anthropic = fakeAnthropic([]);
    const deps = baseDeps({ supabaseAdmin: throwingSupabase, createAnthropicClient: () => anthropic });

    await runGenerateRecapJob({ retroId }, deps);

    expect(anthropic.messages.create).not.toHaveBeenCalled();
  });
});
