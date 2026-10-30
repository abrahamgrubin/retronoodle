import { z } from 'zod';

/** `GET /teams/:id/members` (RN-062): just enough to render an invite checklist. Deliberately no
 * email address — the server resolves those itself when queuing invites, so teammates' emails
 * never reach another member's browser. */
export const TeamMemberSummary = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
});
export type TeamMemberSummary = z.infer<typeof TeamMemberSummary>;

export const TeamMembersResponse = z.array(TeamMemberSummary);
export type TeamMembersResponse = z.infer<typeof TeamMembersResponse>;

export const MAX_INVITE_USER_IDS = 200;
export const MAX_INVITE_EMAILS = 50;

/** `POST /retros/:id/invites` (RN-062). `joinCode` is the plaintext code the facilitator's browser
 * already holds (the server only keeps its hash); it must match the retro's current code. */
export const SendInvitesRequest = z.object({
  joinCode: z.string().min(1).max(100),
  userIds: z.array(z.string().uuid()).max(MAX_INVITE_USER_IDS).default([]),
  emails: z.array(z.string().trim().toLowerCase().pipe(z.email().max(254))).max(MAX_INVITE_EMAILS).default([]),
});
export type SendInvitesRequest = z.input<typeof SendInvitesRequest>;

export const SendInvitesResponse = z.object({
  queued: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});
export type SendInvitesResponse = z.infer<typeof SendInvitesResponse>;
