import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findAgentsDir, loadAgent, parseAgentFile } from './loadAgent.js';

describe('parseAgentFile', () => {
  it('splits the frontmatter fields from the trimmed body', () => {
    const raw = ['---', 'name: example', 'description: An example agent.', 'model: claude-haiku-4-5-20251001', '---', '', 'Body text here.', ''].join(
      '\n',
    );
    const parsed = parseAgentFile(raw, 'example');
    expect(parsed).toMatchObject({
      name: 'example',
      description: 'An example agent.',
      model: 'claude-haiku-4-5-20251001',
      body: 'Body text here.',
    });
    expect(parsed.promptVersion).toMatch(/^[0-9a-f]{12}$/);
  });

  it('falls back to the given name and empty strings for missing fields', () => {
    const raw = '---\n---\nJust a body.';
    expect(parseAgentFile(raw, 'fallback')).toMatchObject({ name: 'fallback', description: '', model: '', body: 'Just a body.' });
  });

  it('promptVersion changes when the body changes, and stays the same when it does not', () => {
    const v1a = parseAgentFile('---\n---\nBody A.', 'x');
    const v1b = parseAgentFile('---\n---\nBody A.', 'x');
    const v2 = parseAgentFile('---\n---\nBody B.', 'x');
    expect(v1a.promptVersion).toBe(v1b.promptVersion);
    expect(v1a.promptVersion).not.toBe(v2.promptVersion);
  });

  it('throws a clear error when the frontmatter block is missing entirely', () => {
    expect(() => parseAgentFile('no frontmatter here', 'broken')).toThrow(/broken\.md is missing its --- frontmatter block/);
  });

  it('ignores a frontmatter line with no colon rather than crashing', () => {
    const raw = '---\nname: example\nthis line has no colon\n---\nBody.';
    expect(parseAgentFile(raw, 'example')).toMatchObject({ name: 'example', body: 'Body.' });
  });
});

describe('findAgentsDir', () => {
  let tmpRoot: string;

  afterEach(() => {
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('finds .claude/agents starting exactly at the directory that contains it', () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'retronoodle-agents-'));
    mkdirSync(join(tmpRoot, '.claude', 'agents'), { recursive: true });
    expect(findAgentsDir(tmpRoot)).toBe(join(tmpRoot, '.claude', 'agents'));
  });

  it('walks up several levels to find it — the production (bundled) and local (unbundled) cases sit at different depths from the same repo root', () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'retronoodle-agents-'));
    mkdirSync(join(tmpRoot, '.claude', 'agents'), { recursive: true });
    const deep = join(tmpRoot, 'apps', 'api', 'dist');
    mkdirSync(deep, { recursive: true });
    expect(findAgentsDir(deep)).toBe(join(tmpRoot, '.claude', 'agents'));
  });

  it('throws rather than silently resolving to the wrong place when none exists above', () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'retronoodle-agents-'));
    const deep = join(tmpRoot, 'no', 'claude', 'anywhere', 'above', 'this');
    mkdirSync(deep, { recursive: true });
    expect(() => findAgentsDir(deep)).toThrow(/Could not find a \.claude\/agents directory/);
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
