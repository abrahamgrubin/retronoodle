import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Avatar, Box, ButtonBase, Menu, MenuItem, Typography } from '@mui/material';
import { signOut } from './auth';
import { BORDER, INDIGO, INDIGO_SOFT, INK, MUTED } from './designTokens';
import { colorForId, initialsFor } from './palette';
import { useMe } from './useMe';
import { useSession } from './useSession';

/** Figma "Navigation item" rows (131:1227 / 131:1231 / 144:826 on "Home · team workspace") —
 * icon + label when expanded, icon-only once collapsed. The current page's row is tinted
 * (`INDIGO_SOFT` background, indigo label and icon); every other row is slate. Each icon comes as
 * a pair of files since the SVGs carry their own stroke colour. */
export function DrawerNavItem({
  icon,
  label,
  href,
  active,
  collapsed,
}: {
  icon: { slate: string; indigo: string };
  label: string;
  href: string;
  active: boolean;
  collapsed: boolean;
}) {
  return (
    <ButtonBase
      component="a"
      href={href}
      aria-current={active ? 'page' : undefined}
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'flex-start',
        gap: collapsed ? 0 : '16px',
        height: 48,
        px: collapsed ? 0 : '24px',
        width: '100%',
        bgcolor: active ? INDIGO_SOFT : 'white',
        color: active ? INDIGO : MUTED,
        fontSize: 16,
        fontWeight: active ? 500 : 400,
        textAlign: 'left',
        '&:hover': { bgcolor: active ? INDIGO_SOFT : '#f8fafc' },
        '&.Mui-focusVisible': { outline: `2px solid ${INDIGO}`, outlineOffset: -2 },
      }}
    >
      <Box component="img" src={active ? icon.indigo : icon.slate} alt="" sx={{ width: 24, height: 24, flexShrink: 0 }} />
      {!collapsed && (
        <Box component="span" sx={{ whiteSpace: 'nowrap' }}>
          {label}
        </Box>
      )}
    </ButtonBase>
  );
}

/** Figma "Signed-in account" (131:1240): the initials avatar and full name, pinned to the bottom
 * of the drawer. Clicking it opens a one-item menu — "Sign out" — which MUI's Menu already closes
 * on Esc or a click outside. Signing out ends the Supabase session, drops every cached query (so
 * nothing from this account survives into the next one) and lands on `/`, where App() shows the
 * sign-in page because there's no session any more. No confirmation step. */
function AccountRow({ collapsed }: { collapsed: boolean }) {
  const session = useSession();
  const me = useMe(session?.access_token);
  const queryClient = useQueryClient();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = anchorEl !== null;

  if (!session) return null;

  const meta = session.user.user_metadata as { full_name?: string; name?: string } | undefined;
  const fullName = me.data?.displayName ?? meta?.full_name ?? meta?.name ?? session.user.email ?? '';
  const initials = initialsFor(fullName) || '?';

  async function handleSignOut() {
    setAnchorEl(null);
    await signOut();
    queryClient.clear();
    window.location.assign('/');
  }

  return (
    <Box
      sx={{
        mt: 'auto',
        borderTop: `1px solid ${BORDER}`,
        p: collapsed ? '16px 0' : '24px',
        display: 'flex',
        justifyContent: collapsed ? 'center' : 'flex-start',
      }}
    >
      <ButtonBase
        onClick={(e) => setAnchorEl(e.currentTarget)}
        aria-label={collapsed ? fullName : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? 'account-menu' : undefined}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          borderRadius: '8px',
          textAlign: 'left',
          '&.Mui-focusVisible': { outline: `2px solid ${INDIGO}`, outlineOffset: 2 },
        }}
      >
        <Avatar
          sx={{
            width: 32,
            height: 32,
            bgcolor: colorForId(session.user.id),
            fontFamily: 'Inter, Roboto, system-ui, sans-serif',
            fontSize: 12,
            fontWeight: 600,
            color: 'white',
          }}
        >
          {initials}
        </Avatar>
        {!collapsed && (
          <Typography
            component="span"
            sx={{ fontSize: 14, fontWeight: 500, color: INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}
          >
            {fullName}
          </Typography>
        )}
      </ButtonBase>
      <Menu
        id="account-menu"
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{
          paper: { sx: { mt: -1, minWidth: 160, border: `1px solid ${BORDER}`, boxShadow: '0 4px 12px rgba(15, 23, 42, 0.08)' } },
        }}
      >
        <MenuItem onClick={() => void handleSignOut()} sx={{ fontSize: 14, color: INK }}>
          Sign out
        </MenuItem>
      </Menu>
    </Box>
  );
}

/** The drawer content every page shares (Figma "Navigation", 131:1214) — AppShell owns the
 * collapsible chrome (wordmark, toggle button, width) around whatever `drawer` render-prop a
 * page passes in. `teamId` is optional (RN-062): a user with no team still gets the drawer, with
 * Home and the account row only, so they can always reach "Sign out". Nothing here fetches the
 * team — the one thing every caller already knows. */
export function NavDrawerContent({ teamId, collapsed }: { teamId?: string; collapsed: boolean }) {
  const path = window.location.pathname;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
      <Box component="nav" aria-label="Main" sx={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <DrawerNavItem
          icon={{ slate: '/icons/house-slate.svg', indigo: '/icons/house-indigo.svg' }}
          label="Home"
          href="/"
          active={path === '/'}
          collapsed={collapsed}
        />
        {teamId && (
          <>
            <DrawerNavItem
              icon={{ slate: '/icons/panels-top-left-slate.svg', indigo: '/icons/panels-top-left-indigo.svg' }}
              label="Retros"
              href={`/teams/${teamId}/retros`}
              active={path === `/teams/${teamId}/retros`}
              collapsed={collapsed}
            />
            <DrawerNavItem
              icon={{ slate: '/icons/list-checks-slate.svg', indigo: '/icons/list-checks-indigo.svg' }}
              label="Action Items"
              href={`/teams/${teamId}/actions`}
              active={path === `/teams/${teamId}/actions`}
              collapsed={collapsed}
            />
          </>
        )}
      </Box>
      <AccountRow collapsed={collapsed} />
    </Box>
  );
}
