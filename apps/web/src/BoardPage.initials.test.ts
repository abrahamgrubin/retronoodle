import { describe, expect, it } from 'vitest';
import { colorForId, columnPalette, initialsFor } from './BoardPage';

describe('initialsFor (RN-044: avatar stack initials)', () => {
  it('takes the first letter of a single name', () => {
    expect(initialsFor('Cher')).toBe('C');
  });

  it('takes the first letter of the first and last word for a full name', () => {
    expect(initialsFor('Ada Lovelace')).toBe('AL');
  });

  it('ignores a middle name', () => {
    expect(initialsFor('Ada Mary Lovelace')).toBe('AL');
  });

  it('uppercases lowercase input', () => {
    expect(initialsFor('ada lovelace')).toBe('AL');
  });

  it('collapses extra whitespace', () => {
    expect(initialsFor('  Ada   Lovelace  ')).toBe('AL');
  });

  it('returns empty for a blank name rather than throwing', () => {
    expect(initialsFor('   ')).toBe('');
  });
});

describe('colorForId (RN-044: avatar stack colors)', () => {
  it('is deterministic for the same id', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    expect(colorForId(id)).toBe(colorForId(id));
  });

  it('gives different ids different colors (not everyone the same gray)', () => {
    const colors = new Set(
      ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003'].map(
        colorForId,
      ),
    );
    expect(colors.size).toBeGreaterThan(1);
  });

  it('always returns a valid CSS hex color', () => {
    expect(colorForId('some-user-id')).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('columnPalette (Figma sticky-note colors, keyed by column.color)', () => {
  it('maps each named column color to its exact Figma accent/card hex', () => {
    expect(columnPalette('green')).toEqual({ accent: '#16A34A', card: '#C9F2D3' });
    expect(columnPalette('pink')).toEqual({ accent: '#E11D48', card: '#FFD3DE' });
    expect(columnPalette('yellow')).toEqual({ accent: '#CA8A04', card: '#FFF0A3' });
    expect(columnPalette('blue')).toEqual({ accent: '#2563EB', card: '#CFE3FF' });
  });

  it('falls back to treating an unrecognized name as a literal CSS color', () => {
    expect(columnPalette('#123456')).toEqual({ accent: '#123456', card: '#123456' });
  });
});
