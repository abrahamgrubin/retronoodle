import { z } from 'zod';

export const RetroPhase = z.enum(['setup', 'review', 'write', 'group', 'vote', 'discuss', 'wrap_up', 'closed']);
export type RetroPhase = z.infer<typeof RetroPhase>;

export const CreateRetroRequest = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  templateId: z.string().uuid(),
});
export type CreateRetroRequest = z.infer<typeof CreateRetroRequest>;

export const TemplateSource = z.enum(['builtin', 'custom']);
export type TemplateSource = z.infer<typeof TemplateSource>;

export const RetroResponse = z.object({
  id: z.string().uuid(),
  teamId: z.string().uuid(),
  name: z.string(),
  phase: RetroPhase,
  facilitatorId: z.string().uuid(),
  templateId: z.string().uuid(),
  templateSource: TemplateSource,
  createdAt: z.string(),
});
export type RetroResponse = z.infer<typeof RetroResponse>;

/** Returned once, right after create or regenerate — the plaintext code is never stored
 * (RN-006: "store only join_code_hash"), so this is the only time the API can hand it back. */
export const RetroCreatedResponse = RetroResponse.extend({
  joinCode: z.string(),
});
export type RetroCreatedResponse = z.infer<typeof RetroCreatedResponse>;

export const JoinResponse = z.object({
  retroId: z.string().uuid(),
  teamId: z.string().uuid(),
  name: z.string(),
  phase: RetroPhase,
});
export type JoinResponse = z.infer<typeof JoinResponse>;
