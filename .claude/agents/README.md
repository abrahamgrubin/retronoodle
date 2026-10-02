# .claude/agents/

This app's own convention for every AI agent it calls at runtime — replaces the old
`prompts/<feature>/v1.md` scheme. It deliberately borrows Claude Code's own subagent file shape
(frontmatter + a markdown body) because that's what this is: one file, one agent, one job.

Nothing in the Claude Agent SDK or the Claude API reads this folder automatically — there's no
runtime magic. `apps/worker/src/agents/loadAgent.ts` is the one piece of code that actually parses
these files; every job that wants an agent's prompt calls `loadAgent('<name>')` and uses
`.body` as the request to Anthropic.

## File shape

```markdown
---
name: grouper
description: One line — what this agent does and when it runs.
model: claude-haiku-4-5-20251001
---

The actual system/user prompt, exactly as you'd want it sent to the model. `{{PLACEHOLDER}}`
tokens get substituted by the job that loads this file (see groupCards.ts's `{{CARDS}}` for the
pattern).
```

`model` is informational — it documents which model this agent is meant to run on, but the real
model string a job calls with always comes from `packages/shared/src/ai.ts` (CLAUDE.md: "Model
names and limits live in config, never hard-coded at call sites"). Keeping that in one shared
file, not duplicated across every agent's frontmatter, is what keeps a model bump from needing to
touch every `.md` file.

## Adding a new agent

1. Write `.claude/agents/<name>.md` (frontmatter + body, `{{PLACEHOLDERS}}` for whatever the job
   substitutes in).
2. In the job that uses it (`apps/worker/src/jobs/<job>.ts`), call `loadAgent('<name>').body`,
   `.replace('{{PLACEHOLDER}}', ...)`, and send it to Anthropic the same way `groupCards.ts` does.
3. Register the job's pg-boss queue in `apps/worker/src/index.ts` (both `startWorker`'s
   `.work()` handler and `createJobSender`'s `createQueue` call need the new queue name).
4. Enqueue it from wherever it belongs (a mutation's `apply()`, or a transition effect in
   `onTransition.ts` — see `write->group`'s `ai.groupCards` for the existing pattern).

Three agents are fully wired so far, each a slightly different shape worth copying from:

- **grouper** (`groupCards.ts`) — one call for the whole board, facilitator-only output
  (`broadcastUser`), its own `group_suggestions` table.
- **group-summarizer** (`summarizeGroup.ts`) — one call per topic, enqueued in a loop from
  `onTransition.ts`'s `group->vote`, output visible to everyone (`broadcastRetro`), stored
  directly on `topics` and editable afterward via its own mutation (`topicEditGroupSummary.ts`).
- **question-suggester** (`suggestQuestions.ts`) — one call per topic, enqueued the moment a
  topic *becomes current* rather than at a phase transition (`discussHelpers.ts`'s `startTopic`,
  plus `vote->discuss`'s own top-ranked-topic case), consuming another agent's output
  (group-summarizer's summary) as its own input.

A one-shot worker broadcast like `broadcastRetro` here never goes through the normal mutation
pipeline (no `retro_events` row, no real `seq`) — the client has to special-case its event name
and apply it as a local patch instead of folding it through the seq-ordered reducer path (see
BoardPage.tsx's retro-channel listener, `'topic.groupSummaryReady'`/`'topic.questionsReady'`).
