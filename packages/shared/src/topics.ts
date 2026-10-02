import { z } from 'zod';

/** A group of cards (RN-015). Membership lives on the card side (`BoardCard.topicId`), not here —
 * a topic doesn't carry its own card list, so there's nothing to keep in sync when a card joins
 * or leaves one. Topics have no `position`: a group's place in its column is derived client-side
 * from the minimum position among its member cards (see BoardPage.tsx's `buildColumnRows`),
 * rather than adding a schema column a mutation would also have to maintain. */
export const Topic = z.object({
  id: z.string().uuid(),
  columnId: z.string().uuid(),
  name: z.string(),
  // RN-018: "no browser receives ... topic totals" during Vote — this is never live-updated as
  // votes come in (see voteHelpers.ts), only set once at the vote->discuss transition, so it's
  // structurally 0 (not merely redacted) for every topic until reveal. No separate "hidden"
  // state needed: the client only ever renders this once the phase has moved past Vote.
  voteCount: z.number().int().nonnegative(),
  // RN-019: a fractional-indexing text key, null until vote->discuss assigns one to every topic
  // (onTransition.ts) — "initially vote order," then reorderable via queue.reorder.
  discussionOrder: z.string().nullable(),
  // RN-019: "each topic change stamps started_at on the old topic [no — ends it] and started_at
  // on the new one" — null means never discussed ("not discussed" in Wrap up). The *current*
  // topic is simply whichever one has `startedAt` set and `endedAt` still null; there's no
  // separate "is this the current topic" flag to keep in sync.
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
});
export type Topic = z.infer<typeof Topic>;

const DEFAULT_TOPIC_NAME_LENGTH = 60;

/** The group-name default (layout spec: "default: first card's text, truncated") — used both by
 * the server when `topic.createFromCards`'s payload omits `name` and by the client's optimistic
 * reduce for the same mutation, so the two never briefly disagree. */
export function defaultTopicName(cardBody: string): string {
  const trimmed = cardBody.trim();
  return trimmed.length > DEFAULT_TOPIC_NAME_LENGTH ? `${trimmed.slice(0, DEFAULT_TOPIC_NAME_LENGTH)}…` : trimmed;
}
