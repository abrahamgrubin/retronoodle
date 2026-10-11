import { describe, expect, it, vi } from 'vitest';
import { parseMasterKey, wrapDataKey } from '@retronoodle/shared';
import { decryptForTeam, destroyTeamDataKey, encryptForTeam, getOrCreateTeamDataKey } from './transcriptKeys.js';

const masterKey = parseMasterKey(Buffer.alloc(32, 7).toString('base64'));
const teamId = '00000000-0000-4000-8000-000000000001';

/** Same thenable-chain shape as transcriptRetention.test.ts's fake — `select().eq().maybeSingle()`
 * resolves to `existingRow`, `insert()`/`delete()` resolve to `{ error: null }`. */
function fakeSupabase(existingRow: { wrapped_key: string; iv: string; auth_tag: string } | null) {
  const insert = vi.fn(async () => ({ error: null }));
  const deleteFn = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }));
  const from = vi.fn(() => ({
    select: () => ({ eq: () => ({ maybeSingle: vi.fn(async () => ({ data: existingRow, error: null })) }) }),
    insert,
    delete: deleteFn,
  }));
  return { from, insert, deleteFn };
}

describe('getOrCreateTeamDataKey', () => {
  it('creates and stores a new wrapped key when none exists yet', async () => {
    const supabaseAdmin = fakeSupabase(null);
    const key = await getOrCreateTeamDataKey(supabaseAdmin as never, masterKey, teamId);
    expect(key).toHaveLength(32);
    expect(supabaseAdmin.insert).toHaveBeenCalledWith(
      expect.objectContaining({ team_id: teamId, wrapped_key: expect.any(String), iv: expect.any(String), auth_tag: expect.any(String) }),
    );
  });

  it('unwraps and returns the existing key without inserting a new one', async () => {
    const realKey = Buffer.alloc(32, 9);
    const wrapped = wrapDataKey(masterKey, realKey);
    const supabaseAdmin = fakeSupabase({ wrapped_key: wrapped.ciphertext, iv: wrapped.iv, auth_tag: wrapped.authTag });
    const key = await getOrCreateTeamDataKey(supabaseAdmin as never, masterKey, teamId);
    expect(key).toEqual(realKey);
    expect(supabaseAdmin.insert).not.toHaveBeenCalled();
  });
});

describe('encryptForTeam / decryptForTeam', () => {
  it('round-trips plaintext through a lazily-created team key', async () => {
    let storedRow: { wrapped_key: string; iv: string; auth_tag: string } | null = null;
    const insert = vi.fn(async (row: { wrapped_key: string; iv: string; auth_tag: string }) => {
      storedRow = row;
      return { error: null };
    });
    const from = vi.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle: vi.fn(async () => ({ data: storedRow, error: null })) }) }),
      insert,
    }));
    const supabaseAdmin = { from };

    const encrypted = await encryptForTeam(supabaseAdmin as never, masterKey, teamId, 'what was actually said');
    const decrypted = await decryptForTeam(supabaseAdmin as never, masterKey, teamId, encrypted);
    expect(decrypted).toBe('what was actually said');
  });

  it('returns null once the team key has been destroyed', async () => {
    const supabaseAdmin = fakeSupabase(null); // no key row — as if destroyed
    const decrypted = await decryptForTeam(
      supabaseAdmin as never,
      masterKey,
      teamId,
      { ciphertext: 'x', iv: 'y', authTag: 'z' },
    );
    expect(decrypted).toBeNull();
  });
});

describe('destroyTeamDataKey', () => {
  it('deletes the team\'s key row', async () => {
    const supabaseAdmin = fakeSupabase(null);
    await destroyTeamDataKey(supabaseAdmin as never, teamId);
    expect(supabaseAdmin.deleteFn).toHaveBeenCalled();
  });
});
