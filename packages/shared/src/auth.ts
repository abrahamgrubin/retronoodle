import { z } from 'zod';

/** Response body of GET /me. Shared so the web app and API agree on the shape. */
export const MeResponse = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  email: z.string(),
  avatarUrl: z.string().nullable(),
  timezone: z.string(),
});

export type MeResponse = z.infer<typeof MeResponse>;
