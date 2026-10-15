import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AI_RECAP_FILTER_MODEL, AI_RECAP_SUMMARY_MODEL, type Database, type TopicSummaryPoint } from '@retronoodle/shared';
import type { WorkerLogger } from '../logger.js';
import { loadAgent } from '../agents/loadAgent.js';
import { isOverMonthlyCap, recordAiUsage } from '../aiSpendCap.js';
import type { AnthropicMessagesClient } from './groupCards.js';

export interface GenerateRecapJobData {
  retroId: string;
}

export interface GenerateRecapDeps {
  supabaseAdmin: SupabaseClient<Database>;
  anthropicApiKey: string | undefined;
  monthlyCapUsd: number | undefined;
  logger: WorkerLogger;
  createAnthropicClient?: (apiKey: string) => AnthropicMessagesClient;
}

const FilterShape = z.object({
  keyPoints: z.array(z.string()),
  decisions: z.array(z.string()),
});

const SummaryShape = z.object({
  topicSummaries: z.array(z.object({ topicId: z.string(), summary: z.string() })),
  decisions: z.array(z.object({ topicId: z.string(), text: z.string() })),
});

/** Same cheap insurance as groupCards.ts's extractJsonArrayText, for a JSON object instead of an
 * array. */
function extractJsonObjectText(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  return (fenced ? fenced[1]! : text).trim();
}

async function markUnavailable(supabaseAdmin: SupabaseClient<Database>, retroId: string): Promise<void> {
  await supabaseAdmin.from('retro_recaps').update({ status: 'unavailable' }).eq('retro_id', retroId);
}

interface FilteredTopic {
  topicId: string;
  topicName: string;
  keyPoints: string[];
  decisions: string[];
}

/**
 * ai.generateRecap (RN-045): enqueued once from retro.close. A two-stage agent team — one
 * recap-filter call per discussed topic (redacting PII, profanity and non-work chatter from that
 * topic's already-stored key points/decisions), followed by exactly one recap-summarizer call for
 * the whole meeting once every topic has been filtered. The summarizer is never given anything
 * recap-filter hasn't already cleaned — that ordering is the whole point of the two-agent split,
 * not an optimization.
 *
 * Action items, undiscussed topics and attendance are deliberately NOT produced here: the recap
 * route (routes/recap.ts) reads those live from their own authoritative tables on every request,
 * so e.g. an action item's status always reflects reality even if it changes after this job ran.
 * No vote counts anywhere in this pipeline, by design.
 */
