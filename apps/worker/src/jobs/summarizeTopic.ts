import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AI_TOPIC_SUMMARY_FALLBACK_MODEL, AI_TOPIC_SUMMARY_MODEL, AI_TOPIC_SUMMARY_TIMEOUT_MS, type Database } from '@retronoodle/shared';
import type { WorkerLogger } from '../logger.js';
import { loadAgent } from '../agents/loadAgent.js';
import type { AnthropicMessagesClient } from './groupCards.js';
import type { RealtimeBusLike } from './summarizeGroup.js';

export interface SummarizeTopicJobData {
  topicId: string;
}

export interface SummarizeTopicDeps {
  supabaseAdmin: SupabaseClient<Database>;
  realtimeBus: RealtimeBusLike;
  anthropicApiKey: string | undefined;
  logger: WorkerLogger;
  createAnthropicClient?: (apiKey: string) => AnthropicMessagesClient;
}

const PointShape = z.object({ text: z.string().min(1), sources: z.array(z.string()) });
const SummaryShape = z.object({
  keyPoints: z.array(PointShape),
  decisions: z.array(PointShape),
  disagreements: z.array(PointShape),
  proposedActionItems: z.array(PointShape),
});
type RawSummary = z.infer<typeof SummaryShape>;

function extractJsonObjectText(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  return (fenced ? fenced[1]! : text).trim();
}

/** "Every rendered point has at least one valid source; invalid citations never show" (the
 * story's own AC) — an entry citing even one unknown card id is dropped entirely, same
 * "validate and drop, don't partially repair" precedent as RN-017's grouping suggestions. */
function filterPoints(points: { text: string; sources: string[] }[], validCardIds: Set<string>): { text: string; sources: string[] }[] {
  return points.filter((p) => p.sources.length > 0 && p.sources.every((id) => validCardIds.has(id)));
}

