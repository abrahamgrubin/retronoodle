import { useQuery } from '@tanstack/react-query';
import { fetchHealth } from './api';

export function App() {
  const health = useQuery({ queryKey: ['health'], queryFn: () => fetchHealth() });

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 32 }}>
      <h1>RetroNoodle</h1>
      <p>
        API:{' '}
        {health.isPending ? 'checking…' : health.isError ? 'unreachable' : `ok at ${health.data.time}`}
      </p>
    </main>
  );
}
