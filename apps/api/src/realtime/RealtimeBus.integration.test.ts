import { randomUUID } from 'node:crypto';
import { createClient, type RealtimeChannel } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';
import type { Database } from '@retronoodle/shared';
import { RealtimeBus } from './RealtimeBus.js';

// Runs against a real Supabase project (local stack in CI, or a hosted project locally) —
// the whole point of RN-004 is proving this over the wire, not mocking it. Skips cleanly
// when the credentials aren't set, so `pnpm test` still passes with no config.
const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } = process.env;
const hasLiveSupabase = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY);

const TERMINAL_STATUSES = new Set(['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']);

function subscribeAndWait(channel: RealtimeChannel): Promise<string> {
  return new Promise((resolve) => {
    channel.subscribe((status) => {
      if (TERMINAL_STATUSES.has(status)) resolve(status);
    });
  });
}

describe.skipIf(!hasLiveSupabase)('RealtimeBus against a live Supabase project (RN-004 spike)', () => {
  // createClient validates its URL eagerly, even for a describe block vitest will skip, so a
  // placeholder is needed when the real env isn't set (the block never actually runs then).
  const admin = createClient<Database>(SUPABASE_URL || 'http://localhost:54321', SUPABASE_SERVICE_ROLE_KEY || 'x');
  const password = `RN-004-${randomUUID()}!`;
  let teamId: string | undefined;
  let memberId: string | undefined;
  let outsiderId: string | undefined;

  afterAll(async () => {
    if (teamId) await admin.from('teams').delete().eq('id', teamId);
    if (memberId) await admin.auth.admin.deleteUser(memberId);
    if (outsiderId) await admin.auth.admin.deleteUser(outsiderId);
  });

  it(
    'a signed-in team member receives a retro broadcast; a signed-in non-member cannot subscribe',
    async () => {
      const memberEmail = `rn004-member-${randomUUID()}@example.com`;
      const outsiderEmail = `rn004-outsider-${randomUUID()}@example.com`;

      const { data: memberAuth, error: memberErr } = await admin.auth.admin.createUser({
        email: memberEmail,
        password,
        email_confirm: true,
      });
      if (memberErr || !memberAuth.user) throw memberErr ?? new Error('failed to create member user');
      memberId = memberAuth.user.id;

      const { data: outsiderAuth, error: outsiderErr } = await admin.auth.admin.createUser({
        email: outsiderEmail,
        password,
        email_confirm: true,
      });
      if (outsiderErr || !outsiderAuth.user) throw outsiderErr ?? new Error('failed to create outsider user');
      outsiderId = outsiderAuth.user.id;

      await admin.from('profiles').insert([
        { id: memberId, display_name: 'RN-004 Member', email: memberEmail },
        { id: outsiderId, display_name: 'RN-004 Outsider', email: outsiderEmail },
      ]);

      teamId = randomUUID();
      await admin.from('teams').insert({ id: teamId, name: 'RN-004 spike team', created_by: memberId });
      await admin.from('team_members').insert({ team_id: teamId, user_id: memberId, role: 'admin' });

      const { data: template } = await admin
        .from('templates')
        .select('id')
        .eq('source', 'builtin')
        .limit(1)
        .single();
      if (!template) throw new Error('no builtin template seeded (see supabase/seed.sql)');

      const retroId = randomUUID();
      await admin.from('retros').insert({
        id: retroId,
        team_id: teamId,
        facilitator_id: memberId,
        template_id: template.id,
        template_source: 'builtin',
        name: 'RN-004 spike retro',
        join_code_hash: randomUUID(),
      });

      // The team member subscribes and should receive the broadcast.
      const memberClient = createClient<Database>(SUPABASE_URL ?? '', SUPABASE_ANON_KEY ?? '');
      await memberClient.auth.signInWithPassword({ email: memberEmail, password });
      const memberChannel = memberClient.channel(`retro:${retroId}`, { config: { private: true } });
      const received = new Promise((resolve) => {
        memberChannel.on('broadcast', { event: 'ping' }, (msg) => resolve(msg.payload));
      });

      expect(await subscribeAndWait(memberChannel)).toBe('SUBSCRIBED');

      const bus = new RealtimeBus(admin);
      await bus.broadcastRetro(retroId, { type: 'ping', payload: { hello: 'rn-004' } });

      await expect(received).resolves.toEqual({ hello: 'rn-004' });
      await memberClient.removeChannel(memberChannel);
      await memberClient.auth.signOut();

      // A signed-in non-member cannot subscribe to the same channel.
      const outsiderClient = createClient<Database>(SUPABASE_URL ?? '', SUPABASE_ANON_KEY ?? '');
      await outsiderClient.auth.signInWithPassword({ email: outsiderEmail, password });
      const outsiderChannel = outsiderClient.channel(`retro:${retroId}`, { config: { private: true } });

      expect(await subscribeAndWait(outsiderChannel)).not.toBe('SUBSCRIBED');

      await outsiderClient.removeChannel(outsiderChannel);
      await outsiderClient.auth.signOut();
    },
    30000,
  );
});
