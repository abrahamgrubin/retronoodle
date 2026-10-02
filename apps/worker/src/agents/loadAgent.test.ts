import { describe, expect, it } from 'vitest';
import { loadAgent, parseAgentFile } from './loadAgent.js';

describe('parseAgentFile', () => {
  it('splits the frontmatter fields from the trimmed body', () => {
    const raw = ['---', 'name: example', 'description: An example agent.', 'model: claude-haiku-4-5-20251001', '---', '', 'Body text here.', ''].join(
      '\n',
    );
    expect(parseAgentFile(raw, 'example')).toEqual({
      name: 'example',
      description: 'An example agent.',
      model: 'claude-haiku-4-5-20251001',
      body: 'Body text here.',
    });
  });

  it('falls back to the given name and empty strings for missing fields', () => {
    const raw = '---\n---\nJust a body.';
    expect(parseAgentFile(raw, 'fallback')).toEqual({ name: 'fallback', description: '', model: '', body: 'Just a body.' });
  });

  it('throws a clear error when the frontmatter block is missing entirely', () => {
    expect(() => parseAgentFile('no frontmatter here', 'broken')).toThrow(/broken\.md is missing its --- frontmatter block/);
  });

  it('ignores a frontmatter line with no colon rather than crashing', () => {
    const raw = '---\nname: example\nthis line has no colon\n---\nBody.';
    expect(parseAgentFile(raw, 'example')).toMatchObject({ name: 'example', body: 'Body.' });
  });
});

describe('loadAgent', () => {
  it('reads and parses the real .claude/agents/grouper.md off disk', () => {
    const grouper = loadAgent('grouper');
    expect(grouper.name).toBe('grouper');
    expect(grouper.description).toContain('Groups similar retro cards');
    expect(grouper.body).toContain('{{CARDS}}');
  });

  it('caches by name — a second call returns the exact same object, not a fresh read', () => {
    expect(loadAgent('grouper')).toBe(loadAgent('grouper'));
  });

  it('throws for an agent that does not exist', () => {
    expect(() => loadAgent('does-not-exist')).toThrow();
  });
});
