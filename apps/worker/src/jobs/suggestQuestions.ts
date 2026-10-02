import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AI_QUESTION_SUGGESTER_MODEL, type Database } from '@retronoodle/shared';
import type { WorkerLogger } from '../logger.js';
import { loadAgent } from '../agents/loadAgent.js';
import type { AnthropicMessagesClient } from './groupCards.js';
import type { RealtimeBusLike } from './summarizeGroup.js';

export interface SuggestQuestionsJobData {
  topicId: string;
}

export interface SuggestQuestionsDeps {
  supabaseAdmin: SupabaseClient<Database>;
  realtimeBus: RealtimeBusLike;
  anthropicApiKey: string | undefined;
  logger: WorkerLogger;
  createAnthropicClient?: (apiKey: string) => AnthropicMessagesClient;
}

const QuestionsShape = z.object({
  questions: z.array(z.string().min(1).max(300)).min(1).max(3),
});

function extractJsonObjectText(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  return (fenced ? fenced[1]! : text).trim();
}

/**
 * ai.suggestQuestions (homework): one Claude request per topic, enqueued the moment a topic
 * becomes current in Discuss (discussHelpers.ts's startTopic, plus the top-ranked topic's own
 * enqueue in onTransition.ts's vote->discuss). Falls back to the topic's bare name when
 * group-summarizer hasn't produced a summary yet (no API key, still in flight, or failed) —
 * there's always something to ask about. Writes `topics.ai_discussion_questions` and broadcasts
 * to the shared retro channel, same one-shot pattern as ai.summarizeGroup.
 */
export async function runSuggestQuestionsJob(data: SuggestQuestionsJobData, deps: SuggestQuestionsDeps): Promise<void> {
  const { topicId } = data;
  const { supabaseAdmin, realtimeBus, anthropicApiKey, logger } = deps;
  const createAnthropicClient: (apiKey: string) => AnthropicMessagesClient =
    deps.createAnthropicClient ?? ((apiKey) => new Anthropic({ apiKey }));

  if (!anthropicApiKey) {
    logger.info(`ai.suggestQuestions: skipped for topic ${topicId} (no ANTHROPIC_API_KEY)`);
    return;
  }

  const { data: topic } = await supabaseAdmin
    .from('topics')
    .select('retro_id, name, ai_group_summary_title, ai_group_summary')
    .eq('id', topicId)
    .maybeSingle();
  if (!topic) return;

  const summaryText = topic.ai_group_summary
    ? `${topic.ai_group_summary_title ?? topic.name}: ${topic.ai_group_summary}`
    : topic.name;
  const prompt = loadAgent('question-suggester').body.replace('{{SUMMARY}}', summaryText);

  const client = createAnthropicClient(anthropicApiKey);
  let parsed: z.infer<typeof QuestionsShape> | undefined;
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    try {
      const response = await client.messages.create({
        model: AI_QUESTION_SUGGESTER_MODEL,
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      });

      logger.info(
        `ai usage: topic=${topicId} job=ai.suggestQuestions model=${AI_QUESTION_SUGGESTER_MODEL} in=${response.usage.input_tokens} out=${response.usage.output_tokens}`,
      );

      const text = response.content.find((block) => block.type === 'text')?.text ?? '';
      const result = QuestionsShape.safeParse(JSON.parse(extractJsonObjectText(text)));
      if (result.success) parsed = result.data;
    } catch (err) {
      logger.error(err, `ai.suggestQuestions: request failed for topic ${topicId} (attempt ${attempt + 1})`);
    }
  }

  if (!parsed) return;

  const { error } = await supabaseAdmin
    .from('topics')
    .update({ ai_discussion_questions: parsed.questions })
    .eq('id', topicId);
  if (error) {
    logger.error(error, `ai.suggestQuestions: failed to store questions for topic ${topicId}`);
    return;
  }

  await realtimeBus.broadcastRetro(topic.retro_id, {
    type: 'topic.questionsReady',
    payload: { topicId, questions: parsed.questions },
  });
}
