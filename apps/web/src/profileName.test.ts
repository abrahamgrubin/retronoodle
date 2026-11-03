import { describe, expect, it } from 'vitest';
import { firstNameFor } from './profileName';

describe('firstNameFor (RN-062: "Welcome <first name>")', () => {
  it('takes the first word of the display name', () => {
    expect(firstNameFor('Ada Lovelace', 'ada@example.com')).toBe('Ada');
    expect(firstNameFor('  Grace   Brewster Hopper ', 'grace@example.com')).toBe('Grace');
  });

  it('keeps a single-word display name whole', () => {
    expect(firstNameFor('Cher', 'cher@example.com')).toBe('Cher');
  });

  it('falls back to the local part of the email when there is no display name', () => {
    expect(firstNameFor('', 'abraham.rubin@example.com')).toBe('abraham.rubin');
    expect(firstNameFor('   ', 'abraham@example.com')).toBe('abraham');
    expect(firstNameFor(null, 'abraham@example.com')).toBe('abraham');
    expect(firstNameFor(undefined, 'abraham@example.com')).toBe('abraham');
  });

  it("falls back to the email's local part when the display name is itself an email", () => {
    // The API's own fallback display name for an account with no name is the email.
    expect(firstNameFor('e2e-home@example.com', 'e2e-home@example.com')).toBe('e2e-home');
  });

  it('returns an empty string when neither is usable', () => {
    expect(firstNameFor('', '')).toBe('');
    expect(firstNameFor(null, null)).toBe('');
  });
});
