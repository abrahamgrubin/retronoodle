import { describe, expect, it, vi } from 'vitest';
import { runSummarizeGroupJob, type SummarizeGroupDeps } from './summarizeGroup.js';
import type { AnthropicMessagesClient } from './groupCards.js';

const topicId = '00000000-0000-4000-8000-000000000001';
const retroId = '00000000-0000-4000-8000-000000000002';
const authorId = '00000000-0000-4000-8000-000000000003';

function fakeSupabase(opts: { topic?: unknown; cards?: unknown[]; authors?: unknown[] } = {}) {
  const {
    topic = { retro_id: retroId },
    cards = [
      { body: 'Deploys are slow', author_id: authorId },
      { body: 'The pipeline takes forever', author_id: authorId },
    ],
    authors = [{ id: authorId, display_name: 'Ada' }],
  } = opts;

  const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });

  return {
    from: vi.fn((table: string) => {
      if (table === 'topics') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: topic }) }) }),
          update,
        };
      }
      if (table === 'cards') {
        return { select: () => ({ eq: async () => ({ data: cards }) }) };
      }
      if (table === 'profiles') {
        return { select: () => ({ in: async () => ({ data: authors }) }) };
      }
      if (table === 'ai_usage') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
          upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  } as unknown as SummarizeGroupDeps['supabaseAdmin'];
}

function fakeAnthropic(responseText: string): AnthropicMessagesClient {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: responseText }],
        usage: { input_tokens: 50, output_tokens: 10 },
      }),
    },
  };
}

function baseDeps(overrides: Partial<SummarizeGroupDeps> = {}): SummarizeGroupDeps {
  return {
    supabaseAdmin: fakeSupabase(),
    realtimeBus: { broadcastRetro: vi.fn() },
    anthropicApiKey: 'sk-test',
    monthlyCapUsd: undefined,
    logger: { info: vi.fn(), error: vi.fn() },
    ...overrides,
  };
}

describe('runSummarizeGroupJob', () => {
  it('skips entirely when there is no API key', async () => {
    const supabaseAdmin = fakeSupabase();
    await runSummarizeGroupJob({ topicId }, baseDeps({ supabaseAdmin, anthropicApiKey: undefined }));
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it('skips entirely when the monthly AI spend cap is already reached', async () => {
    const supabaseAdmin = {
      from: vi.fn((table: string) => {
        if (table === 'ai_usage') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { total_cost_usd: '5.0000' } }) }) }) };
        throw new Error(`unexpected table ${table}`);
      }),
    } as unknown as SummarizeGroupDeps['supabaseAdmin'];
    const anthropic = fakeAnthropic(JSON.stringify({ title: 'T', summary: 'S' }));
    await runSummarizeGroupJob({ topicId }, baseDeps({ supabaseAdmin, monthlyCapUsd: 5, createAnthropicClient: () => anthropic }));
    expect(anthropic.messages.create).not.toHaveBeenCalled();
  });

  it('does nothing when the topic has no cards', async () => {
    const anthropic = fakeAnthropic(JSON.stringify({ title: 'T', summary: 'S' }));
    const supabaseAdmin = fakeSupabase({ cards: [] });
    const deps = baseDeps({ supabaseAdmin, createAnthropicClient: () => anthropic });
    await runSummarizeGroupJob({ topicId }, deps);
    expect(anthropic.messages.create).not.toHaveBeenCalled();
  });

  it('stores and broadcasts a valid summary to the shared retro channel', async () => {
    const anthropic = fakeAnthropic(JSON.stringify({ title: 'Slow pipeline', summary: 'Deploys are slow, written by Ada.' }));
    const deps = baseDeps({ createAnthropicClient: () => anthropic });
    await runSummarizeGroupJob({ topicId }, deps);

    expect(deps.realtimeBus.broadcastRetro).toHaveBeenCalledWith(retroId, {
      type: 'topic.groupSummaryReady',
      payload: { topicId, title: 'Slow pipeline', summary: 'Deploys are slow, written by Ada.' },
    });
  });

  it('retries once on invalid output, then gives up silently', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'not json' }], usage: { input_tokens: 1, output_tokens: 1 } })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'still not json' }], usage: { input_tokens: 1, output_tokens: 1 } });
    const anthropic: AnthropicMessagesClient = { messages: { create } };
    const deps = baseDeps({ createAnthropicClient: () => anthropic });
    await runSummarizeGroupJob({ topicId }, deps);

    expect(create).toHaveBeenCalledTimes(2);
    expect(deps.realtimeBus.broadcastRetro).not.toHaveBeenCalled();
  });

  it('strips a markdown code fence if the model wraps its answer in one', async () => {
    const anthropic = fakeAnthropic('```json\n{"title": "T", "summary": "S"}\n```');
    const deps = baseDeps({ createAnthropicClient: () => anthropic });
    await runSummarizeGroupJob({ topicId }, deps);
    expect(deps.realtimeBus.broadcastRetro).toHaveBeenCalled();
  });

  it('logs token usage without ever including card text', async () => {
    const anthropic = fakeAnthropic(JSON.stringify({ title: 'T', summary: 'S' }));
    const logger = { info: vi.fn(), error: vi.fn() };
    const deps = baseDeps({ createAnthropicClient: () => anthropic, logger });
    await runSummarizeGroupJob({ topicId }, deps);

    const usageLog = logger.info.mock.calls.map((c) => c[0] as string).find((msg) => msg.includes('ai usage'));
    expect(usageLog).toContain('in=50');
    expect(usageLog).not.toContain('Deploys are slow');
  });
});
