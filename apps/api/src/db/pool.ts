import { Pool } from 'pg';

/**
 * The mutation pipeline (RN-008) is the one place the API talks to Postgres directly instead of
 * through supabase-js/PostgREST: assigning a gapless, race-free `seq` per retro needs a real
 * `SELECT ... FOR UPDATE` transaction, which PostgREST doesn't expose. A small pool is enough —
 * Supabase's session pooler (not the transaction pooler) is what DATABASE_URL points at, so a
 * checked-out client supports the full BEGIN/FOR UPDATE/COMMIT lifecycle without restriction.
 */
export function createPool(databaseUrl: string): Pool {
  return new Pool({ connectionString: databaseUrl, max: 10 });
}
