import { z } from 'zod';

export const CreateTeamRequest = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
});
export type CreateTeamRequest = z.infer<typeof CreateTeamRequest>;

/** A team as seen by the caller, including the caller's own role on it. */
export const TeamResponse = z.object({
  id: z.string().uuid(),
  name: z.string(),
  createdBy: z.string().uuid(),
  retroCadenceDays: z.number().int(),
  role: z.enum(['admin', 'member']),
  createdAt: z.string(),
});
export type TeamResponse = z.infer<typeof TeamResponse>;

export const MyTeamsResponse = z.array(TeamResponse);
export type MyTeamsResponse = z.infer<typeof MyTeamsResponse>;
