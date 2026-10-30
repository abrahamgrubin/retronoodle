import { decryptTranscriptText, encryptTranscriptText, type EncryptedPayload } from './transcriptCrypto.js';

/**
 * RN-062: a retro's plaintext join code is never stored in Postgres (RN-006), but an invite email
 * has to contain it — and a pg-boss job payload is a Postgres row. So the API encrypts the code
 * into the payload (AES-256-GCM, same primitive as transcript text) and the worker decrypts it
 * only long enough to build the email.
 */
const KEY_LENGTH_BYTES = 32;

/** `INVITE_PAYLOAD_KEY` must decode to exactly 32 bytes — thrown at startup, not at first send. */
export function parseInvitePayloadKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error(`INVITE_PAYLOAD_KEY must decode to ${KEY_LENGTH_BYTES} bytes, got ${key.length}`);
  }
  return key;
}

export function encryptJoinCode(key: Buffer, joinCode: string): EncryptedPayload {
  return encryptTranscriptText(key, joinCode);
}

export function decryptJoinCode(key: Buffer, payload: EncryptedPayload): string {
  return decryptTranscriptText(key, payload);
}

export type { EncryptedPayload };
