import { MeResponse } from '@retronoodle/shared';
import { API_URL } from './api';
import { supabase } from './supabaseClient';

/** Redirects to Google, then back to the current URL (RN-003: preserve the originally
 * requested URL, e.g. a join link). */
export async function signInWithGoogle(): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured (see .env.example).');
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.href },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut();
}

/** Calls GET /me with the caller's access token, which upserts and returns their profile. */
export async function fetchMe(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<MeResponse> {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const res = await fetchImpl(`${API_URL}/me`, {
    headers: { Authorization: `Bearer ${accessToken}`, 'X-Timezone': timezone },
  });
  if (!res.ok) throw new Error(`GET /me failed: ${res.status}`);
  return MeResponse.parse(await res.json());
}
