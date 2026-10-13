import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AI_TOPIC_SUMMARY_FALLBACK_MODEL, AI_TOPIC_SUMMARY_MODEL, AI_TOPIC_SUMMARY_TIMEOUT_MS, type Database } from '@retronoodle/shared';
import type { WorkerLogger } from '../logger.js';
import { loadAgent } from '../agents/loadAgent.js';
import { isOverMonthlyCap, recordAiUsage } from '../aiSpendCap.js';
import { parseMasterKey } from '../transcriptCrypto.js';
import { decryptForTeam } from '../transcriptKeys.js';
import type { AnthropicMessagesClient } from './groupCards.js';
import type { RealtimeBusLike } from './summarizeGroup.js';

export interface SummarizeTopicJobData {
  topicId: string;
}

export interface SummarizeTopicDeps {
  supabaseAdmin: SupabaseClient<Database>;
  realtimeBus: RealtimeBusLike;
  anthropicApiKey: string | undefined;
  monthlyCapUsd: number | undefined;
  logger: WorkerLogger;
  // RN-037: undefined means every topic behaves exactly like "no recording" (RN-021's own
  // behavior, unchanged) — same optionality shape as every other optional key this worker reads.
  transcriptMasterKey?: string;
  createAnthropicClient?: (apiKey: string) => AnthropicMessagesClient;
}

interface TranscriptLine {
  id: string;
  speakerUserId: string | null;
  text: string;
}

/**
 * RN-037: this topic's transcript, decrypted — empty when there's no master key, no recording,
 * or this topic simply has no segments (the retro wasn't being recorded when it was discussed).
 * Gap markers (RN-033, a facilitator tab drop) carry no real text and are always skipped.
 */
