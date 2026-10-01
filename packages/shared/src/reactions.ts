import { z } from 'zod';

/** The reaction picker's fixed quick-set (RN-016 layout note, verbatim) — not a full emoji
 * library; the picker's "search" narrows this same 12, it doesn't look anything else up. Also
 * the server-side allow-list: `reaction.toggle` rejects anything outside it. */
export const EMOJI_QUICK_SET = ['👍', '❤️', '😂', '🎉', '👀', '🙌', '💡', '🔥', '😬', '🤔', '👏', '🚀'] as const;
export const Emoji = z.enum(EMOJI_QUICK_SET);
export type Emoji = z.infer<typeof Emoji>;

/** One card's reactions for a single emoji (RN-016) — `userIds`, not a bare count, so every
 * client can derive both the count and "is this one of mine" locally without a viewer-specific
 * broadcast shape. Unlike RN-011's hidden cards, nothing here needs to be kept from anyone who
 * can already see the card — reactions are never shown on a hidden card in the first place. */
export const ReactionSummary = z.object({
  emoji: Emoji,
  userIds: z.array(z.string().uuid()),
});
export type ReactionSummary = z.infer<typeof ReactionSummary>;
