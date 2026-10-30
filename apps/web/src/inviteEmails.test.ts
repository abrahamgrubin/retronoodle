import { describe, expect, it } from 'vitest';
import { parseEmailInput } from './inviteEmails';

describe('parseEmailInput', () => {
  it('splits on commas, semicolons and whitespace, lowercasing', () => {
    expect(parseEmailInput('A@x.com, b@y.com; C@z.com', []).added).toEqual(['a@x.com', 'b@y.com', 'c@z.com']);
  });

  it('skips duplicates, including ones already added', () => {
    expect(parseEmailInput('a@x.com A@X.com b@y.com', ['b@y.com']).added).toEqual(['a@x.com']);
  });

  it('reports pieces that are not email addresses', () => {
    expect(parseEmailInput('a@x.com nope @bad', [])).toEqual({ added: ['a@x.com'], rejected: ['nope', '@bad'] });
  });
});
