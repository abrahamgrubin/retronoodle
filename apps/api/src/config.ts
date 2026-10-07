import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseRole, type ProcessRole } from '@retronoodle/shared';

export interface Config {
  role: ProcessRole;
  port: number;
  webOrigin: string;
  databaseUrl: string | undefined;
  supabaseUrl: string | undefined;
  supabaseServiceRoleKey: string | undefined;
  // RN-017: undefined means ai.groupCards runs as a no-op ("failure shows nothing and manual
  // grouping still works") — never required to start either role.
  anthropicApiKey: string | undefined;
  // RN-027: "Claude spend cap $5/month in config" — undefined means no cap is enforced at all
  // (matches .env.example's own documented default of 5, but never assumed here).
  aiMonthlyCapUsd: number | undefined;
  // RN-031: base64, 32 bytes once decoded — wraps every team's own transcript data key. Only the
  // nightly retention job (deletion, no decryption needed) runs without this; actually
  // encrypting/decrypting transcript text (RN-033's gateway) requires it.
  transcriptMasterKey: string | undefined;
  isProduction: boolean;
}

/** Loads the repo-root .env in development, if present. Production sets real env vars. */
export function loadDotEnv(): void {
  const envPath = fileURLToPath(new URL('../../../.env', import.meta.url));
  if (existsSync(envPath)) process.loadEnvFile(envPath);
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    role: parseRole(env.ROLE),
    port: Number(env.PORT ?? 3000),
    webOrigin: env.WEB_ORIGIN ?? 'http://localhost:5173',
    databaseUrl: env.DATABASE_URL || undefined,
    supabaseUrl: env.SUPABASE_URL || undefined,
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY || undefined,
    anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
    aiMonthlyCapUsd: env.AI_MONTHLY_CAP_USD ? Number(env.AI_MONTHLY_CAP_USD) : undefined,
    transcriptMasterKey: env.TRANSCRIPT_MASTER_KEY || undefined,
    isProduction: env.NODE_ENV === 'production',
  };
}
