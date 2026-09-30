import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { FastifyReply, FastifyRequest } from 'fastify';

export interface AuthClaims extends JWTPayload {
  sub: string;
  email?: string;
  user_metadata?: {
    full_name?: string;
    name?: string;
    avatar_url?: string;
    picture?: string;
  };
}

export type VerifyAccessToken = (token: string) => Promise<AuthClaims>;

/**
 * `createRemoteJWKSet` fetches and caches the JWKS once; verifying a token never refetches
 * unless the token's `kid` is unseen (RN-003: "no network call per request").
 */
export function createTokenVerifier(supabaseUrl: string): VerifyAccessToken {
  const jwks = createRemoteJWKSet(new URL('/auth/v1/.well-known/jwks.json', supabaseUrl));
  return async (token) => {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: `${supabaseUrl}/auth/v1`,
      audience: 'authenticated',
    });
    return payload as AuthClaims;
  };
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
}

export function claimsToUser(claims: AuthClaims): AuthUser {
  const meta = claims.user_metadata ?? {};
  return {
    id: claims.sub,
    email: claims.email ?? '',
    displayName: meta.full_name ?? meta.name ?? claims.email ?? 'Unknown',
    avatarUrl: meta.avatar_url ?? meta.picture ?? null,
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

/** Fastify preHandler: 401s on a missing, expired or tampered token; otherwise sets request.user. */
export function createRequireAuth(verifyAccessToken: VerifyAccessToken) {
  return async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    if (!token) {
      await reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    try {
      request.user = claimsToUser(await verifyAccessToken(token));
    } catch {
      await reply.code(401).send({ error: 'unauthorized' });
    }
  };
}
