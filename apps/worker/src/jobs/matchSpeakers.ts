import type { SupabaseClient } from '@supabase/supabase-js';
import { hungarianAssign, scoreSpeakerOverlap, SPEAKER_MATCH_THRESHOLD, type Database } from '@retronoodle/shared';
import type { WorkerLogger } from '../logger.js';

export interface MatchSpeakersJobData {
  topicId: string;
}

export interface MatchSpeakersDeps {
  supabaseAdmin: SupabaseClient<Database>;
  logger: WorkerLogger;
}

/**
 * transcription.matchSpeakers (RN-036): one diarized voice (`speaker_tag`) per transcript turn,
 * one set of on-device VAD intervals (`speech_activity`) per participant — matched via overlap
 * score (RN-036's own `scoreSpeakerOverlap`, delay-searched) and a Hungarian assignment so two
 * voices never compete for the same strongest-looking participant. Auto-assigns every
 * `speaker_tag` whose best score clears SPEAKER_MATCH_THRESHOLD; everything else stays
 * `speaker_user_id: null` and surfaces in "Who is this?" (computed from transcript_segments
 * directly in board.ts, not stored separately). `speech_activity` rows for this topic are deleted
 * once matching has run, whether or not every tag found a confident match (the story's own AC:
 * "speech_activity rows are gone after matching" — not "...after a successful match").
 */
export async function runMatchSpeakersJob(data: MatchSpeakersJobData, deps: MatchSpeakersDeps): Promise<void> {
  const { topicId } = data;
  const { supabaseAdmin, logger } = deps;

  const { data: segments, error: segmentsError } = await supabaseAdmin
    .from('transcript_segments')
    .select('id, retro_id, speaker_tag, start_ms, end_ms')
    .eq('topic_id', topicId)
    .not('speaker_tag', 'is', null);
  if (segmentsError) {
    logger.error(segmentsError, `transcription.matchSpeakers: failed to read segments for topic ${topicId}`);
    return;
  }
  if (!segments || segments.length === 0) return;

  const retroId = segments[0]!.retro_id;

  const { data: activity, error: activityError } = await supabaseAdmin
    .from('speech_activity')
    .select('id, user_id, start_ms, end_ms')
    .eq('topic_id', topicId);
  if (activityError) {
    logger.error(activityError, `transcription.matchSpeakers: failed to read speech activity for topic ${topicId}`);
    return;
  }

  const turnsByTag = new Map<number, { startMs: number; endMs: number }[]>();
  for (const segment of segments) {
    const tag = segment.speaker_tag!;
    const turns = turnsByTag.get(tag) ?? [];
    turns.push({ startMs: segment.start_ms, endMs: segment.end_ms });
    turnsByTag.set(tag, turns);
  }

  const intervalsByUser = new Map<string, { startMs: number; endMs: number }[]>();
  for (const row of activity ?? []) {
    const intervals = intervalsByUser.get(row.user_id) ?? [];
    intervals.push({ startMs: row.start_ms, endMs: row.end_ms });
    intervalsByUser.set(row.user_id, intervals);
  }

  if (intervalsByUser.size > 0) {
    const tags = [...turnsByTag.keys()];
    const userIds = [...intervalsByUser.keys()];
    const scoreMatrix = tags.map((tag) => userIds.map((userId) => scoreSpeakerOverlap(turnsByTag.get(tag)!, intervalsByUser.get(userId)!)));
    const assignment = hungarianAssign(scoreMatrix);

    for (let i = 0; i < tags.length; i++) {
      const col = assignment[i];
      if (col === null || col === undefined) continue;
      const score = scoreMatrix[i]![col]!;
      if (score < SPEAKER_MATCH_THRESHOLD) continue;
      const tag = tags[i]!;
      const userId = userIds[col]!;
      const { error: updateError } = await supabaseAdmin
        .from('transcript_segments')
        .update({ speaker_user_id: userId })
        .eq('topic_id', topicId)
        .eq('speaker_tag', tag);
      if (updateError) {
        logger.error(updateError, `transcription.matchSpeakers: failed to assign speaker for topic ${topicId} tag ${tag}`);
      }
    }
  }

  const { error: deleteError } = await supabaseAdmin.from('speech_activity').delete().eq('topic_id', topicId);
  if (deleteError) {
    logger.error(deleteError, `transcription.matchSpeakers: failed to clear speech activity for topic ${topicId}`);
  }

  logger.info(`transcription.matchSpeakers: matched ${turnsByTag.size} voice(s) for retro ${retroId} topic ${topicId}`);
}
