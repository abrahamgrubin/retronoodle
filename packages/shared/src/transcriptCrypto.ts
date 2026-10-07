import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * RN-031: envelope encryption for transcript text (Design 10.1) — AES-256-GCM throughout, base64
 * everywhere (matches `joinCode.ts`'s hex-`text` precedent: binary values are encoded as plain
 * `text` columns, never a native Postgres `bytea`). Two layers: a master key (Render env secret
 * now, AWS KMS in production) wraps one small per-team data key (`wrapDataKey`/`unwrapDataKey`,
 * used by `apps/worker/src/transcriptKeys.ts`); that data key, never the master key directly,
 * encrypts actual transcript text (`encryptTranscriptText`/`decryptTranscriptText`).
 */

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12; // GCM's standard nonce size — not the cipher's block size.

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
}

/** `TRANSCRIPT_MASTER_KEY` must decode to exactly 32 bytes — thrown loudly at startup rather
 * than silently encrypting every team's data key with a wrong-length key later. */
export function parseMasterKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error(`TRANSCRIPT_MASTER_KEY must decode to ${KEY_LENGTH_BYTES} bytes, got ${key.length}`);
  }
  return key;
}

export function generateDataKey(): Buffer {
  return randomBytes(KEY_LENGTH_BYTES);
}

function encrypt(key: Buffer, plaintext: Buffer): EncryptedPayload {
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64') };
}

/** Throws (via node:crypto's own GCM tag check) if `payload` was tampered with, or decrypted
 * with the wrong key — GCM authenticates ciphertext, it doesn't silently return garbage. */
function decrypt(key: Buffer, payload: EncryptedPayload): Buffer {
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, 'base64')), decipher.final()]);
}

export function wrapDataKey(masterKey: Buffer, dataKey: Buffer): EncryptedPayload {
  return encrypt(masterKey, dataKey);
}

export function unwrapDataKey(masterKey: Buffer, wrapped: EncryptedPayload): Buffer {
  return decrypt(masterKey, wrapped);
}

export function encryptTranscriptText(dataKey: Buffer, plaintext: string): EncryptedPayload {
  return encrypt(dataKey, Buffer.from(plaintext, 'utf8'));
}

export function decryptTranscriptText(dataKey: Buffer, payload: EncryptedPayload): string {
  return decrypt(dataKey, payload).toString('utf8');
}
