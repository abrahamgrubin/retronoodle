import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@retronoodle/shared';

export interface RealtimeEvent {
  type: string;
  payload: unknown;
}

/**
 * The only module that sends on Supabase Realtime (CLAUDE.md: "All Realtime sends go through
 * RealtimeBus"). Uses a service-role client and `httpSend` (REST, no websocket subscription
 * needed) — RLS never applies to service_role, so this bypasses the Realtime listen policy
 * (RN-004, Design 4.9), which only gates who may *subscribe*, not who may send.
 */
export class RealtimeBus {
  constructor(private readonly client: SupabaseClient<Database>) {}

  /** Broadcasts to `retro:{retroId}` — any member of the retro's team may listen. */
  async broadcastRetro(retroId: string, event: RealtimeEvent): Promise<void> {
    await this.send(`retro:${retroId}`, event);
  }

  /** Broadcasts to `user:{userId}` — only that user may listen. */
  async broadcastUser(userId: string, event: RealtimeEvent): Promise<void> {
    await this.send(`user:${userId}`, event);
  }

  private async send(topic: string, event: RealtimeEvent): Promise<void> {
    const channel = this.client.channel(topic, { config: { private: true } });
    try {
      const result = await channel.httpSend(event.type, event.payload);
      if (!result.success) {
        throw new Error(`RealtimeBus: broadcast to "${topic}" failed (${result.status}): ${result.error}`);
      }
    } finally {
      await this.client.removeChannel(channel);
    }
  }
}
