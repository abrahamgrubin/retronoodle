import { z } from 'zod';
import { TemplateSource } from './retros.js';

export const TemplateColumn = z.object({
  title: z.string(),
  prompt: z.string().nullable().optional(),
  color: z.string(),
});
export type TemplateColumn = z.infer<typeof TemplateColumn>;

export const TemplateResponse = z.object({
  id: z.string().uuid(),
  name: z.string(),
  source: TemplateSource,
  columns: z.array(TemplateColumn),
  // Shown on the picker card (name + image + description, Material's own card pattern) — null
  // for a team's own custom template until they set one; never required to create a retro.
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
});
export type TemplateResponse = z.infer<typeof TemplateResponse>;

export const TemplatesResponse = z.array(TemplateResponse);
export type TemplatesResponse = z.infer<typeof TemplatesResponse>;
