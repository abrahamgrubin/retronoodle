import { useQuery } from '@tanstack/react-query';
import type { RetroPhase } from '@retronoodle/shared';
import { fetchTeamRetros } from './retros';
import { useSession } from './useSession';

// RN-010's own header pill copy — reused here rather than inventing a second label set.
function phaseLabel(phase: RetroPhase): string {
  return phase.replace('_', ' ');
}

/** RN-026: `/teams/:id/retros` — "retro list ... links to it [a closed retro's recap]." A plain
 * TanStack-Query list page, the same category as RN-024's Action items page: no phase, no seq,
 * nothing live to subscribe to. Every retro (any phase) links to `/retros/:id`, which already
 * renders correctly whatever phase it's in — a closed one renders read-only (BoardPage.tsx). */
export function RetroListPage({ teamId }: { teamId: string }) {
  const session = useSession();
  const accessToken = session?.access_token;

  const retros = useQuery({
    queryKey: ['teamRetros', teamId, accessToken],
    queryFn: () => fetchTeamRetros(accessToken as string, teamId),
    enabled: !!accessToken,
  });

  const nav = (
    <p>
      <strong>Retros</strong> · <a href={`/teams/${teamId}/actions`}>Action items</a>
    </p>
  );

  if (!accessToken) {
    return (
      <main style={{ fontFamily: 'system-ui, sans-serif', padding: 32 }}>
        {nav}
        <p>Sign in to see this team's retros.</p>
      </main>
    );
  }

  if (retros.isPending) {
    return (
      <main style={{ fontFamily: 'system-ui, sans-serif', padding: 32 }}>
        {nav}
        <h1>Retros</h1>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ height: 20, background: '#f0f0f0', borderRadius: 4, marginBottom: 8 }} />
        ))}
      </main>
    );
  }

  if (retros.isError) {
    return (
      <main style={{ fontFamily: 'system-ui, sans-serif', padding: 32 }}>
        {nav}
        <h1>Retros</h1>
        <p role="alert" style={{ color: 'crimson' }}>
          Failed to load retros.
        </p>
        <button type="button" onClick={() => void retros.refetch()}>
          Retry
        </button>
      </main>
    );
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 32 }}>
      {nav}
      <h1>Retros</h1>
      {retros.data.length === 0 && <p>No retros yet.</p>}
      {retros.data.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #ddd' }}>
              <th style={{ padding: 8 }}>Name</th>
              <th style={{ padding: 8 }}>Status</th>
              <th style={{ padding: 8 }}>Created</th>
              <th style={{ padding: 8 }}>Closed</th>
            </tr>
          </thead>
          <tbody>
            {retros.data.map((retro) => (
              <tr key={retro.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: 8 }}>
                  <a href={`/retros/${retro.id}`}>{retro.name}</a>
                </td>
                <td style={{ padding: 8 }}>{phaseLabel(retro.phase)}</td>
                <td style={{ padding: 8 }}>{new Date(retro.createdAt).toLocaleDateString()}</td>
                <td style={{ padding: 8 }}>{retro.closedAt ? new Date(retro.closedAt).toLocaleDateString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
