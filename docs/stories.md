# RetroNoodle — Prioritized User Stories

> Source of truth: [Google Doc](https://docs.google.com/document/d/1HY_yefDcwZyliA00n5Wj7S3OP_zKJMvmo98uqneNnlY/edit) · PRD: [Retro App PRD (v1)](https://docs.google.com/document/d/1lg7X45XvCPFBhE9CR5QoTtxNNlKQvYeNyXkWeOcSjfo/edit) · Design: [Engineering Design Doc](https://docs.google.com/document/d/1cZAl3sP5BjmA9VbyqMGEM2iChnXjUVKot2Zf1jpY6PA/edit)

Sep 29, 2026 · Abraham Rubin · Sources: Retro App PRD (v1), RetroNoodle Engineering Design Doc, design mocks

## How to use this backlog

Build the stories strictly in ID order: RN-001 to RN-029 are the v0.1 critical path (about 42 hours, Tue Sep 29 to Sun Oct 4), and everything after follows the design doc's post-Sunday sequence. Each story is sized so one Claude Code session can implement and test it against its acceptance criteria.

**Priority rules applied**

1.  v0.1 scope and day order from the design doc (Section 13) beats PRD priority labels. The PRD marks audio, generated formats, reminders and Trello as P0, but they ship after v0.1.
2.  Inside a day, stories that others depend on come first.
3.  Sunday cut order if behind: drop RN-017 (AI grouping) first, then RN-016 (reactions).
4.  After v0.1: Milestone 3 audio, then remaining P0, then Milestone 4 demo, then P1 behind flags. P2 (T7) stays in the icebox.

**Story format.** Each story has: PRD and design refs, the user story, technical notes (where the code goes and which contracts to honor), acceptance criteria written as testable checks, dependencies, and an hour estimate.

**Global conventions for every story**

- Monorepo paths: `apps/web`, `apps/api`, `apps/worker`, `packages/shared`, `supabase/`, `prompts/`.
- Every write goes through `POST /retros/:id/mutations` and the shared state machine. Browsers never write to Postgres.
- Every access check goes through `can(user, action, resource)`.
- Every outbound broadcast passes through the single hiding function.
- IDs are browser-generated UUIDv7. Card, summary and AI text render as plain text only.
- No retro content (card text, notes, summaries, transcripts) in logs.

### Ordered summary

| Order    | ID               | Story                                          | Refs                        | When        | Est.    |
|----------|------------------|------------------------------------------------|-----------------------------|-------------|---------|
| 1        | RN-001           | Monorepo scaffold and CI                       | 11.4, 11.5                  | Tue         | 1h      |
| 2        | RN-002           | v0.1 schema, deny-all RLS, generated types     | 4, 4.9, 4.10                | Tue         | 1.5h    |
| 3        | RN-003           | Google sign-in and API token verification      | B2, U1, 3.1                 | Tue         | 1h      |
| 4        | RN-004           | Private Realtime channel spike and RealtimeBus | 3.6, 4.9                    | Tue         | 0.5h    |
| 5        | RN-005           | Teams, membership and `can()`                  | U2, U3, 3.4, 3.5            | Wed         | 1.5h    |
| 6        | RN-006           | Create retro and join link                     | B1, B2, 3.3                 | Wed         | 1.5h    |
| 7        | RN-007           | Built-in templates and column copy             | T1, T2, 4.2                 | Wed         | 1h      |
| 8        | RN-008           | Mutation pipeline and ordered events           | B4, 5.1, 5.2                | Wed         | 2.5h    |
| 9        | RN-009           | Board UI and card CRUD                         | B3                          | Wed         | 1.5h    |
| 10       | RN-010           | Shared phase state machine and controls        | P1, 6.1 to 6.3              | Thu         | 2h      |
| 11       | RN-011           | Hidden cards until reveal                      | B5, 5.5                     | Thu         | 1.5h    |
| 12       | RN-012           | Phase timer: countdown, extend, skip           | P2, P3, 6.4                 | Thu         | 1h      |
| 13       | RN-013           | Reload board on reconnect                      | 5.4 (v0.1)                  | Thu         | 0.5h    |
| 14       | RN-014           | Drag within and between columns                | B3, 4.6, 6.1                | Thu         | 3h      |
| 15       | RN-015           | Drag-to-group and topics                       | G1, 4.3                     | Fri         | 2.5h    |
| 16       | RN-016           | Emoji reactions                                | B7                          | Fri         | 1.5h    |
| 17       | RN-017           | AI grouping suggestions                        | G2, 8.3                     | Fri         | 2h      |
| 18       | RN-018           | Dot voting with hidden votes                   | G3, G4, 4.5                 | Fri         | 2h      |
| 19       | RN-019           | Discuss queue                                  | G5, 6.5                     | Sat         | 1h      |
| 20       | RN-020           | Typed topic notes                              | A7                          | Sat         | 0.5h    |
| 21       | RN-021           | AI topic summaries from cards and notes        | A4, A5, A7, 8.4             | Sat         | 2h      |
| 22       | RN-022           | Create and edit action items                   | F1, T2                      | Sat         | 1h      |
| 23       | RN-023           | Close retro with owner check                   | F2, 9.2                     | Sat         | 0.5h    |
| 24       | RN-024           | Team action-item list                          | F3, 9.1                     | Sat         | 1h      |
| 25       | RN-025           | Review phase and carry-over                    | F4, T2                      | Sat         | 1h      |
| 26       | RN-026           | Read-only closed board and summaries panel     | F6 (v0.1)                   | Sat         | 1h      |
| 27       | RN-027           | Deploy the portfolio profile                   | 11.1, 11.2, 11.7            | Sun         | 3h      |
| 28       | RN-028           | v0.1 test suite                                | 12.6                        | Sun         | 2h      |
| 29       | RN-029           | Demo retro and README                          | 11.8, 13.4                  | Sun         | 1h      |
| 30 to 37 | RN-030 to RN-037 | Audio layer                                    | A1 to A3, A8, A9            | Milestone 3 | ~9 days |
| 38 to 49 | RN-038 to RN-049 | Remaining v1 P0 and hardening                  | T3 to T5, F5, F6            | After audio | ~8 days |
| 50 to 54 | RN-050 to RN-054 | Demo and polish                                | Milestone 4                 | After P0    | ~4 days |
| 55 to 61 | RN-055 to RN-061 | P1 features                                    | A6, A11, B6, F7, F8, T6, P4 | Milestone 5 | ~6 days |

## Tier 1 · v0.1 Day 1 — Tue Sep 29 (4h)

Day 1 removes the two highest schedule risks first: Google sign-in setup and server broadcast on private Realtime channels.

### RN-001 · Monorepo scaffold and CI

**Refs:** Design 11.4, 11.5 · **Est:** 1h · **Depends on:** none

**Story:** As the developer, I want a working monorepo with shared types and CI, so every later story lands in the right place and is checked on each PR.

**Technical notes**

- pnpm workspaces + Turborepo. Packages: `apps/web` (React + TypeScript + Vite), `apps/api` (Fastify), `apps/worker` (pg-boss), `packages/shared`, `supabase/`, `prompts/`.
- `apps/api` entry reads `ROLE` = `api` \| `worker` \| `all`; `all` starts API and worker in one process (11.1).
- Web deps: TanStack Query, Zustand, dnd-kit. Shared deps: Zod.
- GitHub Actions on PR: lint, typecheck, Vitest.

**Acceptance criteria**

- [ ] `pnpm dev` starts web on :5173 and API on :3000 with one command.
- [ ] `packages/shared` exports a sample Zod schema imported by both web and API.
- [ ] `ROLE=all` starts API routes and the pg-boss worker in one process; `ROLE=api` starts no worker.
- [ ] `GET /health` returns 200 with `{ ok: true, time }`.
- [ ] A PR with a type error fails CI.

### RN-002 · v0.1 schema, deny-all RLS and generated types

**Refs:** Design 4, 4.1, 4.2, 4.8, 4.9, 4.10 · **Est:** 1.5h · **Depends on:** RN-001

**Story:** As the developer, I want the full relational schema in migrations, so v0.1 and later features share one model and browsers can't read data directly.

**Technical notes**

- Supabase CLI migrations for: profiles, teams, team_members, templates, retros, retro_columns, cards, card_reactions, topics, votes, retro_participants, action_items, action_item_reviews, topic_summaries, topic_notes, group_suggestions, retro_events. Columns exactly as in Design 4.
- Include P1 columns now (e.g. `retros.phase_remaining_ms`, `action_items.trello_card_id`) so the protocol doesn't change later.
- `retro_events` unique on `(retro_id, seq)`; a `mutation_id` column unique per retro for idempotency (5.2).
- `cards.position` and `topics.discussion_order` are text sort keys (4.6).
- Enable RLS on every table with no policies. Add only the Realtime listen policy from 4.9.
- Generate TypeScript types into `packages/shared/db`.
- Seed: one Demo Team and built-in templates (filled in RN-007).

**Acceptance criteria**

- [ ] `supabase db reset` applies all migrations cleanly on a fresh local stack.
- [ ] Integration test: a client using the anon/public key reads zero rows from every table.
- [ ] Generated types compile in web and API.
- [ ] Inserting two `retro_events` with the same `(retro_id, seq)` fails.

### RN-003 · Google sign-in and API token verification

**Refs:** PRD B2, U1 · Design 1.2, 3.1, 3.2, 3.7 · **Est:** 1h · **Depends on:** RN-002

**Story:** As a facilitator or participant, I want to sign in with one Google click, so I can join my team's retros without creating a password.

**Technical notes**

- Supabase Auth, Google provider only. Scopes: name, email, picture. No Drive scope yet.
- JWT expiry set to 15 minutes; client refreshes automatically.
- Fastify auth hook verifies the JWT with Supabase's public signing keys (JWKS cached), no network call per request.
- On first authenticated request, upsert `profiles` (display_name, email, avatar_url from Google; timezone from the browser).
- Preserve a `redirectTo` so sign-in from a join link returns to that link.
- Fallback if Google setup is stuck Wednesday morning: Supabase magic links behind a flag (Risk table).

**Acceptance criteria**

- [ ] Clicking "Continue with Google" signs in and lands on the originally requested URL.
- [ ] `profiles` row exists with Google name and avatar after first sign-in.
- [ ] API returns 401 for a missing, expired or tampered token.
- [ ] Unit test: token verification uses cached keys (no fetch on the second request).

### RN-004 · Private Realtime channel spike and RealtimeBus

**Refs:** Design 2.1, 3.6, 4.9 · Risk "server can't broadcast on private channels" · **Est:** 0.5h · **Depends on:** RN-002, RN-003

**Story:** As the developer, I want to prove the server can broadcast to a private `retro:{id}` channel that only team members can hear, so the real-time design holds before I build on it.

**Technical notes**

- `apps/api/realtime/RealtimeBus.ts`: the only module that calls Supabase Realtime. Methods: `broadcastRetro(retroId, event)`, `broadcastUser(userId, event)`.
- Channels: `retro:{id}` (server-send only), `user:{id}` (private per user).
- Browser subscribes with `private: true`.
- If the policy in 4.9 can't work, fall back to public channels with random names and record the gap in the README.

**Acceptance criteria**

- [ ] A 20-line test: server broadcasts on `retro:{id}`; a signed-in team member receives it.
- [ ] A signed-in non-member fails to subscribe.
- [ ] No other file imports the Supabase Realtime client for sending (lint rule or grep test).

## Tier 1 · v0.1 Day 2 — Wed Sep 30 (8h)

Day 2 ends with two browsers adding cards to the same board and seeing each other's changes in under 500 ms.

### RN-005 · Teams, membership and the `can()` module

**Refs:** PRD U2, U3 · Design 3.4, 3.5, 3.7 · **Est:** 1.5h · **Depends on:** RN-003

**Story:** As a facilitator, I want a team that holds our retros and action items, so only my teammates can see our history, whether or not they attended.

**Technical notes**

- Routes: `POST /teams`, `GET /teams/:id`, `GET /me/teams`. Creator becomes `admin`.
- `apps/api/auth/can.ts`: `can(user, action, resource)` with roles Admin, Member (team) and Facilitator (retro). Every route calls it; no inline checks.
- Membership is checked on every request (3.7). A `removed` event on `user:{id}` closes the board client-side.
- A user with one team lands on it after sign-in; zero teams shows "Create a team".

**Acceptance criteria**

- [ ] Creating a team makes the creator an admin.
- [ ] A member can list and open every retro of their team, including ones they didn't attend (U3).
- [ ] A non-member gets 403 on any team or retro route.
- [ ] Unit tests cover each role × action in the 3.4 table.
- [ ] Removing a member makes their next request return 403 and closes their open board.

### RN-006 · Create a retro and share one join link

**Refs:** PRD B1, B2 · Design 3.3 · **Est:** 1.5h · **Depends on:** RN-005

**Story:** As a facilitator, I want to create a retro and copy one link, so everyone joins in seconds with Google and is added to the team automatically.

**Technical notes**

- `POST /teams/:id/retros` {name, templateId} → retro in `setup` phase; creator is `facilitator_id`.
- Join code: 128-bit random, base64url; store only `join_code_hash`. `POST /retros/:id/join-link/regenerate` replaces it.
- `GET /join/:code` → if not signed in, Google sign-in then return; add user to `team_members` (member) and `retro_participants`; redirect to the board.
- Code is invalid once the retro is `closed`. v0.1: anyone with the link joins (no domain allowlist).
- "Share link" button in the header copies the URL (mock header, top right).

**Acceptance criteria**

- [ ] A new user opening the link signs in with Google and lands on the board as a team member.
- [ ] An existing member opening the link is not duplicated.
- [ ] After regenerate, the old link returns "This link has expired".
- [ ] After close, the link returns "This retro has ended" and offers the team's retro list to members.
- [ ] The plaintext code is never stored in the database.

### RN-007 · Built-in templates and column copy

**Refs:** PRD T1, T2 · Design 4.2 · **Est:** 1h · **Depends on:** RN-006

**Story:** As a facilitator, I want to pick Start/Stop/Continue, Mad/Sad/Glad, 4Ls or Sailboat, so I can start a retro in under 2 minutes.

**Technical notes**

- Seed 4 templates with `team_id = null`, `source = 'builtin'`, `columns` jsonb of {title, prompt, color}.
- Code always appends an Action items column (`kind = 'action_items'`); templates never store it.
- On `setup → review` (or `write`), copy template columns into `retro_columns`. Later template edits never change past retros.
- Column colors follow the mocks: green, pink, yellow, then blue for Action items; column header shows a colored dot, title and card count.

**Acceptance criteria**

- [ ] Template picker shows 4 built-in templates with column previews.
- [ ] A started retro has the template's columns plus one Action items column in last position.
- [ ] Editing a template row after a retro starts leaves that retro's columns unchanged.
- [ ] `retros` stores the template source so the "generated formats used" metric can be computed later.

### RN-008 · Mutation pipeline with ordered events

**Refs:** PRD B4 · Design 2.1, 4.1, 5.1, 5.2, 5.6, 5.8 · **Est:** 2.5h · **Depends on:** RN-004, RN-005

**Story:** As a participant, I want every change to reach everyone in under 500 ms in the same order, so we all see the same board.

**Technical notes**

- `POST /retros/:id/mutations` body `{mutationId, type, payload}`; each `type` has a Zod schema in `packages/shared/mutations`.
- Handler, in one transaction: `SELECT … FOR UPDATE` on the retro row → check `can()` and the phase rules (stubbed until RN-010) → apply → `seq = last + 1` → insert `retro_events` → commit → return `{seq, result}` → `RealtimeBus.broadcastRetro` (through the hiding function, stubbed until RN-011).
- Duplicate `mutationId` returns the original result without re-applying.
- Client: optimistic apply in the Zustand store; queue events; apply strictly in `seq` order; roll back and toast on rejection.
- Limits: 20 mutations/s per user (429), card body ≤ 500 characters.
- Measure round trip in the browser and log it to the console for now (telemetry in RN-050).

**Acceptance criteria**

- [ ] Integration test: 100 concurrent mutations produce strictly increasing `seq` with no gaps.
- [ ] Replaying the same `mutationId` twice creates one change and returns the same `seq`.
- [ ] A rejected mutation rolls back the optimistic UI and shows a short message.
- [ ] Two local browsers see each other's change in under 500 ms.
- [ ] Events arriving out of order are buffered and applied in `seq` order.

### RN-009 · Board UI and card CRUD

**Refs:** PRD B3 · Design 2.4 · Mocks (all board screens) · **Est:** 1.5h · **Depends on:** RN-007, RN-008

**Story:** As a participant, I want to add, edit and delete my own cards in any column, so I can share my thoughts quickly.

**Technical notes**

- Layout per mock: header with retro name, template name, phase pill bar and right-side actions; columns in a row; "+ Add a card" at the bottom of each column; footer hint line per phase.
- Card: body text, author avatar initials and name, reaction button (wired in RN-016). Card color = column color.
- Mutations: `card.create`, `card.edit`, `card.delete`. Only the author may edit or delete.
- Initial load: `GET /retros/:id/board` returns the snapshot plus its `seq`; events after it are applied on top.
- Enter saves; Esc cancels; empty body is rejected client and server side.

**Acceptance criteria**

- [ ] A user can add, edit and delete their own card; others see it within 500 ms.
- [ ] Editing or deleting someone else's card is not offered in the UI and returns 403 from the API.
- [ ] Column counters update live.
- [ ] A 501-character card is rejected with a visible message.
- [ ] Card creation works with keyboard only (Tab to "Add a card", type, Enter).

## Tier 1 · v0.1 Day 3 — Thu Oct 1 (8h)

Day 3 makes the board a real retro: phases gate every action, hidden text never leaves the server, and cards drag. Drag is timeboxed to 3 hours.

### RN-010 · Shared phase state machine and facilitator controls

**Refs:** PRD P1 · Design 6.1, 6.2, 6.3 · **Est:** 2h · **Depends on:** RN-008

**Story:** As a facilitator, I want to move the retro through Review, Write, Group, Vote, Discuss and Wrap up, so the team follows one flow and can't take actions out of phase.

**Technical notes**

- `packages/shared/stateMachine.ts`: phases `setup, review, write, group, vote, discuss, wrap_up, closed`; allowed transitions; `allowedActions(phase)` matching the Design 6.1 matrix.
- Server rejects any mutation not allowed in the current phase (409 `phase_not_allowed`). Web uses the same function to show or hide controls. Reactions are allowed in Write once cards are revealed and are not allowed during Vote; action items can also be created in Review (decisions Sep 29, now in Design 6.1).
- Transitions are mutations (`phase.next`, `phase.back`, `phase.skip`) that only the facilitator may send.
- Back: one step only (Group→Write, Vote→Group) and only before votes are revealed; Vote→Group refunds all votes.
- Review is skipped automatically when the team has no open or in-progress items.
- Transition side effects live in one `onTransition` table (6.3); stories RN-011, RN-015, RN-017, RN-018, RN-019, RN-021, RN-023, RN-025 add rows.
- Header pill bar per mock: current phase is the dark pill with its countdown; past phases stay clickable-looking but inert.

**Acceptance criteria**

- [ ] Unit tests: every allowed transition succeeds and every other one is rejected.
- [ ] Unit tests: every cell of the 6.1 action matrix, both allowed and denied.
- [ ] A participant who isn't the facilitator gets 403 on `phase.next`.
- [ ] Going back from Vote refunds votes (`votes_used = 0` for all participants).
- [ ] A team with no carried items starts in Write, not Review.
- [ ] Header subtitle changes per phase (e.g. "Reviewing previous action items", "Voting in progress", "Wrapping up").

### RN-011 · Hidden cards until reveal

**Refs:** PRD B5 · Design 2.1, 5.5 · **Est:** 1.5h · **Depends on:** RN-009, RN-010

**Story:** As a participant, I want my cards hidden from others while we write, so nobody anchors on someone else's ideas.

**Technical notes**

- `apps/api/realtime/redact.ts`: the one outbound function for broadcasts and `GET /board`. During Write, non-authors receive `{id, columnId, authorId, position, hidden: true}` and never `body`.
- The author receives full text on all their tabs via `user:{id}`.
- UI: blurred placeholder showing column color and author avatar (per the B5 table in 5.5).
- Reveal happens when the facilitator clicks Reveal or on `write → group`; the server then broadcasts full cards.
- Cards added during Group are revealed immediately.
- Footer hint in Write: "Add cards to each column · your notes are private until the next phase".

**Acceptance criteria**

- [ ] Unit test: `redact()` never returns `body` for a non-author during Write.
- [ ] Playwright: browser B's network traffic never contains browser A's card text before reveal.
- [ ] The author sees full text in two open tabs.
- [ ] After reveal, all browsers show full text within 500 ms.
- [ ] A card created in Group is visible to everyone at once.

### RN-012 · Phase timer: countdown, extend, skip

**Refs:** PRD P2, P3 · Design 2.3, 6.4 · **Est:** 1h · **Depends on:** RN-010

**Story:** As a facilitator, I want a shared countdown per phase that I can extend or skip, so the retro keeps time without me watching a clock.

**Technical notes**

- Store `retros.phase_deadline`; broadcast it on each transition or extend. No per-second ticks.
- Every API response includes `serverTime`; the client keeps a clock offset and counts down locally (within ~100 ms across browsers).
- Defaults (minutes): Review 5, Write 5, Group 5, Vote 3, Discuss 30 total, Wrap up 5. Mock values (03:00, 02:00, 01:30) are illustrative only; the defaults above are what ships (decision Sep 29).
- Controls: extend +1, +2, +5 minutes; skip (= next phase). At zero the pill flashes and chimes once; the phase never changes by itself.
- Pause is out of v0.1 (RN-048).

**Acceptance criteria**

- [ ] Two browsers with clocks 5 s apart show the same remaining time within 1 s.
- [ ] Extend +2 updates every browser's countdown.
- [ ] At zero the timer alerts, and the phase stays until the facilitator clicks Next.
- [ ] A late joiner sees the correct remaining time.

### RN-013 · Reload the board on reconnect

**Refs:** PRD NFR real-time sync · Design 5.4 (v0.1 simplification) · **Est:** 0.5h · **Depends on:** RN-008

**Story:** As a participant, I want the board to recover after my connection drops, so I never lose cards or see a stale board.

**Technical notes**

- On Realtime reconnect or a `seq` gap older than 1 s, refetch `GET /retros/:id/board` and replace the store.
- Unconfirmed mutations are kept in memory and resent with the same `mutationId` after reload (idempotent server side).
- Show a small "Reconnecting…" badge; typing in a card editor never blocks.
- Event replay and IndexedDB persistence come later (RN-047).

**Acceptance criteria**

- [ ] Going offline for 10 s and back shows the latest board with no duplicate cards.
- [ ] A card typed while offline is saved once after reconnect.
- [ ] The badge appears on disconnect and disappears after resync.

### RN-014 · Drag cards within and between columns

**Refs:** PRD B3 · Design 4.6, 5.6, 6.1 drag rules · Mocks ("Moving to Stop…", drop outline) · **Est:** 3h (timebox) · **Depends on:** RN-009, RN-010, RN-011

**Story:** As a participant, I want to drag cards to reorder them or move them to another column, so the board reflects what I meant.

**Technical notes**

- dnd-kit with pointer and keyboard sensors (Space to lift, arrows to move, Space to drop).
- Position = fractional text key between neighbors (e.g. `fractional-indexing`); one `card.move {cardId, columnId, position}` mutation per drop.
- Write: authors drag only their own cards; others see the placeholder move. Group: everyone drags any card. Vote onward: cards locked.
- Drag visuals per mock: lifted, slightly rotated card; dashed placeholder "Moving to Stop…" at the origin; target column highlighted with a blue border; dashed drop slot.
- Others see the move on drop only (live drags come with P1 cursors). Last write wins.
- Move onto a card's center is reserved for grouping (RN-015).

**Acceptance criteria**

- [ ] Reordering within a column and moving across columns persists after reload.
- [ ] Each drop writes exactly one row and one broadcast.
- [ ] In Write, dragging another person's card is not possible.
- [ ] In Vote, Discuss and Wrap up, drag handles are disabled and the API rejects `card.move`.
- [ ] Keyboard-only move works and is announced to screen readers.
- [ ] Cards can't be dragged into the Action items column.

## Tier 1 · v0.1 Day 4 — Fri Oct 2 (8h)

Day 4 turns cards into topics and ranks them by votes. RN-016 and RN-017 are the Sunday cut candidates, so build RN-015 and RN-018 first if the day starts late.

### RN-015 · Drag-to-group and topics

**Refs:** PRD G1 · Design 4.3, 6.1 drag rules, 6.3 · **Est:** 2.5h · **Depends on:** RN-014

**Story:** As a participant in Group, I want to drop a card onto another to group them and name the group, so similar ideas are discussed together.

**Technical notes**

- Dropping onto a card's center (collision zone ≈ middle 50%) groups; dropping between cards moves. The target card highlights while hovering.
- Mutations: `topic.createFromCards {topicId, cardIds, name?}`, `card.addToTopic`, `card.removeFromTopic`, `topic.rename`. Groups stay within one column.
- A group renders as a stacked card set with an editable name (default: first card's text, truncated).
- On `group → vote`: every ungrouped card becomes its own single-card topic; grouping freezes.
- Fallback if drag grouping isn't solid by end of timebox: a "Group with…" card menu; column moves still drag.

**Layout spec** (no mock; build from existing board components and review in the running app)

- **Placement:** a group stays in its column at the position of the card it was dropped on.
- **Group container:** light tint of the column color with a 2px border in the column color. Top row: editable group name (bold; placeholder "Name this group") and a count chip ("3 cards"). Cards stack inside at full width; more than 3 cards collapse to the first 2 plus "+N more", which expands on click.
- **Drop states:** hovering over a card's center gives it a 2px blue outline and a "Drop to group" label. Hovering between cards shows the dashed slot from the mocks.
- **Card menu:** "…" on each card opens "Group with…", a searchable list of cards in the same column.
- **States:** default, hover, name editing, dragging a card out, one-card group dissolving.
- **Footer hint:** "Drag a card onto another to group them".

**Acceptance criteria**

- [ ] Dropping card A on card B's center creates a named group containing both.
- [ ] Dropping between cards still moves rather than groups.
- [ ] Anyone can rename a group; the last rename wins and syncs to all.
- [ ] Dragging a card out of a group removes it; a one-card group dissolves.
- [ ] On entering Vote, every card belongs to exactly one topic.
- [ ] Grouping works by keyboard (via the menu fallback at minimum).

### RN-016 · Emoji reactions

**Refs:** PRD B7 · Design 1.3, 5.5 · Mocks (reaction picker, chip states) · **Est:** 1.5h · **Depends on:** RN-011 · **Cut \#2 for Sunday**

**Story:** As a participant, I want to react to revealed cards with emoji, so I can show agreement without spending votes.

**Technical notes**

- Table `card_reactions` unique on `(card_id, user_id, emoji)`; mutation `reaction.toggle`.
- Allowed on any revealed card, including Action items cards: in Write once the facilitator has revealed cards (`cards_revealed = true`), throughout Group, and again in Discuss and Wrap up. Never on hidden cards (decision Sep 29).
- Not allowed during Vote: existing reaction chips stay visible, but the picker and chip toggles are disabled.
- Picker per mock: "Add reaction" popover with search and a 12-emoji quick set (👍 ❤️ 😂 🎉 👀 🙌 💡 🔥 😬 🤔 👏 🚀).
- Chip shows emoji + count; the chip is blue-outlined and tinted when the viewer has reacted (mock chip states). Clicking a chip toggles your reaction.
- Reactions never affect vote counts or topic order.

**Acceptance criteria**

- [ ] Clicking 👍 adds a chip with count 1; clicking again removes it.
- [ ] One reaction per emoji per person; a double click never counts twice.
- [ ] The selected-state chip style shows only for the viewer's own reactions.
- [ ] The API rejects reactions during Review and Vote, and on hidden cards in Write; once cards are revealed in Write, anyone can react to anyone's card.
- [ ] The picker is reachable and usable by keyboard.

### RN-017 · AI grouping suggestions

**Refs:** PRD G2 · Design 8.1, 8.2, 8.3 · **Est:** 2h · **Depends on:** RN-015 · **Cut \#1 for Sunday**

**Story:** As a facilitator, I want AI to suggest groups of similar cards that I accept or reject one by one, so grouping takes seconds instead of minutes.

**Technical notes**

- On `write → group`, enqueue a pg-boss job `ai.groupCards`. One Claude request per board; model from config (`claude-haiku-4-5-20251001`).
- Prompt in `prompts/grouping/v1.md`; card text wrapped as data. Output validated with Zod: `[{name, cardIds[] (≥2, same column)}]`. One retry on invalid output, then no suggestions.
- Store in `group_suggestions`; broadcast to the facilitator only (via `user:{id}`).
- UI: suggestion list with Accept / Reject per group; accept sends `topic.createFromCards`. Discard pending suggestions on `group → vote`.
- Target under 5 s; failure shows nothing and manual grouping still works. Log token use per retro.

**Layout spec** (no mock; build from existing board components and review in the running app)

- **Placement:** a 320px panel on the right edge of the board, facilitator only; the columns shrink to fit. A header button "Suggestions (N)" toggles it.
- **Contents per suggestion:** group name, column dot and name, the cards' first 60 characters each, an Accept button (primary) and a Reject button (text). An "Accept all" button sits at the top of the panel.
- **Hover:** hovering a suggestion outlines its cards on the board.
- **States:** loading ("Finding similar cards…" with 3 skeleton rows); empty or failed ("No suggestions. Group cards by dragging.", never an error); accepted (collapses to "Grouped" for 2 s, then disappears); stale (a suggestion whose cards were already grouped by hand disappears).

**Acceptance criteria**

- [ ] Within 5 s of entering Group, the facilitator sees suggested groups with names.
- [ ] Suggestions never mix columns or reference unknown card IDs (validated and dropped).
- [ ] Accepting a suggestion creates the group for everyone; rejecting removes it.
- [ ] With the API key missing or the call failing, Group works normally and no error blocks the facilitator.
- [ ] Participants who aren't the facilitator never receive suggestion events.

### RN-018 · Dot voting with hidden votes

**Refs:** PRD G3, G4 · Design 4.5, 5.5, 6.3 · **Est:** 2h · **Depends on:** RN-015

**Story:** As a participant, I want to spend a budget of dots on the topics I care about, without seeing others' votes until voting ends, so the ranking reflects honest priorities.

**Technical notes**

- `retros.vote_budget` default 3, set by the facilitator before Vote.
- `vote.add {topicId}` uses the atomic update from 4.5; no returned row → 409 `no_votes_left`. `vote.remove` decrements.
- Multiple dots on one topic are allowed (one row per dot). Vote controls (decision Sep 29): each topic shows a "+" button that adds one of your votes and, only when you have at least one vote on that topic, a "−" button that removes one, with your own count between them. A single-card topic shows the controls on the card; a group shows one set for the whole group. "+" is disabled when you have no votes left. Both buttons are keyboard-focusable with labels like "Add vote to \<topic\>" and "Remove vote from \<topic\>".
- Voter sees own dots and "N votes remaining" (footer hint per mock). Others see progress only: "5 of 8 done voting" (done = budget spent or marked done).
- On `vote → discuss`: reveal counts, set `topics.vote_count`, order by votes then creation time, first topic becomes current.

**Acceptance criteria**

- [ ] Integration test: 50 concurrent `vote.add` calls from one user never exceed the budget.
- [ ] During Vote, no browser receives another person's votes or topic totals (network check).
- [ ] The footer shows the correct remaining count and updates instantly. "+" adds a vote and "−" appears only on topics where you have voted; removing your last vote on a topic hides its "−".
- [ ] After Vote, topics display vote counts and sort descending, ties by creation time.
- [ ] Going back Vote→Group refunds all votes (with RN-010).

## Tier 1 · v0.1 Day 5 — Sat Oct 3 (8h)

Day 5 closes the follow-through loop, the product's north star: every topic gets a summary, every action item gets an owner, and the next retro opens on them.

### RN-019 · Discuss queue

**Refs:** PRD G5 · Design 6.3, 6.5 · **Est:** 1h · **Depends on:** RN-018

**Story:** As a facilitator, I want to walk through topics in vote order and reorder or jump when needed, so we spend time on what matters most.

**Technical notes**

- Queue panel lists topics by `discussion_order` (initially vote order) with vote counts; current topic highlighted on the board.
- Mutations: `topic.setCurrent`, `topic.next`, `queue.reorder` (text sort keys).
- Each topic change stamps `ended_at` on the old topic and `started_at` on the new one, and enqueues the old topic's summary (RN-021).
- Topics never started are marked "not discussed" and get no summary.

**Layout spec** (no mock; build from existing board components and review in the running app)

- **Placement:** the same 320px right panel, open for everyone in Discuss and Wrap up, with two tabs: Queue and Summaries (RN-021).
- **Queue tab, top to bottom:** "Now discussing" card (topic name, vote count, card count, the notes box from RN-020, and a facilitator "Next topic" button); "Up next" list (rank, name, vote count, drag handle for the facilitator); "Discussed" list (check mark, name, summary status chip: Summarizing…, Ready or Unavailable).
- **Board:** the current topic's cards get a 2px blue outline; all other cards dim to 40% opacity.
- **States:** facilitator view (buttons and handles); participant view (read-only); last topic (button reads "Finish discussion" and moves to Wrap up); topics never discussed show "Not discussed" in grey.

**Acceptance criteria**

- [ ] Entering Discuss selects the top-voted topic for everyone.
- [ ] Next, jump and drag-reorder sync to all browsers.
- [ ] `started_at` and `ended_at` are recorded for each discussed topic.
- [ ] Undiscussed topics are labeled "not discussed" in Wrap up.

### RN-020 · Typed notes per topic

**Refs:** PRD A7 · Design 4 (`topic_notes`), 6.1 · **Est:** 0.5h · **Depends on:** RN-019

**Story:** As a facilitator, I want to type quick notes on the current topic, so the summary captures what was said even without audio.

**Technical notes**

- Notes textarea on the current topic, editable in Discuss and Wrap up; mutation `note.upsert {topicId, body}`, debounced 800 ms.
- Notes render as plain text; ≤ 4,000 characters.

**Acceptance criteria**

- [ ] Notes save automatically and appear for everyone within 1 s of the debounce.
- [ ] Notes are editable only in Discuss and Wrap up.
- [ ] Notes are included in the summary input (verified in RN-021 tests).

### RN-021 · AI topic summaries from cards and notes

**Refs:** PRD A4, A5, A7 · Design 8.1, 8.2, 8.4, 8.6, 8.7 · **Est:** 2h · **Depends on:** RN-019, RN-020

**Story:** As a facilitator, I want a summary of each topic within 30 seconds of moving on, with every point linked to its source cards, so I don't write notes and can trust the recap.

**Technical notes**

- Prompt lives at `.claude/agents/topic-summarizer.md` (frontmatter + body — this app's own
  convention for every AI agent it calls at runtime, not an Anthropic SDK feature; see
  `.claude/agents/README.md`), loaded via `apps/worker/src/agents/loadAgent.ts`. One agent file —
  the fallback below is a different *model*, not a different *prompt*, so there's nothing to
  duplicate into a second file.
- Job `ai.summarizeTopic` (high priority) on each topic change and on `discuss → wrap_up` for the
  last topic — already enqueued since RN-019 (`discussHelpers.ts`'s `endCurrentTopic`); this story
  builds the one worker consumer that actually processes it.
- Model: `AI_TOPIC_SUMMARY_MODEL` (`claude-sonnet-5`, `packages/shared/src/ai.ts`); 25 s timeout →
  one retry on `AI_TOPIC_SUMMARY_FALLBACK_MODEL` (`claude-haiku-4-5-20251001`) → "Summary
  unavailable. Retry." Same prompt both attempts.
- Input: topic name, cards, typed notes (RN-020), team member names, open action items. Card and
  note text wrapped as clearly-labeled data in the prompt, never instructions — true even if a
  card's own text happens to look like one.
- Output Zod schema: `key_points[]`, `decisions[]`, `disagreements[]`, `proposed_action_items[]`,
  each with `sources: cardId[]`. Drop entries citing unknown IDs. Decisions only with clear
  agreement. No suggested owners shown (flagged, P1).
- Every generation inserts a new `topic_summaries` row. `prompt_version` is a short hash of
  `topic-summarizer.md`'s own body at generation time (`loadAgent`'s own hash, not a hand-maintained
  version number) — editing the prompt file automatically produces a new version; nobody has to
  remember to bump anything. Edits save as the final version; compute `edit_ratio` at close
  (Levenshtein share; ≤ 20% = accepted; regenerated = not accepted).
- UI: "Summarizing…" placeholder; summary panel beside the board; hovering a point highlights its
  source cards; Edit and Regenerate buttons (facilitator only). Plain-text rendering.
- Distinct from the homework agent team's `group-summarizer` (a one-line blurb per group,
  generated at `group->vote`, shown on the Vote page in place of a group's cards) and
  `question-suggester` (opening questions, generated the moment a topic becomes current) — both
  keep running unchanged. This story's summary is the end-of-discussion recap: a different moment,
  richer structured output, and its own real storage (`topic_summaries`), not the homework's
  `topics.ai_group_summary*` columns.

**Layout spec** (no mock; build from existing board components and review in the running app)

- **Placement:** the Summaries tab of the right panel (RN-019). Clicking a discussed topic in the Queue opens its summary there with a back arrow. In Wrap up the panel opens on Summaries, showing every topic stacked in vote order.
- **Contents per summary:** topic name and vote count; sections Key points, Decisions, Disagreements and Proposed action items (each proposal has an "Add as action item" button for the facilitator). Each point ends with a small source chip ("2 cards"); hovering it outlines those cards on the board and scrolls them into view.
- **Footer:** version label ("v2"), an "Edited" badge when edited, and facilitator Edit and Regenerate buttons.
- **States:** summarizing (skeleton and spinner); ready; editing (one text area per section, Save and Cancel); unavailable ("Summary unavailable" and Retry); not discussed (grey label, no summary). Regenerating an edited summary first asks "Replace your edits?".

**Acceptance criteria**

- [ ] A summary appears within 30 s of leaving a topic (p95 in a local test with 10 cards).
- [ ] Every rendered point has at least one valid source; invalid citations never show.
- [ ] Hovering a point highlights its cards.
- [ ] Edit and Regenerate work; each regenerate creates a new version row.
- [ ] With Claude unavailable, the retro continues and the panel shows Retry.
- [ ] Unit test: prompt input contains typed notes and excludes other topics' cards.
- [ ] Unit test: `prompt_version` changes when `.claude/agents/topic-summarizer.md`'s body changes, and stays identical across two generations with no edit to the file in between.

### RN-022 · Create and edit action items

**Refs:** PRD F1, T2 · Design 1.3, 4.4, 9.2 · Mocks (Action items column) · **Est:** 1h · **Depends on:** RN-021

**Story:** As a facilitator, I want to turn AI proposals or my own words into action items with an owner and due date, so each decision becomes a tracked commitment.

**Technical notes**

- `action_items` belong to the team: `team_id, source_retro_id, source_topic_id, title, owner_id, due_date, status='open', origin ('ai'|'manual')`.
- Create from a proposed item in the summary ("Add as action item") or via "+ Add a card" in the Action items column. Allowed in Review, Discuss and Wrap up (Review added Sep 29). Items created in Review count as this retro's items (source_retro_id = this retro) and have no source topic (source_topic_id null).
- Owner picker lists team members; due date defaults to the day before the next retro (next retro = today + `retro_cadence_days`, default 14).
- Card per mock: title, owner avatar, "Name · due Oct 6", reactions.
- Column scoping: Review shows carried items (RN-025) plus any new items created during Review; Write through Wrap up shows only items with `source_retro_id = this retro`.

**Acceptance criteria**

- [ ] "Add as action item" on a proposal pre-fills title and source topic.
- [ ] Manual creation works from the column in Review, Discuss and Wrap up; owner and due date are editable inline.
- [ ] The Action items column shows only this retro's new items outside Review.
- [ ] Owner and due date changes sync to all browsers.
- [ ] `origin` records whether the item came from AI or by hand.

### RN-023 · Close the retro with the owner check

**Refs:** PRD F2 · Design 6.3, 9.2 · **Est:** 0.5h · **Depends on:** RN-022

**Story:** As a facilitator, I want the app to stop me closing while an item lacks an owner, unless I override, so no commitment leaves the room ownerless.

**Technical notes**

- Close dialog: "Next retro" date (prefilled from cadence), list of items missing owners, "Close anyway" override.
- `retro.close` mutation checks F2 server-side; override sets `closed_with_override = true`.
- On close: status `closed`, join link invalid, `next_retro_at` saved, `edit_ratio` computed for final summaries.
- Footer hint in Wrap up: "Review action items and assign owners before closing the retro".

**Layout spec** (no mock; build from existing board components and review in the running app)

- **Placement:** a centered 520px modal, opened by a "Close retro" primary button in the header during Wrap up (facilitator only; Share link stays).
- **Contents:** title "Close \<retro name\>?"; a "Next retro" date picker prefilled from the cadence; a line with the action-item count; when owners are missing, a yellow warning box listing each ownerless item with an inline owner picker.
- **Buttons:** "Close retro" (primary, disabled while any item lacks an owner); "Close anyway" (secondary, red text, shown only when owners are missing); "Cancel".
- **States:** all owned; owners missing; submitting (spinner on the button); error (inline message, dialog stays open).

**Acceptance criteria**

- [ ] Closing with an ownerless item is blocked and lists the item.
- [ ] Override closes and records `closed_with_override`.
- [ ] Closing with all owners set succeeds in one click.
- [ ] After close, all browsers switch to the read-only board (RN-026).

### RN-024 · Team action-item list

**Refs:** PRD F3 · Design 4.4, 9.1 · **Est:** 1h · **Depends on:** RN-022

**Story:** As an action-item owner, I want one team page where I can update my items between retros, so progress counts before the next retro.

**Technical notes**

- Route `/teams/:id/actions`; filters: mine, status, source retro.
- Status: open, in progress, done, dropped. Any team member may change status; every change goes to `audit_log` or `retro_events`-style history with actor and time.
- Setting `done` stamps `completed_at` (drives the north-star metric).

**Layout spec** (no mock; build from existing board components and review in the running app)

- **Placement:** full page at /teams/:id/actions, reached from the team top bar tabs "Retros" and "Action items".
- **Filter bar:** "Mine" toggle, Status multi-select, Source retro select.
- **Table columns:** Title; Owner (avatar and name); Due (red when overdue); Status (dropdown pill: Open grey, In progress blue, Done green, Dropped grey with strikethrough); Source retro (link to its closed board); Last updated. Sorted by due date ascending, with Done and Dropped at the bottom.
- **Row expand:** clicking a row shows its status history (who changed what, when).
- **States:** loading (skeleton rows); empty ("No action items yet. They'll appear after your first retro."); no filter matches ("No items match these filters" and Clear filters); error (message and Retry).

**Acceptance criteria**

- [ ] A member sees all team items with owner, due date, status and source retro.
- [ ] Marking done sets `completed_at`; reopening clears it.
- [ ] Each status change is recorded with who and when.
- [ ] Non-members get 403.

### RN-025 · Review phase and carry-over

**Refs:** PRD F4, T2 · Design 4.4, 6.3 · Mock (Review screen) · **Est:** 1h · **Depends on:** RN-024

**Story:** As a facilitator, I want every retro to open by reviewing open items from past retros, so commitments are checked before we add new ones.

**Technical notes**

- On `setup → review`, load team items with status open or in progress into the Action items column.
- During Review, each item gets quick actions: Done, In progress, Drop, Keep open. Each writes `action_item_reviews {action_item_id, retro_id, outcome}`.
- On `review → write`, unmarked items are recorded as `carried`. Items carry into every future Review until done or dropped. New items created during Review (RN-022) belong to this retro, stay in the Action items column after Review, and never get a carried review row.
- Other columns show counts of 0 and are inert in Review (per mock). Subtitle: "Reviewing previous action items".

**Acceptance criteria**

- [ ] A second retro opens in Review showing the first retro's open items.
- [ ] Marking an item done in Review sets `completed_at` and removes it from later Reviews.
- [ ] Unmarked items get a `carried` review row and appear again next retro.
- [ ] After Review, the Action items column shows only the new retro's items.

### RN-026 · Read-only closed board and summaries panel

**Refs:** PRD F6 (v0.1 form) · Design 9.5 · **Est:** 1h · **Depends on:** RN-023

**Story:** As a recap reader, I want to open a closed retro and see the board, final summaries and action items, so I can catch up if I missed it.

**Technical notes**

- Closed retros render the board in read-only mode (no add, drag, vote or react) with a summaries panel: topics in vote order, final summary version, decisions, action items with owners, undiscussed topics, attendance.
- Team-only access; retro list at `/teams/:id/retros` links to it.

**Acceptance criteria**

- [ ] A member who didn't attend can open the closed retro and read every summary.
- [ ] All editing controls are hidden and the API rejects mutations on closed retros.
- [ ] The panel shows the edited version when the facilitator edited a summary.

## Tier 1 · v0.1 Day 6 — Sun Oct 4 (6 to 8h)

v0.1 is done when a stranger can open retronoodle.com, sign in, and run a full text-only retro loop that a Playwright test also runs on every PR.

### RN-027 · Deploy the portfolio profile

**Refs:** PRD NFR · Design 2.5, 10.5, 11.1, 11.2, 11.5, 11.7, 12.1 · **Est:** 3h · **Depends on:** RN-001 to RN-026

**Story:** As a visitor, I want RetroNoodle live at retronoodle.com, so I can try it and the project costs under \$10 a month.

**Technical notes**

- Web on Cloudflare Pages (retronoodle.com, www redirects). Node on one Render instance, `ROLE=all`, at api.retronoodle.com behind Cloudflare proxy. Supabase Free.
- Merge to main: run migrations, then deploy Render and Cloudflare.
- Security baseline: CORS only `https://retronoodle.com`; strict CSP (no inline scripts, connect-src our domains + Supabase); HSTS; per-user and per-IP rate limits.
- Pino JSON logs with a redaction list (card text, notes, summaries, credentials) and a unit test that fails if any reaches a log.
- Scheduled GitHub Actions: nightly compressed DB dump; `GET /health` every 3 days so Supabase never pauses.
- Claude spend cap \$5/month in config; on cap, AI features fall back silently (manual grouping, "Summary unavailable").
- Deferred for v0.1: second encryption layer (nothing sensitive stored yet), staging.

**Acceptance criteria**

- [ ] https://retronoodle.com loads over TLS; Google sign-in round-trips in production.
- [ ] A merge to main deploys both apps with migrations applied first.
- [ ] A request from another origin is blocked by CORS.
- [ ] Redaction unit test passes; production logs contain no card text.
- [ ] Health workflow and nightly dump both ran successfully once.
- [ ] Monthly infra cost estimate is under \$10.

### RN-028 · v0.1 test suite

**Refs:** Design 12.6 (v0.1 scope) · **Est:** 2h · **Depends on:** RN-026

**Story:** As the developer, I want tests on the riskiest rules and one full-retro end-to-end test, so later milestones don't break the core loop.

**Technical notes**

- Vitest unit: state machine transitions and action matrix; vote budget; `redact()`; sort keys; timer offset math.
- Vitest integration on local Supabase: anon key reads nothing; 50 concurrent votes never exceed budget; `seq` strictly increasing; duplicate mutations ignored.
- Playwright: 4 browser contexts run Review → Write → Group → Vote → Discuss → Wrap up → Close, then a second retro opens with carried items. Assert hidden text never appears in another context's network log, votes stay hidden, and F2 blocks close.
- Claude calls use recorded fixtures in CI.

**Acceptance criteria**

- [ ] All listed tests run on every PR and pass on main.
- [ ] The Playwright test fails if hidden card text leaks (verified by temporarily disabling `redact()`).
- [ ] CI runs without real Claude or Google credentials.

### RN-029 · Demo retro and README

**Refs:** PRD Milestone 2 gate · Design 11.8 (v0.1 form), 13.4 · **Est:** 1h · **Depends on:** RN-027

**Story:** As a recruiter visiting the repo, I want a finished example retro and a clear README, so I can judge the product in a minute.

**Technical notes**

- Run one real retro in production on the Demo Team and mark it as the demo (flag on `retros`).
- README: what it is, a GIF of one retro, architecture summary, link to the design doc, v0.1 scope vs roadmap, local setup.
- Tag GitHub release `v0.1.0` with a changelog; GitHub Projects has one issue per story ID.

**Acceptance criteria**

- [ ] The demo retro shows summaries with source links and at least 2 owned action items.
- [ ] README links the design doc and explains how to run locally in under 5 commands.
- [ ] `v0.1.0` release is tagged on Oct 4, 2026.

## Tier 2 · Milestone 3 — Audio layer

Audio is the PRD's core differentiator; it starts right after v0.1 with a 2-day spike, and privacy stories come before capture so no transcript is ever stored unencrypted. Gate: 75% summary acceptance and all P0 requirements complete (together with Tier 3).

### RN-030 · Audio capture spike

**Refs:** PRD Risk "browser audio capture" · Design 7.1, 13.2 · **Est:** 2 days · **Depends on:** v0.1

**Story:** As the developer, I want to know which browser, OS and call-app combinations capture call audio reliably, so capture is built on facts.

**Technical notes:** Test `getDisplayMedia` tab audio and whole-screen system audio in Chrome on macOS and Windows against Zoom, Meet and Teams (web and desktop). Mix mic + tab audio with Web Audio into mono Opus, 250 ms chunks.

**Acceptance criteria**

- [ ] A results matrix (browser × OS × call app × web/desktop) is committed to `docs/audio-spike.md`.
- [ ] Recommended capture path and mic-only fallback are chosen and documented.
- [ ] Answers design open question Q3 (macOS with desktop call apps).

### RN-031 · Transcript encryption and retention

**Refs:** PRD A8, NFR data handling and retention · Design 4.8, 10.1, 10.3 · **Est:** 1 day · **Depends on:** RN-030

**Story:** As a team admin, I want transcripts encrypted with our own key and deleted on schedule, so candid retros stay private.

**Technical notes:** AES-256-GCM per-team data key, wrapped by a master key (Render env secret now, AWS KMS in production). Encrypt `transcript_segments.text` and integration credentials in code. Team setting `transcript_retention`: 24 h after close (default), 30 or 90 days. Nightly pg-boss job deletes expired transcripts; `speech_activity` deleted right after matching.

**Acceptance criteria**

- [ ] A raw DB read of `transcript_segments.text` shows ciphertext only.
- [ ] Destroying a team key makes its transcripts unreadable.
- [ ] Retention job deletes transcripts 24 h after close by default; admins can switch to 30 or 90 days.
- [ ] Raw audio never touches disk (verified by code review and a test on the gateway).

### RN-032 · All-party recording consent and indicators

**Refs:** PRD A2, A10, NFR consent · Design 7.6, 10.2 · **Est:** 1 day · **Depends on:** RN-031

**Story:** As a participant, I want to be asked before recording starts and to see when it is on, so I'm never recorded without agreeing.

**Technical notes:** Facilitator clicks Record → confirms "I've told everyone outside the app" (logged in `recording_sessions`) → every online participant sees "Allow recording?". Recording starts only when all agree; a decline keeps it off; a late joiner who hasn't agreed pauses it. Persistent red "Recording" badge in the header (mock). Admin setting for facilitator-only confirmation, off by default. Needs legal review before release (Q2).

**Acceptance criteria**

- [ ] Recording can't start until every online participant agrees.
- [ ] A late joiner pauses recording until they agree; a decline stops it.
- [ ] Every agreement and the facilitator confirmation are logged with time.
- [ ] The Recording badge shows on every browser while recording and disappears when stopped.

### RN-033 · Facilitator capture and audio gateway to Deepgram

**Refs:** PRD A1, A7 · Design 2.6, 7.1, 7.2, 7.3, 7.7 · **Est:** 2 days · **Depends on:** RN-032

**Story:** As a facilitator, I want to capture my mic and the call's audio from my browser, so the discussion is transcribed without a meeting bot.

**Technical notes:** Browser mixes mic + shared tab audio → Opus 250 ms chunks over a WebSocket to `apps/api` audio gateway → Deepgram Nova-3 live streaming with diarization, behind a `TranscriptionProvider` interface. Stream only during Discuss and Wrap up. Opt out of Deepgram model improvement. Capture health meter; warn after 60 s of silent call audio. Failures: 3 retries then "Transcription unavailable"; facilitator tab drop records a gap and the next facilitator can resume.

**Acceptance criteria**

- [ ] Live transcript lines arrive during Discuss in a Chrome + Meet test.
- [ ] No audio is streamed during Review, Write, Group or Vote.
- [ ] Deepgram outage shows "Transcription unavailable" and the retro continues on cards and notes.
- [ ] Swapping the provider requires changes only behind `TranscriptionProvider`.
- [ ] Cost per 45-minute retro is logged (target about \$0.20).

### RN-034 · Tag transcript lines to topics

**Refs:** PRD A3 · Design 7.4 · **Est:** 0.5 day · **Depends on:** RN-033, RN-019

**Story:** As a facilitator, I want each transcript line attached to the topic being discussed, so each summary uses only its own discussion.

**Technical notes:** Assign `topic_id` by word timestamps against topic `started_at`/`ended_at`, so a sentence finished after "Next topic" stays with the old topic. Gateway restarts insert a gap marker.

**Acceptance criteria**

- [ ] Unit test: a sentence spanning a topic change is tagged to the topic where it started.
- [ ] Topic jumps and reorders tag lines correctly.

### RN-035 · On-device speech detection

**Refs:** PRD A10 · Design 1.4, 7.5 · **Est:** 1 day · **Depends on:** RN-032

**Story:** As a participant, I want my browser to detect only when I'm speaking, without sending audio, so speakers can be named while my audio stays on my device.

**Technical notes:** Mic permission requested only after consent. Silero VAD (~2 MB) in a Web Worker; send clock-corrected speaking intervals every 5 s to `speech_activity`. Participants can turn their detection off.

**Acceptance criteria**

- [ ] Network inspection shows only timestamps from participants, never audio.
- [ ] Turning detection off stops interval uploads immediately.
- [ ] Intervals are clock-corrected using the server offset.

### RN-036 · Automatic speaker matching and "Who is this?"

**Refs:** PRD A9 · Design 7.5 · **Est:** 1.5 days · **Depends on:** RN-034, RN-035

**Story:** As a facilitator, I want transcript voices matched to participants automatically, with a quick fix for unclear ones, so summaries attribute points correctly.

**Technical notes:** Per topic: search call delay 0 to 1,000 ms in 50 ms steps for max overlap; score voice × person by overlap share; Hungarian assignment; auto-assign at score ≥ 0.6, else "Unknown speaker". Wrap up shows "Who is this?" with a short quote; corrections update `speaker_user_id` and offer "Regenerate?" on affected summaries. Delete `speech_activity` after matching.

**Acceptance criteria**

- [ ] Unit tests with synthetic delay, echo and overlap assign correctly at ≥ 0.6.
- [ ] Low-confidence voices appear in "Who is this?" and can be fixed in one click.
- [ ] `speech_activity` rows are gone after matching.

### RN-037 · Transcript-based summaries

**Refs:** PRD A4, A5 · Design 8.4 · **Est:** 1 day · **Depends on:** RN-036, RN-021

**Story:** As a facilitator, I want summaries built from what was said as well as the cards, so decisions made out loud aren't lost.

**Technical notes:** Extend `ai.summarizeTopic` input with the topic's transcript and matched speaker names; citations may reference transcript segment IDs; hovering a transcript-sourced point shows the quote. Same 30 s target and fallbacks. Add eval cases to `prompts/` CI set.

**Acceptance criteria**

- [ ] A decision spoken but not on any card appears with a transcript citation.
- [ ] Summaries still generate within 30 s p95 with a 10-minute transcript.
- [ ] With no recording, behavior matches RN-021 exactly.

## Tier 3 · Remaining v1 P0 and hardening

These finish every P0 requirement in the order Design 13.2 lists after audio. If time runs short, cut in Design 13.3 order: Google Doc export (RN-046), then described formats (RN-039), then Trello owner matching (RN-043, fall back to the owner's name on the card).

### RN-038 · Random generated format

**Refs:** PRD T3 · Design 8.1, 8.5 · **Est:** 1 day · **Depends on:** RN-007

**Story:** As a facilitator, I want one click to generate a fresh retro format, so retros stay engaging without prep.

**Technical notes:** Worker job with Sonnet; Zod output: `theme`, 3 to 5 columns of `{title, prompt, color (palette), purpose}`. Code appends Action items. Avoid the team's last 10 themes. Target under 15 s. Store with `templates.source = 'generated_random'`.

**Acceptance criteria**

- [ ] Generate returns a valid format with 3 to 5 columns in under 15 s p95.
- [ ] 10 consecutive generations never repeat a theme from the team's last 10.
- [ ] Invalid output retries once, then shows "Couldn't generate. Try again."

### RN-039 · Described format with explained refusals

**Refs:** PRD T4 · Design 8.5 · **Est:** 0.5 day · **Depends on:** RN-038

**Story:** As a facilitator, I want to describe a theme and focus in my own words and get a matching format, so the retro fits this sprint.

**Technical notes:** Text input (≤ 300 chars) wrapped as data in the prompt. The model may return `{refusal: reason}` for formats against a blame-free retro (e.g. rating teammates); show the reason verbatim.

**Acceptance criteria**

- [ ] "A heist theme focused on our release process" yields heist-themed columns about releases.
- [ ] A request to rate individual teammates returns a specific refusal reason, shown to the facilitator.
- [ ] Prompt-injection text in the description can't change the schema (eval case).

### RN-040 · Preview, edit and regenerate a format

**Refs:** PRD T5 · Design 8.5 · **Est:** 0.5 day · **Depends on:** RN-038

**Story:** As a facilitator, I want to preview and edit a generated format before starting, so I stay in control of what the team sees.

**Acceptance criteria**

- [ ] Preview shows theme, columns and prompts; each field is editable.
- [ ] Regenerate replaces the draft; Start copies the edited columns into the retro.
- [ ] Starting records the source so "generated formats used" is measurable.

### RN-041 · Email digest reminders

**Refs:** PRD F5 (email half) · Design 9.3 · **Est:** 1 day · **Depends on:** RN-024

**Story:** As an action-item owner, I want one email two days before the next retro listing my open items, so I finish them in time.

**Technical notes:** Scheduled job 2 days before `next_retro_at`; one digest per person, merging teams in the same window (max one reminder a day). "Mark done" links open the app and require sign-in. Resend in the portfolio profile from mail.retronoodle.com with SPF, DKIM, DMARC. Opt-out in `notification_prefs`. Idempotency key per person per day.

**Acceptance criteria**

- [ ] Each owner with open items gets exactly one email 2 days before the next retro.
- [ ] "Mark done" in the email marks the item done after sign-in.
- [ ] Opted-out users receive nothing.
- [ ] A retried job never sends a duplicate.

### RN-042 · Trello connect and export

**Refs:** PRD F5 (Trello half) · Design 9.4, 9.8 · **Est:** 1 day · **Depends on:** RN-031, RN-023

**Story:** As a team admin, I want action items exported to our Trello list, so they live where we track work.

**Technical notes:** Admin connects Trello once (token encrypted), picks board and list. On close or Export: one card per item with title, due date and recap link; save `trello_card_id` so edits update and re-exports never duplicate. Calls queued with idempotency keys, rate-spaced (~100 per 10 s), up to 5 retries; permanent failures shown in integration settings.

**Acceptance criteria**

- [ ] Closing a retro creates one Trello card per item in the chosen list.
- [ ] Re-exporting updates existing cards; no duplicates.
- [ ] An expired token shows "Trello token expired. Reconnect." in settings.

### RN-043 · Trello owner matching

**Refs:** PRD F5 · Design 9.4 · **Est:** 0.5 day · **Depends on:** RN-042

**Story:** As an owner, I want my exported Trello card assigned to me automatically, so I don't have to reassign it.

**Technical notes:** Layer 1: match board members by exact full name, email username vs Trello username, close name match; assign only a single unambiguous candidate; rerun on membership changes. Layer 2: "Link my Trello" one-click prompt, overriding name matches. Unmatched owners are written on the card; admins see a "pick their Trello accounts" list.

**Acceptance criteria**

- [ ] sam.lee@acme.com matches Trello user `samlee` when it's the only candidate.
- [ ] Two plausible candidates → no assignment, owner name on the card.
- [ ] "Link my Trello" overrides any name match.

### RN-044 · Online list with Presence

**Refs:** Design 5.7 · Mocks ("8 people online", avatar stack) · **Est:** 0.5 day · **Depends on:** RN-004

**Story:** As a facilitator, I want to see who is on the board, so I know when to start.

**Technical notes:** Supabase Presence on `presence:{retroId}` (browser may post); online status only. Header avatar stack shows up to 5 + "+N"; subtitle shows "N people online".

**Acceptance criteria**

- [ ] Joining and leaving update the avatar stack and count within 2 s.
- [ ] Presence carries no card or cursor data.

### RN-045 · Recap page, recap email and revocable public link

**Refs:** PRD F6, NFR access · Design 3.8, 9.5 · **Est:** 1 day · **Depends on:** RN-026, RN-041

**Story:** As a facilitator, I want a recap page and email sent at close, so wrap-up takes under 5 minutes and stakeholders stay informed.

**Technical notes:** `/r/{retroId}/recap` built from the DB: topics by votes, summaries, decisions, action items, undiscussed topics, attendance. "Send recap to participants" pre-ticked at close. Team-only by default; admins/facilitators can create a revocable public link that never shows transcripts or card authors. Record recap sent time for the wrap-up metric.

**Acceptance criteria**

- [ ] Closing with the box ticked emails every participant the recap link.
- [ ] A public link works signed-out and shows no card authors or transcripts.
- [ ] Revoking the link makes it 404 immediately.

### RN-046 · Google Doc export

**Refs:** PRD F6 · Design 3.2, 9.6 · **Est:** 1 day · **Depends on:** RN-045

**Story:** As a facilitator, I want to export the recap to a Google Doc shared with all participants, so it lives in our Drive.

**Technical notes:** Incremental OAuth for `drive.file` on first export; refresh token encrypted. Upload recap HTML with conversion; share as viewer with every participant; re-exports update the same doc; list blocked shares.

**Acceptance criteria**

- [ ] First export asks for Drive permission once; later exports don't.
- [ ] Every participant gets viewer access; failures are listed.
- [ ] Re-export updates the same document ID.

### RN-047 · Event replay on reconnect

**Refs:** PRD NFR real-time sync · Design 5.3, 5.4 · **Est:** 1 day · **Depends on:** RN-013

**Story:** As a participant on a flaky connection, I want to catch up without a full reload, so I never lose typing or cards.

**Technical notes:** Gap \> 1 s → `GET /retros/:id/events?after=N`; server broadcasts latest seq every 10 s; replay up to 500 events else snapshot; unconfirmed mutations kept in IndexedDB and resent with the same `mutationId`. Event log deleted 30 days after close.

**Acceptance criteria**

- [ ] Fault-injection test: dropped and reordered broadcasts converge with no lost cards.
- [ ] A tab closed with an unsent card resends it on reopen.
- [ ] Gaps over 500 events fall back to a snapshot.

### RN-048 · Timer pause, facilitator handoff and auto-close

**Refs:** PRD P3 · Design 6.4, 6.6, 6.7 · **Est:** 1 day · **Depends on:** RN-012

**Story:** As a facilitator, I want to pause the timer and hand off facilitation, so the retro survives interruptions and my disconnect.

**Technical notes:** Pause stores `phase_remaining_ms` and clears the deadline; resume sets a new deadline. Handoff to anyone online; after 2 minutes of facilitator disconnect, others see "Take over facilitating". Retros inactive 24 h close automatically, marked system-closed.

**Acceptance criteria**

- [ ] Pause freezes all countdowns; resume continues from the same remaining time.
- [ ] Handoff moves every facilitator control to the new person.
- [ ] A retro idle for 24 h is closed by the system.

### RN-049 · Domain allowlist and join approval

**Refs:** Design 3.3 · **Est:** 0.5 day · **Depends on:** RN-006

**Story:** As a team admin, I want people from our email domains to join instantly and others to need approval, so a leaked link can't expose our retro.

**Acceptance criteria**

- [ ] A user from an allowed domain joins without approval.
- [ ] Anyone else waits until the facilitator approves once (`join_requests`).
- [ ] Approval is remembered for that user on that team.

## Tier 4 · Milestone 4 — Demo and polish

Gate: a visitor can see a finished retro in one click, and the app meets WCAG 2.1 AA and the 500 ms p95 target under load.

### RN-050 · Observability and admin metrics page

**Refs:** PRD success metrics · Design 12.2 to 12.5 · **Est:** 1 day · **Depends on:** RN-027

**Story:** As the product owner, I want the PRD metrics and system health on one page with alerts, so I know whether the follow-through loop works.

**Technical notes:** OpenTelemetry to Grafana Cloud free; browsers post change round-trip times to `/telemetry`; Sentry free with bodies stripped. SQL views from Design 4.10 power `/admin/metrics` (email allowlist): completion rate, owner and due-date coverage, summary acceptance, wrap-up time, repeat usage, generated formats used, participation. Participation = share of retro attendees (users in retro_participants) with at least one card, vote or reaction in that retro; target 80% or more per retro (decision Sep 29, now in the PRD). Email alerts per 12.4.

**Acceptance criteria**

- [ ] `/admin/metrics` shows all 7 PRD metrics with their targets, restricted to the allowlist.
- [ ] Browser round-trip p95 is visible in Grafana.
- [ ] Each alert in 12.4 fires in a forced test.

### RN-051 · Demo mode and simulated participants

**Refs:** PRD Milestone 4 · Design 11.8 · **Est:** 1 day · **Depends on:** RN-045

**Story:** As a recruiter, I want to open a finished retro without signing in, and the developer wants to run a live retro alone in an interview.

**Technical notes:** "See a finished retro" opens a read-only Demo Team retro without sign-in, marked as demo data, reset nightly; the only public page outside team access. `pnpm demo:participants` signs in 4 simulated users who add cards, vote and react.

**Acceptance criteria**

- [ ] Signed-out visitors can view the demo retro in one click and can't reach any other team data.
- [ ] Nightly reset restores the demo to its seeded state.
- [ ] The script drives 4 participants through a full retro.

### RN-052 · Landing page and demo video

**Refs:** PRD Milestone 4 · Design 13.4 · **Est:** 1 day · **Depends on:** RN-051

**Story:** As a visitor, I want a landing page that explains RetroNoodle in one screen, so I know what it does and can try it.

**Acceptance criteria**

- [ ] Landing page states the follow-through problem and links "See a finished retro" and "Sign in".
- [ ] A 2-minute demo video is embedded and linked from the README.

### RN-053 · Accessibility pass

**Refs:** PRD NFR accessibility · Design 12.6 · **Est:** 1 day · **Depends on:** Tier 1

**Story:** As a keyboard or screen-reader user, I want to create cards, drag, react and vote without a mouse, so I can take part fully.

**Acceptance criteria**

- [ ] axe-core in Playwright reports no WCAG 2.1 AA violations on board, review, recap and team pages.
- [ ] Keyboard-only card creation, dragging, grouping (menu) and voting pass an end-to-end test.
- [ ] Phase changes and timer alerts are announced via live regions.

### RN-054 · Load and fault-injection tests

**Refs:** PRD NFR scale · Design 12.6, 12.7 · **Est:** 1 day · **Depends on:** RN-047

**Story:** As the developer, I want proof the board handles 30 people and 300 cards under 500 ms p95, so the NFR claims hold.

**Acceptance criteria**

- [ ] k6 run with 30 participants and 300 cards shows round trips under 500 ms p95 locally and once against production.
- [ ] Write-phase lock throughput sustains 15 changes per second without errors.
- [ ] Fault-injection suite passes in CI.

## Tier 5 · Milestone 5 — P1 features behind flags

Each P1 story ships behind a feature flag and reuses hooks already built in Tiers 1 to 3. Order follows Design 13.2, item 7. T7 (suggest a format from recent retros, P2) stays in the icebox.

### RN-055 · AI discussion questions

**Refs:** PRD A11 · Design 8.10 · **Est:** 1 day · **Depends on:** RN-037

**Story:** As a facilitator, I want an "Ask questions" button that gives 3 to 5 open questions about the current topic, so a stuck discussion goes deeper without AI telling us what to do.

**Acceptance criteria**

- [ ] Returns 3 to 5 questions in under 8 s; every item ends with "?" and contains no participant names (rejected in code).
- [ ] Questions never propose actions (CI eval check).
- [ ] Facilitator-only by default; a team setting opens it to everyone; max 5 presses per topic.
- [ ] Questions are stored in `topic_questions` with dismissed and helpful flags.

### RN-056 · Suggested owners on proposed action items

**Refs:** PRD A6 · Design 8.4 · **Est:** 0.5 day · **Depends on:** RN-037

**Story:** As a facilitator, I want proposed action items to suggest the person who volunteered on the call, so assigning owners is one click.

**Acceptance criteria**

- [ ] A suggested owner appears only with a cited transcript line where that person volunteered.
- [ ] Turning the flag off hides suggestions without changing stored summaries.

### RN-057 · Live named cursors and activity indicators

**Refs:** PRD B6 · Design 5.6, 5.7 · Mocks (Maya and Ana cursors) · **Est:** 1.5 days · **Depends on:** RN-044

**Story:** As a participant, I want to see others' named cursors and who is still writing, so the board feels live.

**Acceptance criteria**

- [ ] Cursors show name tags in each user's color, throttled to ≤ 20 updates per second per user.
- [ ] "Still writing" indicators show during Write without revealing text.
- [ ] In-progress drags are visible to others.

### RN-058 · Slack notifications

**Refs:** PRD F8 · Design 9.7 · **Est:** 1 day · **Depends on:** RN-041, RN-045

**Story:** As a team, we want recaps posted to a Slack channel and reminders as DMs, so follow-through happens where we talk.

**Acceptance criteria**

- [ ] Workspace install and recap channel selection work from team settings.
- [ ] Recaps post to the channel at close; reminders go by DM, respecting the one-per-day rule.
- [ ] Implemented behind the shared `Notifier` interface used by email.

### RN-059 · Trello completion sync

**Refs:** PRD F7 · Design 9.4 · **Est:** 0.5 day · **Depends on:** RN-042

**Story:** As an owner, I want my action item marked done when I complete its Trello card, so I update status once.

**Acceptance criteria**

- [ ] A signed webhook at `api.retronoodle.com/webhooks/trello` marks the linked item done and sets `completed_at`.
- [ ] Unsigned or mismatched webhook calls are rejected.

### RN-060 · Saved templates

**Refs:** PRD T6 · **Est:** 0.5 day · **Depends on:** RN-040

**Story:** As a facilitator, I want to save a generated or edited format to our team library, so we can reuse formats we liked.

**Acceptance criteria**

- [ ] "Save to library" stores the format with `team_id`; it appears in the picker for that team only.
- [ ] Saved templates can be renamed and deleted by admins and facilitators.

### RN-061 · Per-topic discussion timer

**Refs:** PRD P4 · Design 6.4 · **Est:** 0.5 day · **Depends on:** RN-019, RN-048

**Story:** As a facilitator, I want a timer per topic with a soft alert, so no single topic eats the whole Discuss phase.

**Acceptance criteria**

- [ ] Each topic gets a default time-box (Discuss total ÷ topics, editable).
- [ ] At zero, a soft alert shows; the topic never changes automatically.

## Conflicts resolved

All 11 conflicts between the mocks, the PRD and the design doc were resolved on Sep 29, 2026. The decisions are reflected in the stories above, the PRD and the design doc; see the Google Doc for the full table.
