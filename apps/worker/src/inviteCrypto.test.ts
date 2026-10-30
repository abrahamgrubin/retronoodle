import { describe, expect, it } from 'vitest';
import { decryptJoinCode, encryptJoinCode, parseInvitePayloadKey } from './inviteCrypto.js';

describe('inviteCrypto', () => {
  const key = Buffer.alloc(32, 1);

  it('round-trips and never leaves the plaintext in the payload', () => {
    const payload = encryptJoinCode(key, 'secret-join-code');
    expect(JSON.stringify(payload)).not.toContain('secret-join-code');
    expect(decryptJoinCode(key, payload)).toBe('secret-join-code');
  });

  it('fails to decrypt with the wrong key', () => {
    const payload = encryptJoinCode(key, 'secret-join-code');
    expect(() => decryptJoinCode(Buffer.alloc(32, 2), payload)).toThrow();
  });

  it('requires a 32-byte key', () => {
    expect(() => parseInvitePayloadKey(Buffer.alloc(16).toString('base64'))).toThrow(/INVITE_PAYLOAD_KEY/);
    expect(parseInvitePayloadKey(Buffer.alloc(32).toString('base64'))).toHaveLength(32);
  });
});
