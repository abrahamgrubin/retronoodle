import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createTokenVerifier } from './token.js';

const SUPABASE_URL = 'https://test.supabase.co';
const KID = 'test-key';

describe('createTokenVerifier', () => {
  let keyPair: Awaited<ReturnType<typeof generateKeyPair>>;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    keyPair = await generateKeyPair('ES256');
    const publicJwk = await exportJWK(keyPair.publicKey);

    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(
        JSON.stringify({ keys: [{ ...publicJwk, kid: KID, alg: 'ES256', use: 'sig' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  async function signToken(overrides: { exp?: number } = {}): Promise<string> {
    return new SignJWT({
      email: 'ada@example.com',
      user_metadata: { full_name: 'Ada Lovelace', avatar_url: 'https://example.com/ada.png' },
    })
      .setProtectedHeader({ alg: 'ES256', kid: KID })
      .setSubject('00000000-0000-0000-0000-000000000001')
      .setIssuer(`${SUPABASE_URL}/auth/v1`)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime(overrides.exp ?? '15m')
      .sign(keyPair.privateKey);
  }

  it('verifies a valid token and returns its claims', async () => {
    const verify = createTokenVerifier(SUPABASE_URL);
    const claims = await verify(await signToken());
    expect(claims.sub).toBe('00000000-0000-0000-0000-000000000001');
    expect(claims.email).toBe('ada@example.com');
    expect(claims.user_metadata?.full_name).toBe('Ada Lovelace');
  });

  it('caches the JWKS: verifying two tokens fetches it only once', async () => {
    const verify = createTokenVerifier(SUPABASE_URL);
    await verify(await signToken());
    await verify(await signToken());
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects an expired token', async () => {
    const verify = createTokenVerifier(SUPABASE_URL);
    const expired = await signToken({ exp: Math.floor(Date.now() / 1000) - 60 });
    await expect(verify(expired)).rejects.toThrow();
  });

  it('rejects a tampered token', async () => {
    const verify = createTokenVerifier(SUPABASE_URL);
    const token = await signToken();

    // Flip the *first* character of the signature segment, not the last: a base64url group's
    // trailing character can have decoder-ignored padding bits (ES256 signatures are 64 bytes,
    // and 64 mod 3 == 1, so the last character's low bits are exactly that padding) — flipping
    // it is sometimes a no-op after decode, depending on the random key generated each run
    // (flaky in CI). The first character of a group is always fully significant.
    const [header, payload, signature] = token.split('.');
    const tamperedFirstChar = signature?.at(0) === 'a' ? 'b' : 'a';
    const tampered = `${header}.${payload}.${tamperedFirstChar}${signature?.slice(1)}`;

    await expect(verify(tampered)).rejects.toThrow();
  });
});
