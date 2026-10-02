# RetroNoodle — guide for Claude

RetroNoodle is a real-time retrospective app (retronoodle.com). The backlog in
`docs/stories.md` is the source of truth for what to build and in what order.

## How to work in this repo

- Build one story at a time, in ID order (RN-001, RN-002, ...). One branch and one PR per story,
  named `rn-001-monorepo-scaffold` and titled `RN-001 · Monorepo scaffold and CI`.
- A story is done when every acceptance criterion in `docs/stories.md` is met and covered by a
  test where it can be. Tick the boxes in the PR description, not in `docs/stories.md`.
- Don't build ahead. Leave hooks (columns, interfaces) where a story says so, but no features
  from later stories.
- If a story conflicts with the code or another story, stop and ask instead of guessing.

## Stack

- pnpm workspaces + Turborepo. Node 22. TypeScript strict everywhere.
- `apps/web`: React + Vite, TanStack Query (server data), Zustand (live board), dnd-kit (drag).
- `apps/api`: Fastify. Entry reads `ROLE` = `api` | `worker` | `all`.
- `apps/worker`: pg-boss jobs (AI, exports, email, retention).
- `packages/shared`: state machine, Zod schemas, DB types, event types. Imported as TS source.
- `supabase/`: migrations, seed, RLS policies. `.claude/agents/`: one `<name>.md` file per AI
  agent the app calls at runtime (frontmatter + prompt body) — loaded by
  `apps/worker/src/agents/loadAgent.ts`.
- Tests: Vitest (unit, integration), Playwright (end to end).

## Rules every story follows

- Every write goes through `POST /retros/:id/mutations` and the shared state machine.
  Browsers never write to Postgres; they use Supabase only for sign-in and listening.
- Every access check goes through `can(user, action, resource)`. No inline permission checks.
- Every outbound broadcast and board read passes through the single hiding function
  (`redact`). Hidden card text and votes never leave the server.
- All Realtime sends go through `RealtimeBus`. No other module sends on Supabase Realtime.
- IDs are browser-generated UUIDv7.
- Card text, summaries, notes and AI output render as plain text only, never HTML or Markdown.
- No retro content (card text, notes, summaries, transcripts) or credentials in logs.
- Model names and limits live in config, never hard-coded at call sites.

## Phase rules (Design 6.1, updated Sep 29)

| Action | Review | Write | Group | Vote | Discuss | Wrap up |
| --- | --- | --- | --- | --- | --- | --- |
| Add, edit, delete own card |  | ✓ | ✓ |  |  |  |
| Drag cards |  | own cards | all cards |  |  |  |
| React to cards |  | after reveal | ✓ |  | ✓ | ✓ |
| Group cards, accept AI groups |  |  | ✓ |  |  |  |
| Vote |  |  |  | ✓ |  |  |
| Mark past action items | ✓ |  |  |  |  |  |
| Create or edit action items | ✓ |  |  |  | ✓ | ✓ |
| Edit summaries, typed notes |  |  |  |  | ✓ | ✓ |

## Commands

- `pnpm install` then `pnpm dev` (web on :5173, API on :3000).
- `pnpm lint`, `pnpm typecheck`, `pnpm test` (all run in CI on every PR).
- Copy `.env.example` to `.env` and fill it in; never commit `.env`.
