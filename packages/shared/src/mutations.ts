import { z } from 'zod';

/** POST /retros/:id/mutations body (RN-008). Every mutation type has its own payload schema
 * below; the envelope itself only knows the type name and a client-generated mutationId used
 * for idempotency (replaying the same mutationId returns the original result, unapplied again). */
export const MutationEnvelope = z.object({
  mutationId: z.string().uuid(),
  type: z.string().min(1),
  payload: z.unknown(),
});
export type MutationEnvelope = z.infer<typeof MutationEnvelope>;

export const MutationResponse = z.object({
  seq: z.number().int().positive(),
  result: z.unknown(),
});
export type MutationResponse = z.infer<typeof MutationResponse>;

export const CardCreatePayload = z.object({
  cardId: z.string().uuid(),
  columnId: z.string().uuid(),
  body: z.string().min(1).max(500),
});
export type CardCreatePayload = z.infer<typeof CardCreatePayload>;

export const CardCreateResult = z.object({
  id: z.string().uuid(),
  columnId: z.string().uuid(),
  authorId: z.string().uuid(),
  body: z.string(),
  position: z.string(),
});
export type CardCreateResult = z.infer<typeof CardCreateResult>;
