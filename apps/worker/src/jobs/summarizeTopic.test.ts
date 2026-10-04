import { describe, expect, it, vi } from 'vitest';
import { runSummarizeTopicJob, type SummarizeTopicDeps } from './summarizeTopic.js';
import type { AnthropicMessagesClient } from './groupCards.js';

const topicId = '00000000-0000-4000-8000-000000000001';
const retroId = '00000000-0000-4000-8000-000000000002';
const teamId = '00000000-0000-4000-8000-000000000003';
const authorId = '00000000-0000-4000-8000-000000000004';
const cardAId = '00000000-0000-4000-8000-000000000005';
const cardBId = '00000000-0000-4000-8000-000000000006';
const insertedId = '00000000-0000-4000-8000-000000000007';

function thenable(result: { data: unknown; error?: unknown }) {
  const self: Record<string, unknown> = {
    select: () => self,
    eq: () => self,
    in: () => self,
    order: () => self,
    limit: () => self,
    maybeSingle: async () => result,
    single: async () => result,
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  return self;
}

interface FakeOpts {
  cards?: { id: string; body: string; author_id: string }[];
  noteBody?: string | null;
  openItemTitles?: string[];
  latestVersion?: number | null;
  insertError?: unknown;
}

function fakeSupabase(opts: FakeOpts = {}) {
  const {
    cards = [
      { id: cardAId, body: 'Deploys are slow', author_id: authorId },
      { id: cardBId, body: 'We agreed to add a staging env', author_id: authorId },
    ],
    noteBody = 'Team agreed to add a staging environment next sprint.',
    openItemTitles = [],
    latestVersion = null,
    insertError = null,
  } = opts;

  return {
    from: vi.fn((table: string) => {
      if (table === 'topics') return thenable({ data: { retro_id: retroId, name: 'Deploys' } });
      if (table === 'retros') return thenable({ data: { team_id: teamId } });
      if (table === 'cards') return thenable({ data: cards });
      if (table === 'profiles') return thenable({ data: [{ id: authorId, display_name: 'Ada' }] });
      if (table === 'topic_notes') return thenable({ data: noteBody === null ? null : { body: noteBody } });
      if (table === 'team_members') return thenable({ data: [{ user_id: authorId }] });
      if (table === 'action_items') return thenable({ data: openItemTitles.map((title) => ({ title })) });
      if (table === 'topic_summaries') {
        return {
          select: () => thenable({ data: latestVersion === null ? null : { version: latestVersion } }),
          insert: (row: Record<string, unknown>) => ({
            select: () => ({
              single: async () =>
                insertError
                  ? { data: null, error: insertError }
                  : { data: { id: insertedId, created_at: '2026-01-01T00:00:00.000Z', ...row }, error: null },
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  } as unknown as SummarizeTopicDeps['supabaseAdmin'];
}

function fakeAnthropic(responseText: string): AnthropicMessagesClient {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: responseText }],
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    },
  };
}

function validSummaryJson(overrides: Partial<Record<string, unknown>> = {}) {
  return JSON.stringify({
    keyPoints: [{ text: 'Deploys are slow', sources: [cardAId] }],
    decisions: [{ text: 'Add a staging environment', sources: [cardBId] }],
    disagreements: [],
    proposedActionItems: [],
    ...overrides,
  });
}

function baseDeps(overrides: Partial<SummarizeTopicDeps> = {}): SummarizeTopicDeps {
  return {
    supabaseAdmin: fakeSupabase(),
    realtimeBus: { broadcastRetro: vi.fn() },
    anthropicApiKey: 'sk-test',
    logger: { info: vi.fn(), error: vi.fn() },
    ...overrides,
  };
}

describe('runSummarizeTopicJob', () => {
  it('skips entirely when there is no API key', async () => {
    const supabaseAdmin = fakeSupabase();
    await runSummarizeTopicJob({ topicId }, baseDeps({ supabaseAdmin, anthropicApiKey: undefined }));
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it('does nothing when the topic has no cards', async () => {
    const anthropic = fakeAnthropic(validSummaryJson());
    const supabaseAdmin = fakeSupabase({ cards: [] });
    await runSummarizeTopicJob({ topicId }, baseDeps({ supabaseAdmin, createAnthropicClient: () => anthropic }));
    expect(anthropic.messages.create).not.toHaveBeenCalled();
  });

  it('stores version 1 and broadcasts topic.summaryReady when there is no prior summary', async () => {
    const anthropic = fakeAnthropic(validSummaryJson());
    const deps = baseDeps({ createAnthropicClient: () => anthropic });

    await runSummarizeTopicJob({ topicId }, deps);

    expect(deps.realtimeBus.broadcastRetro).toHaveBeenCalledWith(
      retroId,
      expect.objectContaining({
        type: 'topic.summaryReady',
        payload: expect.objectContaining({
          topicId,
          summary: expect.objectContaining({
            version: 1,
            keyPoints: [{ text: 'Deploys are slow', sources: [cardAId] }],
            decisions: [{ text: 'Add a staging environment', sources: [cardBId] }],
          }),
        }),
      }),
    );
  });

  it('increments the version when a prior summary already exists', async () => {
    const anthropic = fakeAnthropic(validSummaryJson());
    const supabaseAdmin = fakeSupabase({ latestVersion: 2 });
    const deps = baseDeps({ supabaseAdmin, createAnthropicClient: () => anthropic });

    await runSummarizeTopicJob({ topicId }, deps);

    expect(deps.realtimeBus.broadcastRetro).toHaveBeenCalledWith(
      retroId,
      expect.objectContaining({ payload: expect.objectContaining({ summary: expect.objectContaining({ version: 3 }) }) }),
    );
  });

  it('drops a point that cites an unknown card id, keeping valid ones', async () => {
    const unknownId = '00000000-0000-4000-8000-000000000099';
    const anthropic = fakeAnthropic(
      validSummaryJson({
        keyPoints: [
          { text: 'Bad point', sources: [unknownId] },
          { text: 'Good point', sources: [cardAId] },
        ],
      }),
    );
    const deps = baseDeps({ createAnthropicClient: () => anthropic });

    await runSummarizeTopicJob({ topicId }, deps);

    const call = (deps.realtimeBus.broadcastRetro as ReturnType<typeof vi.fn>).mock.calls[0]![1] as {
      payload: { summary: { keyPoints: unknown[] } };
    };
    expect(call.payload.summary.keyPoints).toEqual([{ text: 'Good point', sources: [cardAId] }]);
  });

  it('drops a point with zero sources', async () => {
    const anthropic = fakeAnthropic(validSummaryJson({ disagreements: [{ text: 'No source', sources: [] }] }));
    const deps = baseDeps({ createAnthropicClient: () => anthropic });

    await runSummarizeTopicJob({ topicId }, deps);

    const call = (deps.realtimeBus.broadcastRetro as ReturnType<typeof vi.fn>).mock.calls[0]![1] as {
      payload: { summary: { disagreements: unknown[] } };
    };
    expect(call.payload.summary.disagreements).toEqual([]);
  });

  it('retries on the fallback model when the primary fails, and still succeeds', async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(new Error('primary down'))
      .mockResolvedValueOnce({ content: [{ type: 'text', text: validSummaryJson() }], usage: { input_tokens: 10, output_tokens: 5 } });
    const anthropic: AnthropicMessagesClient = { messages: { create } };
    const deps = baseDeps({ createAnthropicClient: () => anthropic });

    await runSummarizeTopicJob({ topicId }, deps);

    expect(create).toHaveBeenCalledTimes(2);
    const calls = create.mock.calls as { model: string }[][];
    expect(calls[0]![0]!.model).not.toBe(calls[1]![0]!.model);
    expect(deps.realtimeBus.broadcastRetro).toHaveBeenCalledWith(retroId, expect.objectContaining({ type: 'topic.summaryReady' }));
  });

  it('broadcasts topic.summaryFailed when both the primary and fallback fail', async () => {
    const failing: AnthropicMessagesClient = { messages: { create: vi.fn().mockRejectedValue(new Error('down')) } };
    const deps = baseDeps({ createAnthropicClient: () => failing });

    await runSummarizeTopicJob({ topicId }, deps);

    expect(deps.realtimeBus.broadcastRetro).toHaveBeenCalledWith(retroId, { type: 'topic.summaryFailed', payload: { topicId } });
  });

  it('broadcasts topic.summaryFailed when both attempts return invalid (non-JSON) output', async () => {
    const anthropic = fakeAnthropic('not json at all');
    const deps = baseDeps({ createAnthropicClient: () => anthropic });

    await runSummarizeTopicJob({ topicId }, deps);

    expect(deps.realtimeBus.broadcastRetro).toHaveBeenCalledWith(retroId, { type: 'topic.summaryFailed', payload: { topicId } });
  });

  it('strips a markdown code fence if the model wraps its answer in one', async () => {
    const anthropic = fakeAnthropic('```json\n' + validSummaryJson() + '\n```');
    const deps = baseDeps({ createAnthropicClient: () => anthropic });

    await runSummarizeTopicJob({ topicId }, deps);

    expect(deps.realtimeBus.broadcastRetro).toHaveBeenCalledWith(retroId, expect.objectContaining({ type: 'topic.summaryReady' }));
  });

  it('logs token usage without ever including card text', async () => {
    const anthropic = fakeAnthropic(validSummaryJson());
    const logger = { info: vi.fn(), error: vi.fn() };
    const deps = baseDeps({ createAnthropicClient: () => anthropic, logger });

    await runSummarizeTopicJob({ topicId }, deps);

    const usageLog = logger.info.mock.calls.map((c) => c[0] as string).find((msg) => msg.includes('ai usage'));
    expect(usageLog).toContain('in=100');
    expect(usageLog).not.toContain('Deploys are slow');
  });

  it('does not store anything when the insert fails', async () => {
    const anthropic = fakeAnthropic(validSummaryJson());
    const supabaseAdmin = fakeSupabase({ insertError: new Error('db down') });
    const deps = baseDeps({ supabaseAdmin, createAnthropicClient: () => anthropic });

    await runSummarizeTopicJob({ topicId }, deps);

    expect(deps.realtimeBus.broadcastRetro).not.toHaveBeenCalled();
  });
});
