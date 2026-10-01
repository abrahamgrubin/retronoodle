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
