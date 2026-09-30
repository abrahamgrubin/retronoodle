import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@retronoodle/shared';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** Null until VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY are set, so the app still runs locally
 * before Supabase is configured (mirrors the API's DATABASE_URL fallback). */
export const supabase: SupabaseClient<Database> | null =
  supabaseUrl && supabaseAnonKey ? createClient<Database>(supabaseUrl, supabaseAnonKey) : null;
