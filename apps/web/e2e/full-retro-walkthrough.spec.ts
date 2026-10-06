import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import {
  MISSING_SUPABASE_CREDENTIALS,
  SKIP_REASON,
  addTeamMember,
  cleanupTeam,
  createCard,
  createRetro,
  createSignedInUser,
  createTeam,
  getBoard,
  sendMutation,
  sendMutationRaw,
  signIn,
  type TestUser,
} from './helpers.js';

/**
 * RN-028: "4 browser contexts run Review → Write → Group → Vote → Discuss → Wrap up → Close,
 * then a second retro opens with carried items. Assert hidden text never appears in another
 * context's network log, votes stay hidden, and F2 blocks close."
 *
 * A brand-new team's first retro always starts in Write (no carried-over items exist yet — see
 * apps/api/src/routes/retros.ts), so the Review phase only ever shows up once a second retro is
 * created afterward with open action items still on the books; between the two retros, every
 * phase in the table gets walked at least once.
 *
 * Every mutation here goes through the same `POST /retros/:id/mutations` API the real app calls
 * (same division of labor as hidden-cards.spec.ts) — the four browser contexts exist to observe
 * what each participant's own board actually renders and receives over Realtime, not to drive
 * every click; a full UI-automated walkthrough of six phases would be far slower and flakier
 * without checking anything a direct mutation call doesn't already.
 */

test.skip(MISSING_SUPABASE_CREDENTIALS, SKIP_REASON);

async function openBoard(page: Page, user: TestUser, retroId: string) {
  await page.goto(`/retros/${retroId}`);
  await signIn(page, user);
}

