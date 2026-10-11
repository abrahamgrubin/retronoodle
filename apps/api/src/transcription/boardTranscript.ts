import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, TranscriptSegment, UnmatchedSpeaker } from '@retronoodle/shared';
import { decryptForTeam, parseMasterKey } from '@retronoodle/worker';

interface TranscriptSegmentRow {
  id: string;
  topic_id: string | null;
  speaker_tag: number | null;
  speaker_user_id: string | null;
  ciphertext: string;
  iv: string;
  auth_tag: string;
  start_ms: number;
  end_ms: number;
  is_gap_marker: boolean;
  created_at: string;
}

/**
 * RN-033/034/036: decrypts and shapes this retro's transcript for GET /board — null (not thrown)
 * when there's no master key configured, since a retro with no key never had any segments written
 * in the first place (audioGateway.ts refuses to persist without one); a segment whose team key
 * has since been destroyed (crypto-shredded, RN-031) is silently dropped rather than shown as
 * garbage, matching "destroying a team key makes its transcripts unreadable."
 */
export async function buildTranscriptSegments(
  supabaseAdmin: SupabaseClient<Database>,
  transcriptMasterKey: string | undefined,
  retroId: string,
  teamId: string,
): Promise<{ segments: TranscriptSegment[]; error: unknown }> {
  if (!transcriptMasterKey) return { segments: [], error: null };

  const { data: rows, error } = await supabaseAdmin
    .from('transcript_segments')
    .select('id, topic_id, speaker_tag, speaker_user_id, ciphertext, iv, auth_tag, start_ms, end_ms, is_gap_marker, created_at')
    .eq('retro_id', retroId)
    .order('start_ms');
  if (error) return { segments: [], error };

  const masterKey = parseMasterKey(transcriptMasterKey);
  const segments: TranscriptSegment[] = [];
  for (const row of (rows ?? []) as TranscriptSegmentRow[]) {
    const text = await decryptForTeam(supabaseAdmin, masterKey, teamId, { ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag });
    if (text === null) continue;
    segments.push({
      id: row.id,
      retroId,
      topicId: row.topic_id,
      speakerTag: row.speaker_tag,
      speakerUserId: row.speaker_user_id,
      text,
      startMs: row.start_ms,
      endMs: row.end_ms,
      isGapMarker: row.is_gap_marker,
      createdAt: row.created_at,
    });
  }
  return { segments, error: null };
}

/** RN-036: "Who is this?" lists one entry per (topic, diarized voice) still unmatched, with a
 * short quote — derived from the already-decrypted segments above, not a separate query. */
export function buildUnmatchedSpeakers(segments: TranscriptSegment[]): UnmatchedSpeaker[] {
  const byKey = new Map<string, UnmatchedSpeaker>();
  for (const segment of segments) {
    if (segment.topicId === null || segment.speakerTag === null || segment.speakerUserId !== null || segment.isGapMarker) continue;
    const key = `${segment.topicId}:${segment.speakerTag}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.segmentIds.push(segment.id);
    } else {
      byKey.set(key, { topicId: segment.topicId, speakerTag: segment.speakerTag, sampleText: segment.text, segmentIds: [segment.id] });
    }
  }
  return [...byKey.values()];
}
