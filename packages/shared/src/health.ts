import { z } from 'zod';

/** Response body of GET /health. Shared so the web app and API agree on the shape. */
export const HealthResponse = z.object({
  ok: z.literal(true),
  time: z.string().datetime(),
});

export type HealthResponse = z.infer<typeof HealthResponse>;
