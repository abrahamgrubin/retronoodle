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
});
export type TemplateResponse = z.infer<typeof TemplateResponse>;

export const TemplatesResponse = z.array(TemplateResponse);
export type TemplatesResponse = z.infer<typeof TemplatesResponse>;
