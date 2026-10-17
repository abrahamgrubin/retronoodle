import type { PoolClient } from 'pg';
import { generateKeyBetween } from 'fractional-indexing';
import { defaultTopicName, Topic, type RetroPhase } from '@retronoodle/shared';
import { buildRecordingSession, ONLINE_WINDOW_SECONDS } from '../recordingSession.js';
import type { JobSender, LockedRetro } from './registry.js';

type TransitionEffect = (ctx: {
  client: PoolClient;
  retro: LockedRetro;
  jobs?: JobSender;
  sideEffects: { type: string; payload: unknown }[];
}) => Promise<void>;

/**
 * Transition side effects (Design 6.3), one row per `"from->to"` pair. RN-010 owns this table
 * and its own single row (refunding votes on the one backward transition that has any); later
 * stories add rows here rather than teaching phaseNext/phaseBack about their own side effects —
 * RN-011 (reveal cards on write->group), RN-015/17/18/19/21/23/25 add the rest.
 *
 * `votes` has one row per dot (RN-018), not a `votes_used` counter column, so "refund" is
 * deleting the rows — there's nothing else to zero out.
 */
const onTransition: Partial<Record<`${RetroPhase}->${RetroPhase}`, TransitionEffect>> = {
  'vote->group': async ({ client, retro }) => {
    await client.query('delete from votes where retro_id = $1', [retro.id]);
  },
  // RN-025: "On review -> write, unmarked items are recorded as carried." Anything the
  // facilitator (or anyone) already clicked a quick action for already has a row for this retro
  // (actionItemReview.ts's own upsert, including an explicit "Keep open" — which writes this same
  // 'carried' outcome itself) — `on conflict do nothing` here is what keeps an explicit click from
  // being silently overwritten by this sweep. Excludes this retro's own brand-new items
  // (`source_retro_id <> retro.id`) — those never had anything to review in the first place.
  'review->write': async ({ client, retro }) => {
    await client.query(
      `insert into action_item_reviews (action_item_id, retro_id, outcome, actor_id)
       select id, $1, 'carried', null
       from action_items
       where team_id = $2 and source_retro_id <> $1 and status in ('open', 'in_progress')
       on conflict (action_item_id, retro_id) do nothing`,
      [retro.id, retro.team_id],
    );
  },
  // RN-011: "Reveal happens ... on write -> group". This only sets the durable flag — it
  // deliberately does NOT also broadcast every card's full content here. A second broadcast for
  // this transition would need its own retro_events row (and thus its own seq) to avoid
  // colliding with phase.next's own seq on the same channel, which phaseNext.ts's apply() has no
  // way to arrange without pipeline.ts growing a multi-event-per-mutation broadcast path. Instead,
  // the web client refetches the board once it sees the phase leave Write (BoardPage.tsx) — one
  // extra round trip, well inside the "within 500ms" acceptance criterion, and far simpler than
  // the alternative. cards.reveal (the *manual* Reveal button) has no such problem: its own
  // result already broadcasts every card as the mutation's normal, single, real event.
  'write->group': async ({ client, retro, jobs }) => {
    await client.query('update retros set cards_revealed = true where id = $1', [retro.id]);
    // RN-017: "On write -> group, enqueue a pg-boss job ai.groupCards." Best-effort — AI grouping
    // is optional polish, never a reason to fail the phase transition itself (no `jobs` at all is
    // the same graceful-absence pattern as main.ts's "worker skipped: DATABASE_URL not set").
    if (jobs) {
      try {
        await jobs.send('ai.groupCards', { retroId: retro.id });
      } catch {
        // Swallowed deliberately — see above.
      }
    }
  },
  // RN-015 AC: "On entering Vote, every card belongs to exactly one topic" — grouping freezes
  // once Vote starts, so any card still ungrouped when Group ends becomes its own single-card
  // topic; already-grouped cards are untouched. One topic id per card, server-generated directly
  // in SQL (`gen_random_uuid()`) since there's no client round trip for a transition side effect
  // (same reasoning as retro_columns' own "server-generated" copy-at-start).
  'group->vote': async ({ client, retro, jobs, sideEffects }) => {
    const ungrouped = await client.query<{ id: string; column_id: string; body: string }>(
      'select id, column_id, body from cards where retro_id = $1 and topic_id is null',
      [retro.id],
    );
    // registry.ts's own comment on MutationContext.sideEffects: this transition's own broadcast
    // only ever carries `{phase, phaseDeadline}`, same gap as vote->discuss's ranking below —
    // every one of these brand-new topics (and the card now pointing at it) is otherwise invisible
    // to a client until something else happens to trigger a resync that wins its race against
    // this transition's own commit, which it reliably doesn't (found live: a lone card stayed
    // rendered as a bare ungrouped card through Vote and Discuss, with no topic to attach its
    // vote/queue controls to, until the page was reloaded).
    const createdTopics: Topic[] = [];
    const cardTopicAssignments: { cardId: string; topicId: string }[] = [];
    for (const card of ungrouped.rows) {
      const name = defaultTopicName(card.body);
      const inserted = await client.query<{ id: string }>(
        'insert into topics (id, retro_id, column_id, name) values (gen_random_uuid(), $1, $2, $3) returning id',
        [retro.id, card.column_id, name],
      );
      const topicId = inserted.rows[0]!.id;
      await client.query('update cards set topic_id = $1 where id = $2', [topicId, card.id]);
      createdTopics.push(
        Topic.parse({
          id: topicId,
          columnId: card.column_id,
          name,
          voteCount: 0,
          discussionOrder: null,
          startedAt: null,
          endedAt: null,
          groupSummaryTitle: null,
          groupSummary: null,
          discussionQuestions: null,
          notes: '',
        }),
      );
      cardTopicAssignments.push({ cardId: card.id, topicId });
    }
    if (createdTopics.length > 0) {
      sideEffects.push({ type: 'topics.created', payload: { topics: createdTopics } });
      sideEffects.push({ type: 'cards.topicAssigned', payload: { assignments: cardTopicAssignments } });
    }
    // RN-017: "Discard pending suggestions on group -> vote" — grouping freezes with Vote, so
    // anything the facilitator never acted on no longer means anything. 'rejected' rather than a
    // new status: a discarded suggestion and a rejected one both just mean "not adopted."
    await client.query("update group_suggestions set status = 'rejected' where retro_id = $1 and status = 'pending'", [retro.id]);

    // Homework: grouping is locked in the moment Vote starts — every topic (pre-existing groups
    // and the just-created single-card ones above) gets its own ai.summarizeGroup job, best-effort
    // same as write->group's ai.groupCards. One job per topic (not one job for the whole retro)
    // since group-summarizer.md's own prompt is scoped to "one group of retro cards at a time."
    if (jobs) {
      const topics = await client.query<{ id: string }>('select id from topics where retro_id = $1', [retro.id]);
      for (const topic of topics.rows) {
        try {
          await jobs.send('ai.summarizeGroup', { topicId: topic.id });
        } catch {
          // Swallowed deliberately — see above.
        }
      }
    }
  },
  // RN-018: "reveal counts, set topics.vote_count, order by votes then creation time, first
  // topic becomes current." `vote_count` is never live-updated while voting is in progress
  // (see voteHelpers.ts's own comment) — this is the one place it's actually written, which is
  // also what makes it "revealed": before this runs, every topic's count is still its
  // just-created default of 0. `discussion_order`/`started_at` are consumed by RN-019's own
  // discuss-queue UI, not built out here — this just leaves them set.
  'vote->discuss': async ({ client, retro, jobs, sideEffects }) => {
    const ranked = await client.query<{ id: string; vote_count: number }>(
      `select t.id, count(v.id)::int as vote_count
       from topics t
       left join votes v on v.topic_id = t.id
       where t.retro_id = $1
       group by t.id
       order by count(v.id) desc, t.created_at asc`,
      [retro.id],
    );
    let previousOrder: string | null = null;
    // registry.ts's own comment on MutationContext.sideEffects: same gap as recordingSession
    // above — this transition's own broadcast only ever carries `{phase, phaseDeadline}|`, never
    // the ranking this just wrote, so a resync racing this transition's commit (the same race as
    // recordingSession, just for a different field) could still hand a client a snapshot from
    // before any of this ran — the queue stays empty and nobody looks like "now discussing"
    // until something else happens to trigger another resync, like a manual reload (found live).
    const rankedTopics: { id: string; voteCount: number; discussionOrder: string; startedAt: string | null }[] = [];
    for (const [index, topic] of ranked.rows.entries()) {
      const order = generateKeyBetween(previousOrder, null);
      const startedAt = index === 0 ? new Date() : null;
      await client.query('update topics set vote_count = $1, discussion_order = $2, started_at = $3 where id = $4', [
        topic.vote_count,
        order,
        startedAt,
        topic.id,
      ]);
      rankedTopics.push({ id: topic.id, voteCount: topic.vote_count, discussionOrder: order, startedAt: startedAt?.toISOString() ?? null });
      previousOrder = order;
    }
    if (rankedTopics.length > 0) sideEffects.push({ type: 'topics.ranked', payload: { topics: rankedTopics } });

    // Homework: the top-ranked topic just became current the same way startTopic() makes any
    // other topic current — this transition does its own raw `update` above instead of calling
    // that helper (it's stamping every topic's rank in one loop, not just one), so the
    // question-suggester enqueue has to be repeated here rather than shared.
    const first = ranked.rows[0];
    if (jobs && first) {
      try {
        await jobs.send('ai.suggestQuestions', { topicId: first.id });
      } catch {
        // Swallowed deliberately — see above.
      }
    }
  },
};

