import { Box, Container, Divider, Drawer } from '@mui/material';
import { useState, type ReactNode } from 'react';

/** Figma "Drawer · permanent" / "Drawer · mini variant" (node 31:915 / 31:975) — 240px expanded,
 * 64px collapsed to icon-only, toggled by the chevron button this component owns. */
const DRAWER_WIDTH_EXPANDED = 240;
const DRAWER_WIDTH_COLLAPSED = 64;

/** Shared content container for every page except BoardPage (which owns its own full layout).
 * `nav` is each page's own set of links — kept as a prop rather than hard-coded here since which
 * links make sense depends on which page you're on.
 *
 * `drawer`, when given, renders the Figma-specified collapsible permanent drawer on the left —
 * a render-prop (not a plain node) because the nav items it wraps need to know the collapse
 * state too (icon-only vs. icon+label). AppShell owns the collapse toggle itself (the chevron
 * button + divider are generic drawer chrome, identical regardless of which page's links go
 * inside) so any future page that wants one gets the same collapse behavior for free. Omitted
 * entirely on every page that doesn't pass one, so this changes nothing for them. */
export function AppShell({
  nav,
  drawer,
  children,
}: {
  nav?: ReactNode;
  drawer?: (collapsed: boolean) => ReactNode;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const drawerWidth = collapsed ? DRAWER_WIDTH_COLLAPSED : DRAWER_WIDTH_EXPANDED;

  return (
    <Box sx={{ minHeight: '100%', bgcolor: 'background.default' }}>
      <Box sx={{ display: 'flex' }}>
        {drawer && (
          <Drawer
            variant="permanent"
            anchor="left"
            sx={{
              width: drawerWidth,
              flexShrink: 0,
              transition: (theme) => theme.transitions.create('width'),
              '& .MuiDrawer-paper': {
                width: drawerWidth,
                boxSizing: 'border-box',
                position: 'relative',
                height: '1000%',
                borderRight: '1px solid #e0e0e0',
                transition: (theme) => theme.transitions.create('width'),
              },
            }}
          >
            {/* "Collapse drawer" / "Expand drawer" row (Figma: 64px tall, 20px padding; the
                chevron sits flush right while expanded, flush left once collapsed — there's no
                room to keep it right-aligned at 64px wide without it butting against the icons
                below). */}
            <Box
              component="button"
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              aria-label={collapsed ? 'Expand drawer' : 'Collapse drawer'}
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: collapsed ? 'flex-start' : 'flex-end',
                height: 64,
                px: '20px',
                width: '100%',
                border: 0,
                bgcolor: 'transparent',
                cursor: 'pointer',
                font: 'inherit',
              }}
            >
              <Box
                component="img"
                src={collapsed ? '/icons/chevrons-right.svg' : '/icons/chevrons-left.svg'}
                alt=""
                sx={{ width: 24, height: 24 }}
              />
            </Box>
            <Divider sx={{ borderColor: '#e0e0e0' }} />
            {drawer(collapsed)}
          </Drawer>
        )}
        <Container maxWidth="md" sx={{ py: 4, flexGrow: 1 }}>
          {nav}
          {children}
        </Container>
      </Box>
    </Box>
  );
}