function filterSummary(raw: RawSummary, validCardIds: Set<string>): RawSummary {
  return {
    keyPoints: filterPoints(raw.keyPoints, validCardIds),
    decisions: filterPoints(raw.decisions, validCardIds),
    disagreements: filterPoints(raw.disagreements, validCardIds),
    proposedActionItems: filterPoints(raw.proposedActionItems, validCardIds),
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * ai.summarizeTopic (RN-021): one Claude request per topic change (enqueued from
 * discussHelpers.ts's endCurrentTopic, plus onTransition.ts's vote->discuss for the first topic,
 * plus topic.regenerateSummary for a manual re-run). 25s timeout on the primary model, one retry
 * on the fallback (same prompt, cheaper/faster model) — if both fail, the retro keeps going and
 * the panel shows "Summary unavailable. Retry," exactly like write->group's ai.groupCards being
 * optional polish, never a reason to block anything.
 */
export async function runSummarizeTopicJob(data: SummarizeTopicJobData, deps: SummarizeTopicDeps): Promise<void> {
  const { topicId } = data;
  const { supabaseAdmin, realtimeBus, anthropicApiKey, logger } = deps;
  const createAnthropicClient: (apiKey: string) => AnthropicMessagesClient =
    deps.createAnthropicClient ?? ((apiKey) => new Anthropic({ apiKey }));

  if (!anthropicApiKey) {
    logger.info(`ai.summarizeTopic: skipped for topic ${topicId} (no ANTHROPIC_API_KEY)`);
    return;
  }

  const { data: topic } = await supabaseAdmin.from('topics').select('retro_id, name').eq('id', topicId).maybeSingle();
  if (!topic) return;

  const { data: retro } = await supabaseAdmin.from('retros').select('team_id').eq('id', topic.retro_id).maybeSingle();
  if (!retro) return;

  const { data: cards } = await supabaseAdmin.from('cards').select('id, body, author_id').eq('topic_id', topicId);
  if (!cards || cards.length === 0) return;

  const authorIds = [...new Set(cards.map((c) => c.author_id))];
  const [{ data: authors }, { data: note }, { data: teamMemberRows }, { data: openItems }] = await Promise.all([
    supabaseAdmin.from('profiles').select('id, display_name').in('id', authorIds),
    supabaseAdmin.from('topic_notes').select('body').eq('topic_id', topicId).maybeSingle(),
    supabaseAdmin.from('team_members').select('user_id').eq('team_id', retro.team_id),
    supabaseAdmin.from('action_items').select('title').eq('team_id', retro.team_id).eq('status', 'open'),
  ]);
  const authorNameById = new Map((authors ?? []).map((a) => [a.id, a.display_name]));
  const validCardIds = new Set(cards.map((c) => c.id));

  const memberUserIds = (teamMemberRows ?? []).map((m) => m.user_id);
  const { data: memberProfiles } =
    memberUserIds.length > 0
      ? await supabaseAdmin.from('profiles').select('display_name').in('id', memberUserIds)
      : { data: [] as { display_name: string }[] };

  const cardLines = cards
    .map((c) => `- id: ${c.id} | written by: ${authorNameById.get(c.author_id) ?? 'unknown'} | text: ${c.body.replace(/\n/g, ' ')}`)
    .join('\n');
  const notesText = note?.body?.trim() ? note.body : '(none)';
  const teamMemberNames = (memberProfiles ?? []).map((m) => m.display_name).join(', ') || '(none)';
  const openActionItemTitles = (openItems ?? []).map((i) => `- ${i.title}`).join('\n') || '(none)';

  const prompt = loadAgent('topic-summarizer')
    .body.replace('{{TOPIC_NAME}}', topic.name)
    .replace('{{CARDS}}', cardLines)
    .replace('{{NOTES}}', notesText)
    .replace('{{TEAM_MEMBERS}}', teamMemberNames)
    .replace('{{OPEN_ACTION_ITEMS}}', openActionItemTitles);

  const client = createAnthropicClient(anthropicApiKey);

  async function attempt(model: string): Promise<{ raw: RawSummary; model: string } | null> {
    try {
      const response = await withTimeout(
        client.messages.create({ model, max_tokens: 2048, messages: [{ role: 'user', content: prompt }] }),
        AI_TOPIC_SUMMARY_TIMEOUT_MS,
      );
      logger.info(
        `ai usage: topic=${topicId} job=ai.summarizeTopic model=${model} in=${response.usage.input_tokens} out=${response.usage.output_tokens}`,
      );
      const text = response.content.find((block) => block.type === 'text')?.text ?? '';
      const parsed = SummaryShape.safeParse(JSON.parse(extractJsonObjectText(text)));
      return parsed.success ? { raw: parsed.data, model } : null;
    } catch (err) {
      logger.error(err, `ai.summarizeTopic: request failed for topic ${topicId} (model ${model})`);
      return null;
    }
  }

  const result = (await attempt(AI_TOPIC_SUMMARY_MODEL)) ?? (await attempt(AI_TOPIC_SUMMARY_FALLBACK_MODEL));

  if (!result) {
    await realtimeBus.broadcastRetro(topic.retro_id, { type: 'topic.summaryFailed', payload: { topicId } });
    return;
  }

  const filtered = filterSummary(result.raw, validCardIds);
  const promptVersion = loadAgent('topic-summarizer').promptVersion;

  const { data: latest } = await supabaseAdmin
    .from('topic_summaries')
    .select('version')
    .eq('topic_id', topicId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  const version = (latest?.version ?? 0) + 1;

  const { data: inserted, error } = await supabaseAdmin
    .from('topic_summaries')
    .insert({
      topic_id: topicId,
      version,
      model: result.model,
      prompt_version: promptVersion,
      key_points: filtered.keyPoints,
      decisions: filtered.decisions,
      disagreements: filtered.disagreements,
      proposed_action_items: filtered.proposedActionItems,
    })
    .select()
    .single();
  if (error || !inserted) {
    logger.error(error, `ai.summarizeTopic: failed to store summary for topic ${topicId}`);
    return;
  }

  await realtimeBus.broadcastRetro(topic.retro_id, {
    type: 'topic.summaryReady',
    payload: {
      topicId,
      summary: {
        id: inserted.id,
        topicId: inserted.topic_id,
        version: inserted.version,
        model: inserted.model,
        promptVersion: inserted.prompt_version,
        keyPoints: filtered.keyPoints,
        decisions: filtered.decisions,
        disagreements: filtered.disagreements,
        proposedActionItems: filtered.proposedActionItems,
        edited: inserted.edited,
        editRatio: inserted.edit_ratio,
        createdAt: inserted.created_at,
      },
    },
  });
}
