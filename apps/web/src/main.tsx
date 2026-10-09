import '@fontsource/roboto/300.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ActionsPage } from './ActionsPage';
import { App } from './App';
import { BoardPage } from './BoardPage';
import { JoinPage } from './JoinPage';
import { RetroListPage } from './RetroListPage';
import { theme } from './theme';

const queryClient = new QueryClient();
const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

// No router yet — a handful of path patterns don't need one (RN-006, RN-009, RN-024).
const joinMatch = /^\/join\/([^/]+)$/.exec(window.location.pathname);
const retroMatch = /^\/retros\/([^/]+)$/.exec(window.location.pathname);
const teamActionsMatch = /^\/teams\/([^/]+)\/actions$/.exec(window.location.pathname);
const teamRetrosMatch = /^\/teams\/([^/]+)\/retros$/.exec(window.location.pathname);

function page() {
  if (joinMatch) return <JoinPage code={joinMatch[1]!} />;
  if (retroMatch) return <BoardPage retroId={retroMatch[1]!} />;
  if (teamActionsMatch) return <ActionsPage teamId={teamActionsMatch[1]!} />;
  if (teamRetrosMatch) return <RetroListPage teamId={teamRetrosMatch[1]!} />;
  return <App />;
}

createRoot(root).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <QueryClientProvider client={queryClient}>{page()}</QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
