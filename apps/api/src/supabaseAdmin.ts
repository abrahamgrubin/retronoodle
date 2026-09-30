import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@retronoodle/shared';

/** Server-side client using the service role key, which bypasses RLS. Never expose this key. */
export function createSupabaseAdmin(url: string, serviceRoleKey: string): SupabaseClient<Database> {
  return createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
