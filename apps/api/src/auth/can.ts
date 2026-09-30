export type TeamRole = 'admin' | 'member';

export interface CanUser {
  id: string;
}

/** The caller's role on a team; null means they aren't a member. */
export interface TeamResource {
  type: 'team';
  role: TeamRole | null;
}

/**
 * The caller's role on the retro's team, plus who facilitates it. Facilitator isn't a stored
 * role (Design 3.4) — it's just `facilitatorId === user.id`, resolved per retro.
 */
export interface RetroResource {
  type: 'retro';
  teamRole: TeamRole | null;
  facilitatorId: string;
}

export type Resource = TeamResource | RetroResource | null;

export type Action = 'team.create' | 'team.read' | 'team.member.remove' | 'retro.read';

/**
 * The one access-check function (CLAUDE.md: "Every access check goes through
 * `can(user, action, resource)`. No inline permission checks."). Pure and synchronous —
 * callers resolve the user's role for the resource (`membership.ts`) before calling this.
 *
 * This is RN-005's reconstruction of Design 3.4's action matrix from docs/stories.md; the
 * design doc itself wasn't available while building it, so it only covers the actions RN-005's
 * own routes need plus `retro.read` (explicitly required by this story's own acceptance
 * criteria, ahead of the retro routes RN-006 adds). Later stories add more `Action` cases here
 * as they add the routes that need them (e.g. phase transitions, retro.close) — this file, not
 * inline checks in route handlers, is where those rules go.
 */
export function can(user: CanUser, action: Action, resource: Resource): boolean {
  switch (action) {
    case 'team.create':
      return true;
    case 'team.read':
      return resource?.type === 'team' && resource.role !== null;
    case 'team.member.remove':
      return resource?.type === 'team' && resource.role === 'admin';
    case 'retro.read':
      return resource?.type === 'retro' && resource.teamRole !== null;
    default:
      return false;
  }
}