/**
 * Starts recording the moment a retro first reaches Discuss, from any direction — "they already
 * agreed to the discussion being recorded when they joined" is the premise now, so there's no
 * facilitator "Record" click to represent anymore: `facilitator_confirmed_at` is just stamped
 * with the system's own trigger time. Every other consent mechanic is untouched (RN-032):
 * whoever's online when this fires still gets a `pending` consent row and still sees "Allow
 * recording?", a late joiner is still detected and paused the same way, and a decline still stops
 * it. Runs at most once ever per retro — checked by "does any recording_sessions row exist at
 * all," not just a non-stopped one, so re-entering Discuss later (Back, or a backward jump) never
 * overrides a facilitator's own explicit stop.
 */
async function autoStartRecordingIfNeeded(
  client: PoolClient,
  retro: LockedRetro,
  sideEffects: { type: string; payload: unknown }[],
): Promise<void> {
  const existing = await client.query('select 1 from recording_sessions where retro_id = $1 limit 1', [retro.id]);
  if (existing.rows.length > 0) return;

  const teamResult = await client.query<{ recording_facilitator_only_confirmation: boolean }>(
    'select recording_facilitator_only_confirmation from teams where id = $1',
    [retro.team_id],
  );
  const facilitatorOnly = teamResult.rows[0]?.recording_facilitator_only_confirmation ?? false;

  const onlineResult = facilitatorOnly
    ? { rows: [] as { user_id: string }[] }
    : await client.query<{ user_id: string }>(
        `select user_id from retro_participants
         where retro_id = $1 and user_id <> $2 and last_seen_at > now() - make_interval(secs => $3)`,
        [retro.id, retro.facilitator_id, ONLINE_WINDOW_SECONDS],
      );

  const allAgreedAlready = facilitatorOnly || onlineResult.rows.length === 0;
  const now = new Date();

  const inserted = await client.query<{ id: string }>(
    `insert into recording_sessions (id, retro_id, started_by, facilitator_confirmed_at, status, started_at)
     values (gen_random_uuid(), $1, $2, $3, $4, $5) returning id`,
    [retro.id, retro.facilitator_id, now.toISOString(), allAgreedAlready ? 'recording' : 'pending', allAgreedAlready ? now.toISOString() : null],
  );
  const sessionId = inserted.rows[0]!.id;
  const status = allAgreedAlready ? 'recording' : 'pending';

  await client.query(`insert into recording_consents (session_id, user_id, outcome, responded_at) values ($1, $2, 'agreed', $3)`, [
    sessionId,
    retro.facilitator_id,
    now.toISOString(),
  ]);
  for (const row of onlineResult.rows) {
    await client.query('insert into recording_consents (session_id, user_id) values ($1, $2)', [sessionId, row.user_id]);
  }

  // registry.ts's own comment on MutationContext.sideEffects: this transition's own broadcast
  // only ever carries `{phase, phaseDeadline}` (phaseNext.ts/phaseJumpTo.ts), never the session
  // this just created — without pushing it here too, board.recordingSession stays null on every
  // client until their next resync happens to win its race against that phase broadcast, which it
  // reliably didn't (found live).
  sideEffects.push({
    type: 'recording.sessionUpdated',
    payload: {
      session: buildRecordingSession(
        { id: sessionId, started_by: retro.facilitator_id, facilitator_confirmed_at: now.toISOString(), status, started_at: allAgreedAlready ? now.toISOString() : null, stopped_at: null },
        [
          { user_id: retro.facilitator_id, outcome: 'agreed', responded_at: now.toISOString() },
          ...onlineResult.rows.map((row) => ({ user_id: row.user_id, outcome: 'pending', responded_at: null })),
        ],
      ),
    },
  });
}

export async function runTransitionEffect(
  client: PoolClient,
  retro: LockedRetro,
  from: RetroPhase,
  to: RetroPhase,
  jobs?: JobSender,
  // Defaults to a throwaway array — every caller in production (phaseNext/phaseBack/phaseJumpTo)
  // passes its own, but the many onTransition.test.ts call sites that only care about the DB
  // writes have nothing to gain from threading one through just to satisfy this signature.
  sideEffects: { type: string; payload: unknown }[] = [],
): Promise<void> {
  const effect = onTransition[`${from}->${to}`];
  if (effect) await effect({ client, retro, jobs, sideEffects });
  if (to === 'discuss') await autoStartRecordingIfNeeded(client, retro, sideEffects);
}
