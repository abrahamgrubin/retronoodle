import { createHash, randomBytes } from 'node:crypto';

/** 128-bit random join code, base64url-encoded (RN-006, Design 3.3). */
export function generateJoinCode(): string {
  return randomBytes(16).toString('base64url');
}

/** Only the hash is ever stored — the plaintext code is returned once, at creation or
 * regeneration, and never persisted (RN-006: "the plaintext code is never stored"). */
export function hashJoinCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}
