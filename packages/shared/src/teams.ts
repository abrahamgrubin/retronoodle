import { z } from 'zod';

export const CreateTeamRequest = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
});
export type CreateTeamRequest = z.infer<typeof CreateTeamRequest>;

/** RN-031: "24 h after close (default), 30 or 90 days" — the only three values
 * `transcript_retention_days` ever holds (DB check constraint mirrors this). */
export const TranscriptRetentionDays = z.union([z.literal(1), z.literal(30), z.literal(90)]);
export type TranscriptRetentionDays = z.infer<typeof TranscriptRetentionDays>;

/** A team as seen by the caller, including the caller's own role on it. */
export const TeamResponse = z.object({
  id: z.string().uuid(),
  name: z.string(),
  createdBy: z.string().uuid(),
  retroCadenceDays: z.number().int(),
  transcriptRetentionDays: TranscriptRetentionDays,
  role: z.enum(['admin', 'member']),
  createdAt: z.string(),
});
export type TeamResponse = z.infer<typeof TeamResponse>;

export const MyTeamsResponse = z.array(TeamResponse);
export type MyTeamsResponse = z.infer<typeof MyTeamsResponse>;

/** `PATCH /teams/:id` (RN-031): admin-only, currently the one team setting anyone can change
 * after creation. */
export const UpdateTeamRequest = z.object({
  transcriptRetentionDays: TranscriptRetentionDays,
});
export type UpdateTeamRequest = z.infer<typeof UpdateTeamRequest>;
