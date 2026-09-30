import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { JoinPage } from './JoinPage';

const queryClient = new QueryClient();
const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

// No router yet — one path pattern doesn't need one (RN-006). RN-009's board will likely bring
// real routing; this can be replaced wholesale then.
const joinMatch = /^\/join\/([^/]+)$/.exec(window.location.pathname);

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>{joinMatch ? <JoinPage code={joinMatch[1]!} /> : <App />}</QueryClientProvider>
  </StrictMode>,
);
