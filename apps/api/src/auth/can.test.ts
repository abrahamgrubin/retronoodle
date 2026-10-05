import { describe, expect, it } from 'vitest';
import { can, type Action, type Resource } from './can.js';

const user = { id: '00000000-0000-4000-8000-000000000001' };

const teamAdmin: Resource = { type: 'team', role: 'admin' };
const teamMember: Resource = { type: 'team', role: 'member' };
const teamNonMember: Resource = { type: 'team', role: null };

const retroAsAdmin: Resource = { type: 'retro', teamRole: 'admin', facilitatorId: 'someone-else' };
const retroAsMember: Resource = { type: 'retro', teamRole: 'member', facilitatorId: 'someone-else' };
const retroNonMember: Resource = { type: 'retro', teamRole: null, facilitatorId: 'someone-else' };
const retroAsFacilitator: Resource = { type: 'retro', teamRole: 'member', facilitatorId: user.id };

const ownCard: Resource = { type: 'card', authorId: user.id };
const othersCard: Resource = { type: 'card', authorId: 'someone-else' };

describe('can — role x action matrix (Design 3.4, reconstructed for RN-005)', () => {
  it.each<[Action, Resource, boolean]>([
    // team.create: no resource yet, so anyone authenticated may create a team.
    ['team.create', null, true],

    // team.read: any member (admin or plain member) may read; a non-member may not.
    ['team.read', teamAdmin, true],
    ['team.read', teamMember, true],
    ['team.read', teamNonMember, false],

    // team.member.remove: admin only.
    ['team.member.remove', teamAdmin, true],
    ['team.member.remove', teamMember, false],
    ['team.member.remove', teamNonMember, false],

    // retro.read: any team member may read every retro of their team, including ones they
    // didn't attend (U3) — attendance plays no part in this check.
    ['retro.read', retroAsAdmin, true],
    ['retro.read', retroAsMember, true],
    ['retro.read', retroNonMember, false],

    // retro.mutate: whether the caller may attempt a mutation at all (team membership) — which
    // mutation *types* the current phase allows is a separate check (RN-010's phaseCheck).
    ['retro.mutate', retroAsAdmin, true],
    ['retro.mutate', retroAsMember, true],
    ['retro.mutate', retroNonMember, false],

    // retro.create: any team member (admin or plain member) may create a retro.
    ['retro.create', teamAdmin, true],
    ['retro.create', teamMember, true],
    ['retro.create', teamNonMember, false],

    // template.read: any team member may see the templates they can create a retro from.
    ['template.read', teamAdmin, true],
    ['template.read', teamMember, true],
    ['template.read', teamNonMember, false],

    // retro.manageJoinLink: facilitator only — team admin doesn't get a pass, only whoever
    // facilitates this specific retro.
    ['retro.manageJoinLink', retroAsFacilitator, true],
    ['retro.manageJoinLink', retroAsAdmin, false],
    ['retro.manageJoinLink', retroAsMember, false],
    ['retro.manageJoinLink', retroNonMember, false],

    // retro.transitionPhase (RN-010): facilitator only — "phase.next/back/skip that only the
    // facilitator may send". Same rule as manageJoinLink, checked independently here in case the
    // two ever diverge.
    ['retro.transitionPhase', retroAsFacilitator, true],
    ['retro.transitionPhase', retroAsAdmin, false],
    ['retro.transitionPhase', retroAsMember, false],
    ['retro.transitionPhase', retroNonMember, false],

    // retro.revealCards (RN-011): facilitator only — "the facilitator clicks Reveal".
    ['retro.revealCards', retroAsFacilitator, true],
    ['retro.revealCards', retroAsAdmin, false],
    ['retro.revealCards', retroAsMember, false],
    ['retro.revealCards', retroNonMember, false],

    // retro.respondToSuggestion (RN-017): facilitator only — suggestions are only ever sent to
    // the facilitator in the first place.
    ['retro.respondToSuggestion', retroAsFacilitator, true],
    ['retro.respondToSuggestion', retroAsAdmin, false],
    ['retro.respondToSuggestion', retroAsMember, false],
    ['retro.respondToSuggestion', retroNonMember, false],

    // retro.manageDiscussQueue (RN-019): facilitator only — "As a facilitator, I want to walk
    // through topics..." — topic.next/topic.setCurrent/queue.reorder all gate on this.
    ['retro.manageDiscussQueue', retroAsFacilitator, true],
    ['retro.manageDiscussQueue', retroAsAdmin, false],
    ['retro.manageDiscussQueue', retroAsMember, false],
    ['retro.manageDiscussQueue', retroNonMember, false],

    // retro.editAiSummary (homework): facilitator only — "the facilitator to be able to edit the
    // [group] summary" — topic.editGroupSummary gates on this.
    ['retro.editAiSummary', retroAsFacilitator, true],
    ['retro.editAiSummary', retroAsAdmin, false],
    ['retro.editAiSummary', retroAsMember, false],
    ['retro.editAiSummary', retroNonMember, false],

    // retro.close (RN-023): facilitator only — "a 'Close retro' primary button ... facilitator
    // only" — retro.close gates on this.
    ['retro.close', retroAsFacilitator, true],
    ['retro.close', retroAsAdmin, false],
    ['retro.close', retroAsMember, false],
    ['retro.close', retroNonMember, false],

    // actionItem.read / actionItem.updateStatus (RN-024): any team member, no role distinction —
    // "A member sees all team items" / "Any team member may change status."
    ['actionItem.read', teamAdmin, true],
    ['actionItem.read', teamMember, true],
    ['actionItem.read', teamNonMember, false],
    ['actionItem.updateStatus', teamAdmin, true],
    ['actionItem.updateStatus', teamMember, true],
    ['actionItem.updateStatus', teamNonMember, false],

    // card.edit / card.delete / card.move: ownership, not a role — only the author, ever.
    ['card.edit', ownCard, true],
    ['card.edit', othersCard, false],
    ['card.delete', ownCard, true],
    ['card.delete', othersCard, false],
    ['card.move', ownCard, true],
    ['card.move', othersCard, false],
  ])('%s on %o -> %s', (action, resource, expected) => {
    expect(can(user, action, resource)).toBe(expected);
  });

  it('rejects every action when the resource type does not match', () => {
    expect(can(user, 'team.read', retroAsAdmin)).toBe(false);
    expect(can(user, 'team.member.remove', retroAsAdmin)).toBe(false);
    expect(can(user, 'retro.read', teamAdmin)).toBe(false);
  });
});
