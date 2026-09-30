import { describe, expect, it } from 'vitest';
import type { Tables } from '@retronoodle/shared';

describe('generated db types resolve through @retronoodle/shared', () => {
  it('types a full retro row', () => {
    const retro: Tables<'retros'> = {
      id: '00000000-0000-0000-0000-000000000001',
      team_id: '00000000-0000-0000-0000-000000000002',
      facilitator_id: '00000000-0000-0000-0000-000000000003',
      template_id: '00000000-0000-0000-0000-000000000004',
      name: 'Sprint 12 retro',
      phase: 'write',
      template_source: 'builtin',
      join_code_hash: 'hash',
      cards_revealed: false,
      vote_budget: 3,
      phase_deadline: null,
      phase_remaining_ms: null,
      next_retro_at: null,
      is_demo: false,
      closed_with_override: false,
      created_at: new Date().toISOString(),
      closed_at: null,
    };

    expect(retro.phase).toBe('write');
  });
});
