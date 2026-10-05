import { describe, expect, it, vi } from 'vitest';
import { runSuggestQuestionsJob, type SuggestQuestionsDeps } from './suggestQuestions.js';
import type { AnthropicMessagesClient } from './groupCards.js';

const topicId = '00000000-0000-4000-8000-000000000001';
const retroId = '00000000-0000-4000-8000-000000000002';

function fakeSupabase(topic: unknown = { retro_id: retroId, name: 'Deploys', ai_group_summary_title: null, ai_group_summary: null }) {
  const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
  return {
    from: vi.fn((table: string) => {
      if (table === 'topics') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: topic }) }) }),
          update,
        };
      }
      if (table === 'ai_usage') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
          upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  } as unknown as SuggestQuestionsDeps['supabaseAdmin'];
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

function baseDeps(overrides: Partial<SuggestQuestionsDeps> = {}): SuggestQuestionsDeps {
  return {
    supabaseAdmin: fakeSupabase(),
    realtimeBus: { broadcastRetro: vi.fn() },
    anthropicApiKey: 'sk-test',
    monthlyCapUsd: undefined,
    logger: { info: vi.fn(), error: vi.fn() },
    ...overrides,
  };
}

describe('runSuggestQuestionsJob', () => {
  it('skips entirely when there is no API key', async () => {
    const supabaseAdmin = fakeSupabase();
    await runSuggestQuestionsJob({ topicId }, baseDeps({ supabaseAdmin, anthropicApiKey: undefined }));
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it('skips entirely when the monthly AI spend cap is already reached', async () => {
    const supabaseAdmin = {
      from: vi.fn((table: string) => {
        if (table === 'ai_usage') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { total_cost_usd: '5.0000' } }) }) }) };
        throw new Error(`unexpected table ${table}`);
      }),
    } as unknown as SuggestQuestionsDeps['supabaseAdmin'];
    const anthropic = fakeAnthropic(JSON.stringify({ questions: ['Why?'] }));
    await runSuggestQuestionsJob({ topicId }, baseDeps({ supabaseAdmin, monthlyCapUsd: 5, createAnthropicClient: () => anthropic }));
    expect(anthropic.messages.create).not.toHaveBeenCalled();
  });

  it('stores and broadcasts questions to the shared retro channel', async () => {
    const anthropic = fakeAnthropic(JSON.stringify({ questions: ['Why are deploys slow?', 'What changed recently?'] }));
    const deps = baseDeps({ createAnthropicClient: () => anthropic });
    await runSuggestQuestionsJob({ topicId }, deps);

    expect(deps.realtimeBus.broadcastRetro).toHaveBeenCalledWith(retroId, {
      type: 'topic.questionsReady',
      payload: { topicId, questions: ['Why are deploys slow?', 'What changed recently?'] },
    });
  });

  it('falls back to the topic name when group-summarizer has not produced a summary yet', async () => {
    const anthropic = fakeAnthropic(JSON.stringify({ questions: ['Why?'] }));
    const deps = baseDeps({ createAnthropicClient: () => anthropic });
    await runSuggestQuestionsJob({ topicId }, deps);

    const prompt = (anthropic.messages.create as ReturnType<typeof vi.fn>).mock.calls[0]![0].messages[0].content as string;
    expect(prompt).toContain('Deploys');
  });

  it('prefers the group summary over the bare topic name when one exists', async () => {
    const topic = { retro_id: retroId, name: 'Deploys', ai_group_summary_title: 'Slow pipeline', ai_group_summary: 'Deploys are slow.' };
    const anthropic = fakeAnthropic(JSON.stringify({ questions: ['Why?'] }));
    const deps = baseDeps({ supabaseAdmin: fakeSupabase(topic), createAnthropicClient: () => anthropic });
    await runSuggestQuestionsJob({ topicId }, deps);

    const prompt = (anthropic.messages.create as ReturnType<typeof vi.fn>).mock.calls[0]![0].messages[0].content as string;
    expect(prompt).toContain('Slow pipeline: Deploys are slow.');
  });

  it('retries once on invalid output, then gives up silently', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'not json' }], usage: { input_tokens: 1, output_tokens: 1 } })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'still not json' }], usage: { input_tokens: 1, output_tokens: 1 } });
    const anthropic: AnthropicMessagesClient = { messages: { create } };
    const deps = baseDeps({ createAnthropicClient: () => anthropic });
    await runSuggestQuestionsJob({ topicId }, deps);

    expect(create).toHaveBeenCalledTimes(2);
    expect(deps.realtimeBus.broadcastRetro).not.toHaveBeenCalled();
  });

  it('rejects more than 3 questions, keeping Zod\'s own contract honest', async () => {
    const anthropic = fakeAnthropic(JSON.stringify({ questions: ['a', 'b', 'c', 'd'] }));
    const deps = baseDeps({ createAnthropicClient: () => anthropic });
    await runSuggestQuestionsJob({ topicId }, deps);
    expect(deps.realtimeBus.broadcastRetro).not.toHaveBeenCalled();
  });
});
