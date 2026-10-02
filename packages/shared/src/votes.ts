import { z } from 'zod';

/** "5 of 8 done voting" (RN-018) — the only thing anyone but the voter themselves ever learns
 * about anyone else's voting: an aggregate, never a per-person or per-topic breakdown. `done`
 * means a participant has spent their whole `vote_budget`. */
export const VotingProgress = z.object({
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type VotingProgress = z.infer<typeof VotingProgress>;

export const VoteAddPayload = z.object({
  topicId: z.string().uuid(),
});
export type VoteAddPayload = z.infer<typeof VoteAddPayload>;

/** Shared by vote.add and vote.remove — the full result, sent only to the voter's own `user:{id}`
 * channel (CLAUDE.md: "Hidden card text and votes never leave the server" — a non-owner's board
 * must never learn `topicId`/`myCount` for someone else's vote). `progress` is what everyone
 * *else* gets instead (`actorPrivateResult`, registry.ts) — the same aggregate, without anything
 * identifying which topic changed or who changed it. */
export const VoteAddResult = z.object({
  topicId: z.string().uuid(),
  myCount: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  progress: VotingProgress,
});
export type VoteAddResult = z.infer<typeof VoteAddResult>;

export const VoteRemovePayload = VoteAddPayload;
export type VoteRemovePayload = VoteAddPayload;

export const VoteRemoveResult = VoteAddResult;
export type VoteRemoveResult = VoteAddResult;
