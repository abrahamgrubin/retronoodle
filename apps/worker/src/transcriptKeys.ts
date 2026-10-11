import type { SupabaseClient } from '@supabase/supabase-js';
import {
  decryptTranscriptText,
  encryptTranscriptText,
  generateDataKey,
  unwrapDataKey,
  wrapDataKey,
  type Database,
  type EncryptedPayload,
} from '@retronoodle/shared';

/**
 * RN-031: looks up a team's wrapped AES-256-GCM data key in `team_transcript_keys`, unwrapping it
 * with the master key — or, the first time a team needs one, generates, wraps and stores a new
 * one. Lazy rather than provisioned at team-creation time: most teams have no transcripts at all
 * before RN-033's capture pipeline exists to write any.
 */
export async function getOrCreateTeamDataKey(
  supabaseAdmin: SupabaseClient<Database>,
  masterKey: Buffer,
  teamId: string,
): Promise<Buffer> {
  const { data: existing, error } = await supabaseAdmin
    .from('team_transcript_keys')
    .select('wrapped_key, iv, auth_tag')
    .eq('team_id', teamId)
    .maybeSingle();
  if (error) throw error;
  if (existing) {
    return unwrapDataKey(masterKey, { ciphertext: existing.wrapped_key, iv: existing.iv, authTag: existing.auth_tag });
  }

  const dataKey = generateDataKey();
  const wrapped = wrapDataKey(masterKey, dataKey);
  const { error: insertError } = await supabaseAdmin
    .from('team_transcript_keys')
    .insert({ team_id: teamId, wrapped_key: wrapped.ciphertext, iv: wrapped.iv, auth_tag: wrapped.authTag });
  if (insertError) throw insertError;
  return dataKey;
}

/** RN-031 AC: "Destroying a team key makes its transcripts unreadable" — crypto-shredding.
 * Deleting the wrapped key, not touching `transcript_segments` at all, is enough: every existing
 * ciphertext for this team becomes permanently unrecoverable the moment this row is gone. */
export async function destroyTeamDataKey(supabaseAdmin: SupabaseClient<Database>, teamId: string): Promise<void> {
  const { error } = await supabaseAdmin.from('team_transcript_keys').delete().eq('team_id', teamId);
  if (error) throw error;
}

export async function encryptForTeam(
  supabaseAdmin: SupabaseClient<Database>,
  masterKey: Buffer,
  teamId: string,
  plaintext: string,
): Promise<EncryptedPayload> {
  const dataKey = await getOrCreateTeamDataKey(supabaseAdmin, masterKey, teamId);
  return encryptTranscriptText(dataKey, plaintext);
}

/** Returns `null` (rather than throwing) once the team's key has been destroyed — that's the
 * expected shape of "this team's transcripts are now unreadable," not an error to log. */
export async function decryptForTeam(
  supabaseAdmin: SupabaseClient<Database>,
  masterKey: Buffer,
  teamId: string,
  payload: EncryptedPayload,
): Promise<string | null> {
  const { data: existing, error } = await supabaseAdmin
    .from('team_transcript_keys')
    .select('wrapped_key, iv, auth_tag')
    .eq('team_id', teamId)
    .maybeSingle();
  if (error) throw error;
  if (!existing) return null;
  const dataKey = unwrapDataKey(masterKey, { ciphertext: existing.wrapped_key, iv: existing.iv, authTag: existing.auth_tag });
  return decryptTranscriptText(dataKey, payload);
}
