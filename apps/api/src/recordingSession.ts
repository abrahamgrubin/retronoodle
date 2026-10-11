import type { SupabaseClient } from '@supabase/supabase-js';
import { RecordingSession, type Database } from '@retronoodle/shared';

// RN-032: a participant is "online" if their last heartbeat (POST /retros/:id/heartbeat) landed
// within this window. Heartbeats go out every ~10-15s (BoardPage.tsx) — 30s gives one missed
// beat's worth of slack before someone's treated as gone. Shared by recordingStart.ts (who to
// seed consents for) and the heartbeat route itself (nothing reads it there directly today, but
// keeping the one definition in one place avoids the two drifting apart later).
export const ONLINE_WINDOW_SECONDS = 30;

interface SessionRow {
  id: string;
  started_by: string;
  facilitator_confirmed_at: string;
  status: string;
  started_at: string | null;
  stopped_at: string | null;
}

interface ConsentRow {
  user_id: string;
  outcome: string;
  responded_at: string | null;
}

export function buildRecordingSession(session: SessionRow, consents: ConsentRow[]): RecordingSession {
  return RecordingSession.parse({
    id: session.id,
    startedBy: session.started_by,
    facilitatorConfirmedAt: session.facilitator_confirmed_at,
    status: session.status,
    startedAt: session.started_at,
    stoppedAt: session.stopped_at,
    consents: consents.map((c) => ({ userId: c.user_id, outcome: c.outcome, respondedAt: c.responded_at })),
  });
}

/**
 * RN-032: the retro's current non-stopped recording session, with its consents — `null` if none
 * exists yet, or the last one already stopped. Shared by GET /board (the initial snapshot) and
 * POST /retros/:id/heartbeat (to detect and broadcast a late joiner's pause).
 */
export async function fetchActiveRecordingSession(
  supabaseAdmin: SupabaseClient<Database>,
  retroId: string,
): Promise<{ data: RecordingSession | null; error: unknown }> {
  const { data: session, error: sessionError } = await supabaseAdmin
    .from('recording_sessions')
    .select()
    .eq('retro_id', retroId)
    .neq('status', 'stopped')
    .maybeSingle();
  if (sessionError) return { data: null, error: sessionError };
  if (!session) return { data: null, error: null };

  const { data: consents, error: consentsError } = await supabaseAdmin
    .from('recording_consents')
    .select('user_id, outcome, responded_at')
    .eq('session_id', session.id);
  if (consentsError) return { data: null, error: consentsError };

  return { data: buildRecordingSession(session, consents ?? []), error: null };
}
