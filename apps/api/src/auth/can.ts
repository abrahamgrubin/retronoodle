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

export type Action =
  | 'team.create'
  | 'team.read'
  | 'team.member.remove'
  | 'retro.create'
  | 'retro.read'
  | 'retro.manageJoinLink'
  | 'retro.mutate'
  | 'template.read';

/**
 * The one access-check function (CLAUDE.md: "Every access check goes through
 * `can(user, action, resource)`. No inline permission checks."). Pure and synchronous —
 * callers resolve the user's role for the resource (`membership.ts`) before calling this.
 *
 * This is a reconstruction of Design 3.4's action matrix from docs/stories.md, built up story
 * by story as routes need it (RN-005: team.*, retro.read; RN-006: retro.create,
 * retro.manageJoinLink; RN-007: template.read; RN-008: retro.mutate) since the design doc
 * itself isn't available here. Later stories add more `Action` cases as they add the routes
 * that need them (e.g. phase transitions, retro.close) — this file, not inline checks in route
 * handlers, is where those rules go.
 */
export function can(user: CanUser, action: Action, resource: Resource): boolean {
  switch (action) {
    case 'team.create':
      return true;
    case 'team.read':
      return resource?.type === 'team' && resource.role !== null;
    case 'team.member.remove':
      return resource?.type === 'team' && resource.role === 'admin';
    case 'retro.create':
      return resource?.type === 'team' && resource.role !== null;
    case 'template.read':
      // Any team member may see the templates they can create a retro from (RN-007).
      return resource?.type === 'team' && resource.role !== null;
    case 'retro.read':
      return resource?.type === 'retro' && resource.teamRole !== null;
    case 'retro.mutate':
      // Stubbed until RN-010 builds the real per-phase action matrix (Design 6.1) — for now
      // every mutation type (RN-008: retro.mutate) is allowed for any team member, regardless
      // of the retro's current phase.
      return resource?.type === 'retro' && resource.teamRole !== null;
    case 'retro.manageJoinLink':
      // Facilitator-only (RN-006): regenerating invalidates the link for everyone. Facilitator
      // isn't a stored role (see RetroResource) — it's just facilitatorId === user.id.
      return resource?.type === 'retro' && resource.facilitatorId === user.id;
    default:
      return false;
  }
}