test('a full retro walkthrough across every phase, then a second retro opens with carried-over items', async ({ browser }) => {
  const facilitator = await createSignedInUser('facilitator');
  const voter = await createSignedInUser('voter');
  const otherVoter = await createSignedInUser('other-voter');
  const observer = await createSignedInUser('observer');
  const users = [facilitator, voter, otherVoter, observer];

  const teamId = await createTeam(facilitator, 'RN-028 e2e team');
  await addTeamMember(teamId, voter, 'Voter');
  await addTeamMember(teamId, otherVoter, 'Other voter');
  await addTeamMember(teamId, observer, 'Observer');
  const { retroId, columnId } = await createRetro(facilitator, teamId, 'RN-028 e2e retro');

  const contexts = await Promise.all(users.map(() => browser.newContext()));
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  const [facilitatorPage, voterPage, otherVoterPage, observerPage] = pages as [Page, Page, Page, Page];

  // Captured on the observer's page only — the one participant who never authors a card, casts a
  // vote, or creates an action item in this test, so anything of theirs showing up here can only
  // mean it leaked.
  const observerResponseBodies: string[] = [];
  observerPage.on('response', (res) => {
    if (res.url().includes('/board')) void res.text().then((b) => observerResponseBodies.push(b)).catch(() => {});
  });
  const observerWsFrames: string[] = [];
  observerPage.on('websocket', (ws) => {
    ws.on('framereceived', (frame) => {
      if (typeof frame.payload === 'string') observerWsFrames.push(frame.payload);
    });
  });

  try {
    await Promise.all([
      openBoard(facilitatorPage, facilitator, retroId),
      openBoard(voterPage, voter, retroId),
      openBoard(otherVoterPage, otherVoter, retroId),
      openBoard(observerPage, observer, retroId),
    ]);
    await expect(facilitatorPage.getByText('Adding cards to each column')).toBeVisible(); // Write's subtitle

    // --- Write ---
    const secretA = `SECRET-A-${randomUUID()}`;
    const secretB = `SECRET-B-${randomUUID()}`;
    await createCard(retroId, columnId, facilitator, secretA);
    await createCard(retroId, columnId, voter, secretB);
    await expect(observerPage.getByText('Hidden until reveal')).toHaveCount(2);
    for (const body of observerResponseBodies) {
      expect(body).not.toContain(secretA);
      expect(body).not.toContain(secretB);
    }
    for (const frame of observerWsFrames) {
      expect(frame).not.toContain(secretA);
      expect(frame).not.toContain(secretB);
    }
    expect(observerResponseBodies.length).toBeGreaterThan(0); // the loop above wasn't vacuous

    await sendMutation(retroId, facilitator.accessToken, 'phase.next', {}); // write -> group (auto-reveals)
    await expect(observerPage.getByText('Grouping similar cards')).toBeVisible();
    await expect(observerPage.getByText(secretA)).toBeVisible();
    await expect(observerPage.getByText(secretB)).toBeVisible();

    // --- Group ---
    const boardAfterReveal = await getBoard(retroId, facilitator.accessToken);
    const [cardA, cardB] = boardAfterReveal.cards as [{ id: string; body: string }, { id: string; body: string }];
    const groupedTopicId = randomUUID();
    await sendMutation(retroId, facilitator.accessToken, 'topic.createFromCards', {
      topicId: groupedTopicId,
      cardIds: [cardA.id, cardB.id],
      name: 'Grouped topic',
    });
    const secretC = `SECRET-C-${randomUUID()}`; // left ungrouped — becomes its own singleton topic at group->vote
    await createCard(retroId, columnId, otherVoter, secretC);

    await sendMutation(retroId, facilitator.accessToken, 'phase.next', {}); // group -> vote
    await expect(observerPage.getByText('Voting in progress')).toBeVisible();

    // --- Vote ---
    const boardAtVote = await getBoard(retroId, facilitator.accessToken);
    const topics = boardAtVote.topics as { id: string; name: string; voteCount: number }[];
    const singletonTopic = topics.find((t) => t.id !== groupedTopicId)!;

    await sendMutation(retroId, voter.accessToken, 'vote.add', { topicId: groupedTopicId });
    await sendMutation(retroId, voter.accessToken, 'vote.add', { topicId: groupedTopicId });
    await sendMutation(retroId, otherVoter.accessToken, 'vote.add', { topicId: singletonTopic.id });

    // RN-018/CLAUDE.md: "Hidden card text and votes never leave the server" — `topics.vote_count`
    // is never live-updated while voting is in progress (only at the vote->discuss transition, see
    // onTransition.ts), so the only aggregate exposed mid-Vote is each viewer's own `myVotes` —
    // the observer (who never votes) must see theirs stay empty, and must never see the private
    // per-voter result (`myCount`), which only ever goes out on the voter's own channel.
    const boardSeenByObserver = await getBoard(retroId, observer.accessToken);
    expect(boardSeenByObserver.myVotes).toEqual([]);
    for (const body of observerResponseBodies) expect(body).not.toContain('myCount');
    for (const frame of observerWsFrames) expect(frame).not.toContain('myCount');

    await sendMutation(retroId, facilitator.accessToken, 'phase.next', {}); // vote -> discuss (ranks + starts the top topic)
    await expect(observerPage.getByText('Discussing topics')).toBeVisible();

    // Only now does vote_count become accurate (the vote->discuss sweep computes it from `votes`)
    // — and it's a plain aggregate, safe for the observer to see.
    const boardAfterRanking = await getBoard(retroId, observer.accessToken);
    const rankedTopics = boardAfterRanking.topics as { id: string; voteCount: number }[];
    expect(rankedTopics.find((t) => t.id === groupedTopicId)?.voteCount).toBe(2);
    expect(rankedTopics.find((t) => t.id === singletonTopic.id)?.voteCount).toBe(1);

    // --- Discuss ---
    const ownerlessItemId = randomUUID();
    await sendMutation(retroId, facilitator.accessToken, 'actionItem.create', {
      id: ownerlessItemId,
      title: 'Investigate the pipeline',
      sourceTopicId: groupedTopicId,
      ownerId: null,
      dueDate: null,
      origin: 'manual',
    });
    const ownedItemId = randomUUID();
    await sendMutation(retroId, facilitator.accessToken, 'actionItem.create', {
      id: ownedItemId,
      title: 'Write a runbook',
      sourceTopicId: groupedTopicId,
      ownerId: voter.userId,
      dueDate: null,
      origin: 'manual',
    });
    await sendMutation(retroId, facilitator.accessToken, 'topic.next', {}); // ends the current topic, starts the next
    await sendMutation(retroId, facilitator.accessToken, 'topic.next', {}); // ends the last one, nothing left to start

    await sendMutation(retroId, facilitator.accessToken, 'phase.next', {}); // discuss -> wrap_up
    await expect(observerPage.getByText('Wrapping up')).toBeVisible();

    // --- Wrap up / Close (F2) ---
    const blockedClose = await sendMutationRaw(retroId, facilitator.accessToken, 'retro.close', {
      nextRetroAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      override: false,
    });
    expect(blockedClose.status).toBe(409); // owners_missing — the ownerless item blocks it

    const override = await sendMutationRaw(retroId, facilitator.accessToken, 'retro.close', {
      nextRetroAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      override: true,
    });
    expect(override.ok).toBe(true);
    await expect(observerPage.getByText('Retro closed')).toBeVisible();

    // --- Second retro opens with the carried-over items ---
    const { retroId: secondRetroId } = await createRetro(facilitator, teamId, 'RN-028 e2e second retro');
    const secondBoard = await getBoard(secondRetroId, facilitator.accessToken);
    expect(secondBoard.retro.phase).toBe('review');
    const carriedTitles = (secondBoard.actionItems as { title: string }[]).map((a) => a.title);
    expect(carriedTitles).toEqual(expect.arrayContaining(['Investigate the pipeline', 'Write a runbook']));

    await openBoard(facilitatorPage, facilitator, secondRetroId);
    await expect(facilitatorPage.getByText('Reviewing previous action items')).toBeVisible();
    await expect(facilitatorPage.getByText('Investigate the pipeline')).toBeVisible();
    await expect(facilitatorPage.getByText('Write a runbook')).toBeVisible();
  } finally {
    for (const context of contexts) await context.close();
    await cleanupTeam(teamId, users);
  }
});
