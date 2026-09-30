import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@retronoodle/shared';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** Null until VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY are set, so the app still runs locally
 * before Supabase is configured (mirrors the API's DATABASE_URL fallback). */
export const supabase: SupabaseClient<Database> | null =
  supabaseUrl && supabaseAnonKey ? createClient<Database>(supabaseUrl, supabaseAnonKey) : null;

// Dev-only test hook (RN-011's e2e/hidden-cards.spec.ts): lets Playwright establish a session via
// supabase.auth.setSession() with a password-signed-in test user, bypassing the real Google OAuth
// UI it can't drive. import.meta.env.DEV is false in a production build, so this never ships.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __supabase?: typeof supabase }).__supabase = supabase;
}
