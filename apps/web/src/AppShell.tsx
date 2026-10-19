import { Box, Container, Divider, Drawer } from '@mui/material';
import { useState, type ReactNode } from 'react';

/** Figma "Drawer · permanent" / "Drawer · mini variant" (node 31:915 / 31:975) — 240px expanded,
 * 64px collapsed to icon-only, toggled by the chevron button this component owns. */
const DRAWER_WIDTH_EXPANDED = 240;
const DRAWER_WIDTH_COLLAPSED = 64;

/** Shared content container for every page. `nav` is each page's own set of links — kept as a
 * prop rather than hard-coded here since which links make sense depends on which page you're on.
 *
 * `drawer`, when given, renders the Figma-specified collapsible permanent drawer on the left —
 * a render-prop (not a plain node) because the nav items it wraps need to know the collapse
 * state too (icon-only vs. icon+label). AppShell owns the collapse toggle itself (the chevron
 * button + divider are generic drawer chrome, identical regardless of which page's links go
 * inside) so any future page that wants one gets the same collapse behavior for free. Omitted
 * entirely on every page that doesn't pass one, so this changes nothing for them.
 *
 * `fullWidth` skips the `maxWidth="md"` Container (and its own padding) in favor of a plain
 * flex-growing Box — BoardPage's own layout is already full-bleed with its own padding, and
 * capping it at `md` would squeeze its multi-column board into the same width as a text page. */
export function AppShell({
  nav,
  drawer,
  fullWidth,
  rightPanel,
  children,
}: {
  nav?: ReactNode;
  drawer?: (collapsed: boolean) => ReactNode;
  fullWidth?: boolean;
  /** A full-height panel pinned to the right edge, opposite `drawer` — BoardPage's Suggestions
   * (Group) and Queue/Summaries (Discuss/Wrap up) panels. It belongs here rather than inside
   * `children` because only a direct child of the row below can start at the top of the page:
   * nested inside a page's own content it begins under that page's header and padding, and ends
   * wherever its content does (found live — the panel started ~150px down and stopped short). */
  rightPanel?: ReactNode;
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
                // `100%` of the row (so the nav's right border runs the full length of whatever
                // the page is), with the viewport as a floor so a short page still gets a border
                // all the way down. This was `1000%` — ten times the row — which made the paper
                // ~9,700px tall on a board page and dragged the whole document to match, leaving
                // thousands of pixels of empty scroll below the content (found live).
                height: '100%',
                minHeight: '100vh',
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
        {fullWidth ? (
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            {nav}
            {children}
          </Box>
        ) : (
          <Container maxWidth="md" sx={{ py: 4, flexGrow: 1 }}>
            {nav}
            {children}
          </Container>
        )}
        {rightPanel && (
          <Box
            sx={{
              flexShrink: 0,
              display: 'flex',
              // Without this the default `stretch` pins the panel to exactly this container's
              // height, so content taller than the viewport scrolls out beyond the panel's own
              // background and left border and paints over the board (found live). Sizing it to
              // its content instead, with the `minHeight` below as the floor, keeps the panel's
              // surface under its content at every scroll position.
              alignItems: 'flex-start',
              // Sticky rather than stretched: the panel stays pinned to the viewport while a
              // tall board scrolls past it, instead of scrolling away and leaving a gap.
              // `alignSelf` keeps the flex row from stretching it, which sticky can't survive.
              position: 'sticky',
              top: 0,
              alignSelf: 'flex-start',
              height: '100vh',
              overflowY: 'auto',
              // The panel owns its own width, border and background — this only guarantees it
              // covers the full viewport when its content is short, and keeps covering it when
              // the content is long enough to scroll this container.
              '& > *': { minHeight: '100%' },
            }}
          >
            {rightPanel}
          </Box>
        )}
      </Box>
    </Box>
  );
}
