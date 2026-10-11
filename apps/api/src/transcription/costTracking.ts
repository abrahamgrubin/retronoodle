import type { SupabaseClient } from '@supabase/supabase-js';
import { DEEPGRAM_USD_PER_AUDIO_SECOND, type Database } from '@retronoodle/shared';

/**
 * RN-033 AC: "Cost per 45-minute retro is logged" — a running per-retro total (`transcription_
 * usage`), the same best-effort, read-add-upsert shape as aiSpendCap.ts's recordAiUsage (never
 * atomic; a lost update under concurrent writes just slightly under-counts the next read, never a
 * reason to drop audio or fail the gateway connection).
 */
export async function recordTranscriptionUsage(
  supabaseAdmin: SupabaseClient<Database>,
  retroId: string,
  audioSeconds: number,
): Promise<void> {
  if (audioSeconds <= 0) return;
  const { data: existing } = await supabaseAdmin.from('transcription_usage').select('audio_seconds, cost_usd').eq('retro_id', retroId).maybeSingle();
  const totalSeconds = (existing ? Number(existing.audio_seconds) : 0) + audioSeconds;
  const totalCost = (existing ? Number(existing.cost_usd) : 0) + audioSeconds * DEEPGRAM_USD_PER_AUDIO_SECOND;
  await supabaseAdmin
    .from('transcription_usage')
    .upsert({ retro_id: retroId, audio_seconds: totalSeconds, cost_usd: totalCost, updated_at: new Date().toISOString() });
}