export async function runGenerateRecapJob(data: GenerateRecapJobData, deps: GenerateRecapDeps): Promise<void> {
  const { retroId } = data;
  const { supabaseAdmin, anthropicApiKey, monthlyCapUsd, logger } = deps;
  const createAnthropicClient: (apiKey: string) => AnthropicMessagesClient =
    deps.createAnthropicClient ?? ((apiKey) => new Anthropic({ apiKey }));

  if (!anthropicApiKey) {
    logger.info(`ai.generateRecap: skipped for retro ${retroId} (no ANTHROPIC_API_KEY)`);
    await markUnavailable(supabaseAdmin, retroId);
    return;
  }
  // TS narrowing from the guard above doesn't carry into the nested `generate` function below
  // (a separate function scope) — this capture is what lets `generate` use it as a plain
  // `string` instead of `string | undefined`.
  const confirmedApiKey: string = anthropicApiKey;

  if (monthlyCapUsd !== undefined && (await isOverMonthlyCap(supabaseAdmin, monthlyCapUsd))) {
    logger.info(`ai.generateRecap: skipped for retro ${retroId} (monthly AI spend cap reached)`);
    await markUnavailable(supabaseAdmin, retroId);
    return;
  }

  try {
    await generate();
  } catch (err) {
    logger.error(err, `ai.generateRecap: unexpected error for retro ${retroId}`);
    await markUnavailable(supabaseAdmin, retroId);
  }

  async function generate(): Promise<void> {
    const client = createAnthropicClient(confirmedApiKey);

    const { data: topics } = await supabaseAdmin.from('topics').select('id, name').eq('retro_id', retroId).not('started_at', 'is', null);
    const discussed = topics ?? [];

    const filtered: FilteredTopic[] = [];
    for (const topic of discussed) {
      const topicName = topic.name ?? 'Untitled group';
      const { data: latest } = await supabaseAdmin
        .from('topic_summaries')
        .select('key_points, decisions')
        .eq('topic_id', topic.id)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
      const keyPoints = ((latest?.key_points as TopicSummaryPoint[] | null) ?? []).map((p) => p.text);
      const decisions = ((latest?.decisions as TopicSummaryPoint[] | null) ?? []).map((p) => p.text);

      if (keyPoints.length === 0 && decisions.length === 0) {
        filtered.push({ topicId: topic.id, topicName, keyPoints: [], decisions: [] });
        continue;
      }

      const prompt = loadAgent('recap-filter')
        .body.replace('{{TOPIC_NAME}}', topicName)
        .replace('{{KEY_POINTS}}', keyPoints.map((t) => `- ${t}`).join('\n') || '(none)')
        .replace('{{DECISIONS}}', decisions.map((t) => `- ${t}`).join('\n') || '(none)');

      const response = await client.messages.create({ model: AI_RECAP_FILTER_MODEL, max_tokens: 1024, messages: [{ role: 'user', content: prompt }] });
      logger.info(
        `ai usage: retro=${retroId} job=ai.generateRecap step=filter topic=${topic.id} model=${AI_RECAP_FILTER_MODEL} in=${response.usage.input_tokens} out=${response.usage.output_tokens}`,
      );
      await recordAiUsage(supabaseAdmin, AI_RECAP_FILTER_MODEL, response.usage.input_tokens, response.usage.output_tokens);

      const text = response.content.find((block) => block.type === 'text')?.text ?? '';
      const parsed = FilterShape.safeParse(JSON.parse(extractJsonObjectText(text)));
      filtered.push({
        topicId: topic.id,
        topicName,
        keyPoints: parsed.success ? parsed.data.keyPoints : [],
        decisions: parsed.success ? parsed.data.decisions : [],
      });
    }

    if (filtered.length === 0) {
      await supabaseAdmin
        .from('retro_recaps')
        .update({ status: 'ready', topic_summaries: [], decisions: [], generated_at: new Date().toISOString() })
        .eq('retro_id', retroId);
      return;
    }

    const topicsBlob = filtered
      .map(
        (t) =>
          `Topic id: ${t.topicId}\nTopic name: ${t.topicName}\nKey points:\n${t.keyPoints.map((p) => `- ${p}`).join('\n') || '(none)'}\nDecisions:\n${t.decisions.map((p) => `- ${p}`).join('\n') || '(none)'}`,
      )
      .join('\n\n');
    const summaryPrompt = loadAgent('recap-summarizer').body.replace('{{TOPICS}}', topicsBlob);

    const response = await client.messages.create({ model: AI_RECAP_SUMMARY_MODEL, max_tokens: 4096, messages: [{ role: 'user', content: summaryPrompt }] });
    logger.info(
      `ai usage: retro=${retroId} job=ai.generateRecap step=summarize model=${AI_RECAP_SUMMARY_MODEL} in=${response.usage.input_tokens} out=${response.usage.output_tokens}`,
    );
    await recordAiUsage(supabaseAdmin, AI_RECAP_SUMMARY_MODEL, response.usage.input_tokens, response.usage.output_tokens);

    const text = response.content.find((block) => block.type === 'text')?.text ?? '';
    const parsed = SummaryShape.safeParse(JSON.parse(extractJsonObjectText(text)));
    if (!parsed.success) throw new Error('recap-summarizer returned invalid output');

    // "Never invent an id" (recap-summarizer.md) is a prompt instruction, not a schema
    // constraint — this is the actual enforcement: anything citing an id outside the set we gave
    // it is dropped rather than trusted.
    const validIds = new Map(filtered.map((t) => [t.topicId, t.topicName]));
    const topicSummaries = parsed.data.topicSummaries
      .filter((s) => validIds.has(s.topicId))
      .map((s) => ({ topicId: s.topicId, topicName: validIds.get(s.topicId)!, summary: s.summary }));
    const decisionsOut = parsed.data.decisions
      .filter((d) => validIds.has(d.topicId))
      .map((d) => ({ topicId: d.topicId, topicName: validIds.get(d.topicId)!, text: d.text }));

    const { error } = await supabaseAdmin
      .from('retro_recaps')
      .update({ status: 'ready', topic_summaries: topicSummaries, decisions: decisionsOut, generated_at: new Date().toISOString() })
      .eq('retro_id', retroId);
    if (error) {
      logger.error(error, `ai.generateRecap: failed to store recap for retro ${retroId}`);
      throw error;
    }
  }
}
