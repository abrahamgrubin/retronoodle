import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@retronoodle/shared';
import type { WorkerLogger } from '../logger.js';

const RETENTION_TIERS = [1, 30, 90] as const;

export interface TranscriptRetentionDeps {
  supabaseAdmin: SupabaseClient<Database>;
  logger: WorkerLogger;
}

/**
 * RN-031: "Nightly pg-boss job deletes expired transcripts" — 24h after close by default, or 30
 * or 90 days once a team's admin switches it. Three fixed tiers rather than a per-team computed
 * interval: `transcript_retention_days` only ever holds one of those three values (DB check
 * constraint), so each tier is one constant-cutoff query, not an N+1 loop over every team.
 * Retention only ever starts counting from `retros.closed_at` — a still-open retro's transcript
 * is never touched, however old it is.
 */
export async function runTranscriptRetentionJob({ supabaseAdmin, logger }: TranscriptRetentionDeps): Promise<void> {
  for (const days of RETENTION_TIERS) {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();

    const { data: teams, error: teamsError } = await supabaseAdmin.from('teams').select('id').eq('transcript_retention_days', days);
    if (teamsError) {
      logger.error(teamsError, `transcript retention: failed to list teams at ${days}-day retention`);
      continue;
    }
    const teamIds = (teams ?? []).map((t) => t.id);
    if (teamIds.length === 0) continue;

    const { data: retros, error: retrosError } = await supabaseAdmin
      .from('retros')
      .select('id')
      .in('team_id', teamIds)
      .eq('phase', 'closed')
      .lt('closed_at', cutoff);
    if (retrosError) {
      logger.error(retrosError, `transcript retention: failed to list expired retros at ${days}-day retention`);
      continue;
    }
    const retroIds = (retros ?? []).map((r) => r.id);
    if (retroIds.length === 0) continue;

    const { error: deleteError } = await supabaseAdmin.from('transcript_segments').delete().in('retro_id', retroIds);
    if (deleteError) logger.error(deleteError, `transcript retention: failed to delete expired transcripts at ${days}-day retention`);
  }
}
