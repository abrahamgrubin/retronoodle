import { describe, expect, it } from 'vitest';
import type { Tables } from '@retronoodle/shared';

describe('generated db types resolve through @retronoodle/shared', () => {
  it('types a card row', () => {
    const card: Tables<'cards'> = {
      id: '00000000-0000-0000-0000-000000000001',
      retro_id: '00000000-0000-0000-0000-000000000002',
      column_id: '00000000-0000-0000-0000-000000000003',
      author_id: '00000000-0000-0000-0000-000000000004',
      topic_id: null,
      body: 'Ship the mutation pipeline',
      position: 'a0',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    expect(card.body).toContain('mutation pipeline');
  });
});
