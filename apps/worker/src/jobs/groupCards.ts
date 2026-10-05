import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AI_GROUPING_MODEL, type Database } from '@retronoodle/shared';
import type { WorkerLogger } from '../logger.js';
import { loadAgent } from '../agents/loadAgent.js';
import { isOverMonthlyCap, recordAiUsage } from '../aiSpendCap.js';

/** The one shape RealtimeBus actually needs here — a structural subset, not the concrete class,
 * so this job (and its tests) don't depend on apps/api's RealtimeBus at all. */
export interface RealtimeBusLike {
  broadcastUser(userId: string, event: { type: string; payload: unknown }): Promise<void>;
}

export interface GroupCardsJobData {
  retroId: string;
}

/** The one slice of the real Anthropic SDK client this job actually calls. */
export interface AnthropicMessagesClient {
  messages: {
    create(params: { model: string; max_tokens: number; messages: { role: 'user'; content: string }[] }): Promise<{
      content: Array<{ type: string; text?: string }>;
      usage: { input_tokens: number; output_tokens: number };
    }>;
  };
}

export interface GroupCardsDeps {
  supabaseAdmin: SupabaseClient<Database>;
  realtimeBus: RealtimeBusLike;
  anthropicApiKey: string | undefined;
  // RN-027: "on cap, AI features fall back silently" — undefined means no cap configured at all.
  monthlyCapUsd: number | undefined;
  logger: WorkerLogger;
  /** Injected in tests; defaults to a real Anthropic client (same seam as startWorker's own
   * `createQueue`). */
  createAnthropicClient?: (apiKey: string) => AnthropicMessagesClient;
}

const SuggestionShape = z.object({
  name: z.string().min(1).max(200),
  cardIds: z.array(z.string().uuid()).min(2),
});
const SuggestionsShape = z.array(SuggestionShape);

/** Strips a ```json fenced block if the model wraps its answer in one despite being told not to
 * — cheap insurance, not a real parser. Anything else still fails `JSON.parse` below and counts
 * as invalid output (one retry, then no suggestions — the story's own fallback). */
function extractJsonArrayText(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  return (fenced ? fenced[1]! : text).trim();
}

/**
 * ai.groupCards (RN-017): one Claude request per board, enqueued from the write->group
 * transition effect (onTransition.ts). Every exit before the Anthropic call is a silent no-op —
 * "failure shows nothing and manual grouping still works" is the story's own framing, so nothing
 * here ever throws in a way that would reach the caller as an error.
 *
 * RN-027: checks the shared monthly spend cap before ever calling Anthropic — same silent-no-op
 * fallback as the "no API key" case just below it.
 */
export async function runGroupCardsJob(data: GroupCardsJobData, deps: GroupCardsDeps): Promise<void> {
  const { retroId } = data;
  const { supabaseAdmin, realtimeBus, anthropicApiKey, monthlyCapUsd, logger } = deps;
  const createAnthropicClient: (apiKey: string) => AnthropicMessagesClient =
    deps.createAnthropicClient ?? ((apiKey) => new Anthropic({ apiKey }));

  if (!anthropicApiKey) {
    logger.info(`ai.groupCards: skipped for retro ${retroId} (no ANTHROPIC_API_KEY)`);
    return;
  }
  if (monthlyCapUsd !== undefined && (await isOverMonthlyCap(supabaseAdmin, monthlyCapUsd))) {
    logger.info(`ai.groupCards: skipped for retro ${retroId} (monthly AI spend cap reached)`);
    return;
  }

  const { data: retro } = await supabaseAdmin.from('retros').select('facilitator_id').eq('id', retroId).maybeSingle();
  if (!retro) return;

  const [{ data: columns }, { data: cards }] = await Promise.all([
    supabaseAdmin.from('retro_columns').select('id, title').eq('retro_id', retroId).eq('kind', 'standard'),
    supabaseAdmin.from('cards').select('id, column_id, body').eq('retro_id', retroId).is('topic_id', null),
  ]);
  const columnTitleById = new Map((columns ?? []).map((c) => [c.id, c.title]));
  const groupable = (cards ?? []).filter((c) => columnTitleById.has(c.column_id));
  if (groupable.length < 2) return;

  const cardLines = groupable
    .map((c) => `- id: ${c.id} | column: ${columnTitleById.get(c.column_id)} | text: ${c.body.replace(/\n/g, ' ')}`)
    .join('\n');
  const prompt = loadAgent('grouper').body.replace('{{CARDS}}', cardLines);

  const validCardIds = new Set(groupable.map((c) => c.id));
  const columnByCardId = new Map(groupable.map((c) => [c.id, c.column_id]));

  const client = createAnthropicClient(anthropicApiKey);
  let suggestions: z.infer<typeof SuggestionsShape> = [];
  for (let attempt = 0; attempt < 2 && suggestions.length === 0; attempt++) {
    try {
      const response = await client.messages.create({
        model: AI_GROUPING_MODEL,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      });

      // "Log token use per retro" — counts only, never card text (CLAUDE.md: no retro content in
      // logs).
      logger.info(
        `ai usage: retro=${retroId} job=ai.groupCards model=${AI_GROUPING_MODEL} in=${response.usage.input_tokens} out=${response.usage.output_tokens}`,
      );
      await recordAiUsage(supabaseAdmin, AI_GROUPING_MODEL, response.usage.input_tokens, response.usage.output_tokens);

      const text = response.content.find((block) => block.type === 'text')?.text ?? '';
      const parsed = SuggestionsShape.safeParse(JSON.parse(extractJsonArrayText(text)));
      if (!parsed.success) continue;

      // "Suggestions never mix columns or reference unknown card IDs (validated and dropped)."
      suggestions = parsed.data.filter((s) => {
        const ids = [...new Set(s.cardIds)].filter((id) => validCardIds.has(id));
        if (ids.length < 2) return false;
        const columnIds = new Set(ids.map((id) => columnByCardId.get(id)));
        return columnIds.size === 1;
      });
    } catch (err) {
      logger.error(err, `ai.groupCards: request failed for retro ${retroId} (attempt ${attempt + 1})`);
    }
  }

  if (suggestions.length === 0) return;

  const { data: inserted, error } = await supabaseAdmin
    .from('group_suggestions')
    .insert(suggestions.map((s) => ({ retro_id: retroId, name: s.name, card_ids: s.cardIds })))
    .select('id, name, card_ids');
  if (error || !inserted) {
    logger.error(error, `ai.groupCards: failed to store suggestions for retro ${retroId}`);
    return;
  }

  await realtimeBus.broadcastUser(retro.facilitator_id, {
    type: 'group.suggestions',
    payload: {
      suggestions: inserted.map((s) => ({
        id: s.id,
        name: s.name,
        columnId: columnByCardId.get(s.card_ids[0]!),
        cardIds: s.card_ids,
      })),
    },
  });
}
