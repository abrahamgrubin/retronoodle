import type { Pool } from 'pg';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@retronoodle/shared';
import { MutationRegistry } from '../mutations/index.js';
import type { RealtimeBus } from '../realtime/RealtimeBus.js';
import type { VerifyAccessToken } from '../auth/index.js';
import type { ServerOptions } from '../server.js';

/** Fills in the parts of ServerOptions['auth'] a given test doesn't care about (an unused pool,
 * an empty mutation registry, a no-op RealtimeBus), so each test only has to specify what it's
 * actually exercising. */
export function testAuthOptions(overrides: {
  verifyAccessToken: VerifyAccessToken;
  supabaseAdmin: SupabaseClient<Database>;
  realtimeBus?: RealtimeBus;
  pool?: Pool;
  mutationRegistry?: MutationRegistry;
}): NonNullable<ServerOptions['auth']> {
  return {
    verifyAccessToken: overrides.verifyAccessToken,
    supabaseAdmin: overrides.supabaseAdmin,
    realtimeBus: overrides.realtimeBus ?? ({} as RealtimeBus),
    pool: overrides.pool ?? ({} as Pool),
    mutationRegistry: overrides.mutationRegistry ?? new MutationRegistry(),
  };
}
