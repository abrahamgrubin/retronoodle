import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AI_GROUP_SUMMARY_MODEL, type Database } from '@retronoodle/shared';
import type { WorkerLogger } from '../logger.js';
import { loadAgent } from '../agents/loadAgent.js';
import type { AnthropicMessagesClient } from './groupCards.js';

/** Unlike groupCards.ts's RealtimeBusLike (facilitator-only), this needs the shared retro
 * channel — every voter sees the group summary, not just the facilitator. */
export interface RealtimeBusLike {
  broadcastRetro(retroId: string, event: { type: string; payload: unknown }): Promise<void>;
}

export interface SummarizeGroupJobData {
  topicId: string;
}

export interface SummarizeGroupDeps {
  supabaseAdmin: SupabaseClient<Database>;
  realtimeBus: RealtimeBusLike;
  anthropicApiKey: string | undefined;
  logger: WorkerLogger;
  createAnthropicClient?: (apiKey: string) => AnthropicMessagesClient;
}

const SummaryShape = z.object({
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(1000),
});

/** Same cheap insurance as groupCards.ts's extractJsonArrayText, for a JSON object instead of an
 * array. */
function extractJsonObjectText(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  return (fenced ? fenced[1]! : text).trim();
}

/**
 * ai.summarizeGroup (homework): one Claude request per topic, enqueued from the group->vote
 * transition effect (onTransition.ts) — once for every topic, the moment grouping locks in.
 * Writes `topics.ai_group_summary_title`/`ai_group_summary` and broadcasts to the shared retro
 * channel (everyone sees it on the Vote page, replacing the group's cards) — never routed
 * through the normal mutation pipeline, since nothing here is a client-initiated mutation (same
 * "one-shot worker broadcast, not a retro_events row" pattern as RN-017's group.suggestions,
 * just to everyone instead of just the facilitator).
 */
export async function runSummarizeGroupJob(data: SummarizeGroupJobData, deps: SummarizeGroupDeps): Promise<void> {
  const { topicId } = data;
  const { supabaseAdmin, realtimeBus, anthropicApiKey, logger } = deps;
  const createAnthropicClient: (apiKey: string) => AnthropicMessagesClient =
    deps.createAnthropicClient ?? ((apiKey) => new Anthropic({ apiKey }));

  if (!anthropicApiKey) {
    logger.info(`ai.summarizeGroup: skipped for topic ${topicId} (no ANTHROPIC_API_KEY)`);
    return;
  }

  const { data: topic } = await supabaseAdmin.from('topics').select('retro_id').eq('id', topicId).maybeSingle();
  if (!topic) return;

  const { data: cards } = await supabaseAdmin.from('cards').select('body, author_id').eq('topic_id', topicId);
  if (!cards || cards.length === 0) return;

  const authorIds = [...new Set(cards.map((c) => c.author_id))];
  const { data: authors } = await supabaseAdmin.from('profiles').select('id, display_name').in('id', authorIds);
  const authorNameById = new Map((authors ?? []).map((a) => [a.id, a.display_name]));

  const groupLines = cards.map((c) => `- (written by ${authorNameById.get(c.author_id) ?? 'unknown'}) ${c.body.replace(/\n/g, ' ')}`).join('\n');
  const prompt = loadAgent('group-summarizer').body.replace('{{GROUP}}', groupLines);

  const client = createAnthropicClient(anthropicApiKey);
  let parsed: z.infer<typeof SummaryShape> | undefined;
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    try {
      const response = await client.messages.create({
        model: AI_GROUP_SUMMARY_MODEL,
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      });

      // "Log token use" — counts only, never card text (CLAUDE.md: no retro content in logs).
      logger.info(
        `ai usage: topic=${topicId} job=ai.summarizeGroup model=${AI_GROUP_SUMMARY_MODEL} in=${response.usage.input_tokens} out=${response.usage.output_tokens}`,
      );

      const text = response.content.find((block) => block.type === 'text')?.text ?? '';
      const result = SummaryShape.safeParse(JSON.parse(extractJsonObjectText(text)));
      if (result.success) parsed = result.data;
    } catch (err) {
      logger.error(err, `ai.summarizeGroup: request failed for topic ${topicId} (attempt ${attempt + 1})`);
    }
  }

  if (!parsed) return;

  const { error } = await supabaseAdmin
    .from('topics')
    .update({ ai_group_summary_title: parsed.title, ai_group_summary: parsed.summary })
    .eq('id', topicId);
  if (error) {
    logger.error(error, `ai.summarizeGroup: failed to store summary for topic ${topicId}`);
    return;
  }

  await realtimeBus.broadcastRetro(topic.retro_id, {
    type: 'topic.groupSummaryReady',
    payload: { topicId, title: parsed.title, summary: parsed.summary },
  });
}
