import { describe, expect, it } from 'vitest';
import type { Enums, Tables, TablesInsert } from './index.js';

describe('generated db types', () => {
  it('type a full profile row', () => {
    const profile: Tables<'profiles'> = {
      id: '00000000-0000-0000-0000-000000000001',
      display_name: 'Ada Lovelace',
      email: 'ada@example.com',
      avatar_url: null,
      timezone: 'UTC',
      created_at: new Date().toISOString(),
    };

    expect(profile.display_name).toBe('Ada Lovelace');
  });

  it('type an insert with only the required fields', () => {
    const card: TablesInsert<'cards'> = {
      id: '00000000-0000-0000-0000-000000000002',
      retro_id: '00000000-0000-0000-0000-000000000003',
      column_id: '00000000-0000-0000-0000-000000000004',
      author_id: '00000000-0000-0000-0000-000000000001',
      body: 'Ship the mutation pipeline',
      position: 'a0',
    };

    expect(card.body.length).toBeLessThanOrEqual(500);
  });

  it('type the retro phase enum', () => {
    const phase: Enums<'retro_phase'> = 'write';
    expect(phase).toBe('write');
  });
});
