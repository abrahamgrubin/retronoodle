import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@retronoodle/shared';
import type { AuthUser } from './token.js';

export type ProfileRow = Database['public']['Tables']['profiles']['Row'];

/**
 * Upserts the caller's profile from their JWT claims. `profiles.id` is what `team_members` and
 * every other per-user row's foreign key points at, so anything that can add someone to a team
 * (GET /me, and GET /join/:code for a brand-new user who never visited the main app) must call
 * this first — otherwise the insert fails with a foreign key violation. Found live by RN-006:
 * a new user landing straight on the join page, never having hit GET /me, had no profiles row.
 */
export async function upsertProfile(
  supabaseAdmin: SupabaseClient<Database>,
  user: AuthUser,
  timezone: string,
): Promise<{ data: ProfileRow | null; error: unknown }> {
  return supabaseAdmin
    .from('profiles')
    .upsert(
      {
        id: user.id,
        display_name: user.displayName,
        email: user.email,
        avatar_url: user.avatarUrl,
        timezone,
      },
      { onConflict: 'id' },
    )
    .select()
    .single();
}

export function timezoneFromHeader(headerValue: unknown): string {
  return typeof headerValue === 'string' && headerValue.length > 0 ? headerValue : 'UTC';
}
