import { describe, expect, it } from 'vitest';
import { initialsFor } from './BoardPage';

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
