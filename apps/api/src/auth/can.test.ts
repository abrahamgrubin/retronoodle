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
  ])('%s on %o -> %s', (action, resource, expected) => {
    expect(can(user, action, resource)).toBe(expected);
  });

  it('rejects every action when the resource type does not match', () => {
    expect(can(user, 'team.read', retroAsAdmin)).toBe(false);
    expect(can(user, 'team.member.remove', retroAsAdmin)).toBe(false);
    expect(can(user, 'retro.read', teamAdmin)).toBe(false);
  });
});
