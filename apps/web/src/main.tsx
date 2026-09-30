import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { BoardPage } from './BoardPage';
import { JoinPage } from './JoinPage';

const queryClient = new QueryClient();
const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

// No router yet — two path patterns don't need one (RN-006, RN-009).
const joinMatch = /^\/join\/([^/]+)$/.exec(window.location.pathname);
const retroMatch = /^\/retros\/([^/]+)$/.exec(window.location.pathname);

function page() {
  if (joinMatch) return <JoinPage code={joinMatch[1]!} />;
  if (retroMatch) return <BoardPage retroId={retroMatch[1]!} />;
  return <App />;
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>{page()}</QueryClientProvider>
  </StrictMode>,
);
