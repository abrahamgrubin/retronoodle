import { AppBar, Box, Container, Toolbar, Typography } from '@mui/material';
import type { ReactNode } from 'react';

/** Shared top bar + content container for every page except BoardPage (which owns its own full
 * layout). `nav` is each page's own set of links (e.g. "Retros · Action items") — kept as a prop
 * rather than hard-coded here since which links make sense depends on which page you're on. */
export function AppShell({ nav, children }: { nav?: ReactNode; children: ReactNode }) {
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="static" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Toolbar sx={{ gap: 2 }}>
          <Typography
            variant="h6"
            component="a"
            href="/"
            sx={{ textDecoration: 'none', color: 'primary.main', fontWeight: 700 }}
          >
            RetroNoodle
          </Typography>
          <Box sx={{ flexGrow: 1 }} />
          {nav}
        </Toolbar>
      </AppBar>
      <Container maxWidth="md" sx={{ py: 4 }}>
        {children}
      </Container>
    </Box>
  );
}
