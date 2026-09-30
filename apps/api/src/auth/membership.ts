import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@retronoodle/shared';
import type { TeamRole } from './can.js';

/** The caller's role on a team, resolved fresh from the database on every call — RN-005:
 * "Membership is checked on every request," so a removed member's next request sees it. */
export async function getTeamRole(
  supabaseAdmin: SupabaseClient<Database>,
  teamId: string,
  userId: string,
): Promise<TeamRole | null> {
  const { data } = await supabaseAdmin
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .maybeSingle();
  return data?.role ?? null;
}
