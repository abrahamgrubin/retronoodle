import { describe, expect, it } from 'vitest';
import {
  decryptTranscriptText,
  encryptTranscriptText,
  generateDataKey,
  parseMasterKey,
  unwrapDataKey,
  wrapDataKey,
} from './transcriptCrypto.js';

describe('parseMasterKey', () => {
  it('decodes a valid 32-byte base64 key', () => {
    const key = randomBase64Key();
    expect(parseMasterKey(key)).toHaveLength(32);
  });

  it('rejects anything that does not decode to exactly 32 bytes', () => {
    expect(() => parseMasterKey(Buffer.from('too short').toString('base64'))).toThrow(/32 bytes/);
  });
});

describe('encryptTranscriptText / decryptTranscriptText', () => {
  it('round-trips plaintext', () => {
    const key = generateDataKey();
    const payload = encryptTranscriptText(key, 'this is sensitive retro discussion');
    expect(decryptTranscriptText(key, payload)).toBe('this is sensitive retro discussion');
  });

  it('never stores the plaintext inside the ciphertext field', () => {
    const key = generateDataKey();
    const payload = encryptTranscriptText(key, 'the word SECRETWORD should not leak');
    expect(payload.ciphertext).not.toContain('SECRETWORD');
  });

  it('fails closed on a tampered ciphertext (GCM auth tag check)', () => {
    const key = generateDataKey();
    const payload = encryptTranscriptText(key, 'hello');
    const tampered = { ...payload, ciphertext: Buffer.from('not the real ciphertext').toString('base64') };
    expect(() => decryptTranscriptText(key, tampered)).toThrow();
  });

  it('fails to decrypt with the wrong key', () => {
    const payload = encryptTranscriptText(generateDataKey(), 'hello');
    expect(() => decryptTranscriptText(generateDataKey(), payload)).toThrow();
  });
});

describe('wrapDataKey / unwrapDataKey', () => {
  it('round-trips a data key through the master key', () => {
    const masterKey = parseMasterKey(randomBase64Key());
    const dataKey = generateDataKey();
    const wrapped = wrapDataKey(masterKey, dataKey);
    expect(unwrapDataKey(masterKey, wrapped)).toEqual(dataKey);
  });

  it('cannot unwrap with a different master key ("destroying" a key makes it unreadable)', () => {
    const dataKey = generateDataKey();
    const wrapped = wrapDataKey(parseMasterKey(randomBase64Key()), dataKey);
    expect(() => unwrapDataKey(parseMasterKey(randomBase64Key()), wrapped)).toThrow();
  });
});

function randomBase64Key(): string {
  return generateDataKey().toString('base64');
}
