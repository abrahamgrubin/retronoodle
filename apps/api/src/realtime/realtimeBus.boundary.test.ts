import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_DIR = join(import.meta.dirname, '..');
const ALLOWED_FILE = join(import.meta.dirname, 'RealtimeBus.ts');

function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(full);
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) return [full];
    return [];
  });
}

describe('RealtimeBus is the only module that sends on Supabase Realtime', () => {
  it('no other file under apps/api/src calls .channel( or .httpSend(', () => {
    const offenders = collectSourceFiles(SRC_DIR)
      .filter((file) => file !== ALLOWED_FILE)
      .filter((file) => {
        const contents = readFileSync(file, 'utf8');
        return contents.includes('.channel(') || contents.includes('.httpSend(');
      });

    expect(offenders).toEqual([]);
  });
});