async function fetchTranscriptLines(
  supabaseAdmin: SupabaseClient<Database>,
  transcriptMasterKey: string | undefined,
  teamId: string,
  topicId: string,
): Promise<TranscriptLine[]> {
  if (!transcriptMasterKey) return [];
  const { data: rows } = await supabaseAdmin
    .from('transcript_segments')
    .select('id, ciphertext, iv, auth_tag, speaker_user_id, is_gap_marker')
    .eq('topic_id', topicId)
    .order('start_ms');
  if (!rows || rows.length === 0) return [];

  const masterKey = parseMasterKey(transcriptMasterKey);
  const lines: TranscriptLine[] = [];
  for (const row of rows) {
    if (row.is_gap_marker) continue;
    const text = await decryptForTeam(supabaseAdmin, masterKey, teamId, { ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag });
    if (text === null || !text.trim()) continue;
    lines.push({ id: row.id, speakerUserId: row.speaker_user_id, text });
  }
  return lines;
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
function filterPoints(points: { text: string; sources: string[] }[], validSourceIds: Set<string>): { text: string; sources: string[] }[] {
  return points.filter((p) => p.sources.length > 0 && p.sources.every((id) => validSourceIds.has(id)));
}

function filterSummary(raw: RawSummary, validSourceIds: Set<string>): RawSummary {
  return {
    keyPoints: filterPoints(raw.keyPoints, validSourceIds),
    decisions: filterPoints(raw.decisions, validSourceIds),
    disagreements: filterPoints(raw.disagreements, validSourceIds),
    proposedActionItems: filterPoints(raw.proposedActionItems, validSourceIds),
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
  const { supabaseAdmin, realtimeBus, anthropicApiKey, monthlyCapUsd, logger } = deps;
  const createAnthropicClient: (apiKey: string) => AnthropicMessagesClient =
    deps.createAnthropicClient ?? ((apiKey) => new Anthropic({ apiKey }));

  if (!anthropicApiKey) {
    logger.info(`ai.summarizeTopic: skipped for topic ${topicId} (no ANTHROPIC_API_KEY)`);
    return;
  }
  // TS narrowing from the guard above doesn't carry into the nested `summarize` function below
  // (a separate function scope) — this capture is what lets `summarize` use it as a plain
  // `string` instead of `string | undefined`.
  const confirmedApiKey: string = anthropicApiKey;

  const { data: topic } = await supabaseAdmin.from('topics').select('retro_id, name').eq('id', topicId).maybeSingle();
  if (!topic) return;

  // RN-027: "on cap, AI features fall back silently ... 'Summary unavailable'" names this job's
  // own fallback by name — unlike the other three AI jobs (optional background polish with no
  // "waiting" UI state), this one leaves the panel showing "Summarizing…" forever if nothing ever
  // tells the client otherwise, so this broadcasts the same topic.summaryFailed event the
  // both-attempts-failed path below does, rather than silently returning.
  if (monthlyCapUsd !== undefined && (await isOverMonthlyCap(supabaseAdmin, monthlyCapUsd))) {
    logger.info(`ai.summarizeTopic: skipped for topic ${topicId} (monthly AI spend cap reached)`);
    await realtimeBus.broadcastRetro(topic.retro_id, { type: 'topic.summaryFailed', payload: { topicId } });
    return;
  }

  // Everything below can throw for reasons that have nothing to do with "both models failed" —
  // a bad prompt file, a transcript that fails to decrypt, any unexpected DB error. Without this,
  // such a throw leaves the panel showing "Summarizing…" forever: nothing else in this job ever
  // gets a chance to broadcast topic.summaryFailed (found live — a missing .claude/agents file on
  // one deployment did exactly this, for a job a *different* deployment's worker had queued).
  try {
    await summarize(topic);
  } catch (err) {
    logger.error(err, `ai.summarizeTopic: unexpected error for topic ${topicId}`);
    await realtimeBus.broadcastRetro(topic.retro_id, { type: 'topic.summaryFailed', payload: { topicId } });
  }

  async function summarize(topic: { retro_id: string; name: string }): Promise<void> {
  const { data: retro } = await supabaseAdmin.from('retros').select('team_id').eq('id', topic.retro_id).maybeSingle();
  if (!retro) return;

  const { data: cards } = await supabaseAdmin.from('cards').select('id, body, author_id').eq('topic_id', topicId);
  if (!cards || cards.length === 0) return;

  const transcriptLines = await fetchTranscriptLines(supabaseAdmin, deps.transcriptMasterKey, retro.team_id, topicId);

  const authorIds = [...new Set(cards.map((c) => c.author_id))];
  const speakerUserIds = [...new Set(transcriptLines.map((l) => l.speakerUserId).filter((id): id is string => id !== null))];
  const nameLookupIds = [...new Set([...authorIds, ...speakerUserIds])];
  const [{ data: names }, { data: note }, { data: teamMemberRows }, { data: openItems }] = await Promise.all([
    supabaseAdmin.from('profiles').select('id, display_name').in('id', nameLookupIds),
    supabaseAdmin.from('topic_notes').select('body').eq('topic_id', topicId).maybeSingle(),
    supabaseAdmin.from('team_members').select('user_id').eq('team_id', retro.team_id),
    supabaseAdmin.from('action_items').select('title').eq('team_id', retro.team_id).eq('status', 'open'),
  ]);
  const nameById = new Map((names ?? []).map((a) => [a.id, a.display_name]));
  const validSourceIds = new Set([...cards.map((c) => c.id), ...transcriptLines.map((l) => l.id)]);

  const memberUserIds = (teamMemberRows ?? []).map((m) => m.user_id);
  const { data: memberProfiles } =
    memberUserIds.length > 0
      ? await supabaseAdmin.from('profiles').select('display_name').in('id', memberUserIds)
      : { data: [] as { display_name: string }[] };

  const cardLines = cards
    .map((c) => `- id: ${c.id} | written by: ${nameById.get(c.author_id) ?? 'unknown'} | text: ${c.body.replace(/\n/g, ' ')}`)
    .join('\n');
  // RN-037 AC: "with no recording, behavior matches RN-021 exactly" — an empty transcript reads
  // "(none)", the same convention notesText/openActionItemTitles below already use, so the prompt
  // never gains anything functionally new to work from when there isn't one.
  const transcriptText =
    transcriptLines.length > 0
      ? transcriptLines
          .map((l) => `- id: ${l.id} | speaker: ${l.speakerUserId ? (nameById.get(l.speakerUserId) ?? 'unknown') : 'unknown'} | text: ${l.text.replace(/\n/g, ' ')}`)
          .join('\n')
      : '(none)';
  const notesText = note?.body?.trim() ? note.body : '(none)';
  const teamMemberNames = (memberProfiles ?? []).map((m) => m.display_name).join(', ') || '(none)';
  const openActionItemTitles = (openItems ?? []).map((i) => `- ${i.title}`).join('\n') || '(none)';

  const prompt = loadAgent('topic-summarizer')
    .body.replace('{{TOPIC_NAME}}', topic.name)
    .replace('{{CARDS}}', cardLines)
    .replace('{{TRANSCRIPT}}', transcriptText)
    .replace('{{NOTES}}', notesText)
    .replace('{{TEAM_MEMBERS}}', teamMemberNames)
    .replace('{{OPEN_ACTION_ITEMS}}', openActionItemTitles);

  const client = createAnthropicClient(confirmedApiKey);

  async function attempt(model: string): Promise<{ raw: RawSummary; model: string } | null> {
    try {
      const response = await withTimeout(
        client.messages.create({ model, max_tokens: 2048, messages: [{ role: 'user', content: prompt }] }),
        AI_TOPIC_SUMMARY_TIMEOUT_MS,
      );
      logger.info(
        `ai usage: topic=${topicId} job=ai.summarizeTopic model=${model} in=${response.usage.input_tokens} out=${response.usage.output_tokens}`,
      );
      await recordAiUsage(supabaseAdmin, model, response.usage.input_tokens, response.usage.output_tokens);
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

  const filtered = filterSummary(result.raw, validSourceIds);
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
}
