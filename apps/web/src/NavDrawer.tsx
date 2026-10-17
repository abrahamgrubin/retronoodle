import { Box, List, ListItemButton, ListItemText } from '@mui/material';

/** Figma's own "Navigation item" rows (node 31:921/31:924/31:927, both the expanded and
 * mini-variant states) — icon + label when expanded, icon-only once collapsed. `href` is
 * optional: "Your Team" has no page to link to yet, so it renders as an inert row rather than a
 * link to nowhere. */
export function DrawerNavItem({ icon, label, href, collapsed }: { icon: string; label: string; href?: string; collapsed: boolean }) {
  const content = (
    <>
      <Box component="img" src={icon} alt="" sx={{ width: 24, height: 24, flexShrink: 0 }} />
      {!collapsed && <ListItemText primary={label} slotProps={{ primary: { sx: { color: '#252525', fontSize: 16 } } }} />}
    </>
  );
  const sx = { height: 48, px: '20px', gap: collapsed ? 0 : '20px', justifyContent: collapsed ? 'center' : 'flex-start' } as const;
  return href ? (
    <ListItemButton component="a" href={href} sx={sx}>
      {content}
    </ListItemButton>
  ) : (
    <Box sx={{ display: 'flex', alignItems: 'center', ...sx }}>{content}</Box>
  );
}

/** The drawer content every page shares (Figma node 37:1371) — AppShell owns the collapsible
 * chrome (toggle button, divider, width) around whatever `drawer` render-prop a page passes in.
 * `teamId` is the one thing every caller needs to already know — nothing here fetches it. */
export function NavDrawerContent({ teamId, collapsed }: { teamId: string; collapsed: boolean }) {
  return (
    <List sx={{ py: '8px' }}>
      <DrawerNavItem icon="/icons/house.svg" label="Home" href="/" collapsed={collapsed} />
      <DrawerNavItem icon="/icons/panels-top-left.svg" label="Retros" href={`/teams/${teamId}/retros`} collapsed={collapsed} />
      <DrawerNavItem icon="/icons/list-checks.svg" label="Action Items" href={`/teams/${teamId}/actions`} collapsed={collapsed} />
      <DrawerNavItem icon="/icons/users.svg" label="Your Team" collapsed={collapsed} />
    </List>
  );
}
