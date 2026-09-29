import { z } from 'zod';

/** Which services a Node process starts (Design 11.1). */
export const ProcessRole = z.enum(['api', 'worker', 'all']);
export type ProcessRole = z.infer<typeof ProcessRole>;

export function parseRole(value: string | undefined): ProcessRole {
  const parsed = ProcessRole.safeParse(value ?? 'all');
  if (!parsed.success) {
    throw new Error(`Invalid ROLE "${value}". Expected one of: api, worker, all.`);
  }
  return parsed.data;
}

export function startsApi(role: ProcessRole): boolean {
  return role === 'api' || role === 'all';
}

export function startsWorker(role: ProcessRole): boolean {
  return role === 'worker' || role === 'all';
}
