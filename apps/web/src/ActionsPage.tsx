import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ActionItemStatus, TeamActionItem } from '@retronoodle/shared';
import { fetchMe } from './auth';
import { fetchActionItemHistory, fetchTeamActions, postActionItemStatus } from './teamActions';
import { useSession } from './useSession';

const STATUS_LABEL: Record<ActionItemStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  done: 'Done',
  dropped: 'Dropped',
};

// Layout spec: "Open grey, In progress blue, Done green, Dropped grey with strikethrough."
const STATUS_COLOR: Record<ActionItemStatus, string> = {
  open: '#666',
  in_progress: '#2563eb',
  done: '#1a7f37',
  dropped: '#666',
};

const ALL_STATUSES: ActionItemStatus[] = ['open', 'in_progress', 'done', 'dropped'];

function isOverdue(item: TeamActionItem): boolean {
  if (!item.dueDate || item.status === 'done' || item.status === 'dropped') return false;
  return item.dueDate < new Date().toISOString().slice(0, 10);
}

/** Row expand (RN-024): "who changed what, when" — fetched lazily, only once a row is actually
 * expanded, rather than eagerly loading every item's history up front. */
function StatusHistoryRow({ teamId, itemId, accessToken }: { teamId: string; itemId: string; accessToken: string }) {
  const history = useQuery({
    queryKey: ['actionItemHistory', teamId, itemId],
    queryFn: () => fetchActionItemHistory(accessToken, teamId, itemId),
  });

  return (
    <tr>
      <td colSpan={6} style={{ background: '#fafafa', padding: 8 }}>
        {history.isPending && <p style={{ margin: 0, fontSize: 12, color: '#666' }}>Loading history…</p>}
        {history.isError && <p style={{ margin: 0, fontSize: 12, color: 'crimson' }}>Failed to load history.</p>}
        {history.data && history.data.entries.length === 0 && (
          <p style={{ margin: 0, fontSize: 12, color: '#666' }}>No status changes yet.</p>
        )}
        {history.data && history.data.entries.length > 0 && (
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12 }}>
            {history.data.entries.map((e) => (
              <li key={e.id}>
                {e.actorName ?? 'Someone'} changed {STATUS_LABEL[e.fromStatus]} → {STATUS_LABEL[e.toStatus]} on{' '}
                {new Date(e.createdAt).toLocaleString()}
              </li>
            ))}
          </ul>
        )}
      </td>
    </tr>
  );
}

function ActionItemTableRow({
  item,
  teamId,
  accessToken,
  expanded,
  onToggleExpand,
  onStatusChange,
}: {
  item: TeamActionItem;
  teamId: string;
  accessToken: string;
  expanded: boolean;
  onToggleExpand: () => void;
  onStatusChange: (status: ActionItemStatus) => void;
}) {
  const overdue = isOverdue(item);
  return (
    <>
      <tr onClick={onToggleExpand} style={{ cursor: 'pointer', borderBottom: '1px solid #eee' }}>
        <td style={{ padding: 8 }}>{item.title}</td>
        <td style={{ padding: 8 }}>{item.ownerName ?? 'Unassigned'}</td>
        <td style={{ padding: 8, color: overdue ? 'crimson' : undefined }}>{item.dueDate ?? '—'}</td>
        <td style={{ padding: 8 }} onClick={(e) => e.stopPropagation()}>
          <select
            aria-label={`Status for ${item.title}`}
            value={item.status}
            onChange={(e) => onStatusChange(e.target.value as ActionItemStatus)}
            style={{ color: STATUS_COLOR[item.status], textDecoration: item.status === 'dropped' ? 'line-through' : undefined }}
          >
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </td>
        <td style={{ padding: 8 }}>
          <a href={`/retros/${item.sourceRetroId}`} onClick={(e) => e.stopPropagation()}>
            {item.sourceRetroName}
          </a>
        </td>
        <td style={{ padding: 8 }}>{new Date(item.updatedAt).toLocaleDateString()}</td>
      </tr>
      {expanded && <StatusHistoryRow teamId={teamId} itemId={item.id} accessToken={accessToken} />}
    </>
  );
}

/** RN-024: `/teams/:id/actions` — a TanStack-Query page (ordinary fetch + refetch-on-mutation),
 * not the live Zustand board: there's no phase, no seq, no Realtime channel here, just a plain
 * team-scoped list that happens to update when someone changes a status (including this viewer,
 * via query invalidation, not an optimistic guess — status changes are infrequent enough that the
 * round trip isn't worth guessing ahead of). */
export function ActionsPage({ teamId }: { teamId: string }) {
  const session = useSession();
  const accessToken = session?.access_token;
  const queryClient = useQueryClient();

  const me = useQuery({ queryKey: ['me', accessToken], queryFn: () => fetchMe(accessToken as string), enabled: !!accessToken });
  const actions = useQuery({
    queryKey: ['teamActions', teamId, accessToken],
    queryFn: () => fetchTeamActions(accessToken as string, teamId),
    enabled: !!accessToken,
  });

  const [mineOnly, setMineOnly] = useState(false);
  const [statusFilter, setStatusFilter] = useState<Set<ActionItemStatus>>(new Set());
  const [sourceRetroFilter, setSourceRetroFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const statusChange = useMutation({
    mutationFn: ({ itemId, status }: { itemId: string; status: ActionItemStatus }) =>
      postActionItemStatus(accessToken as string, teamId, itemId, status),
    onSuccess: (_result, { itemId }) => {
      void queryClient.invalidateQueries({ queryKey: ['teamActions', teamId, accessToken] });
      void queryClient.invalidateQueries({ queryKey: ['actionItemHistory', teamId, itemId] });
    },
  });

  function toggleStatusFilter(status: ActionItemStatus) {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }

  function clearFilters() {
    setMineOnly(false);
    setStatusFilter(new Set());
    setSourceRetroFilter('');
  }

  const nav = (
    <p>
      <a href="/">Retros</a> · <strong>Action items</strong>
    </p>
  );

  if (!accessToken) {
    return (
      <main style={{ fontFamily: 'system-ui, sans-serif', padding: 32 }}>
        {nav}
        <p>Sign in to see this team's action items.</p>
      </main>
    );
  }

  if (actions.isPending || me.isPending) {
    return (
      <main style={{ fontFamily: 'system-ui, sans-serif', padding: 32 }}>
        {nav}
        <h1>Action items</h1>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ height: 20, background: '#f0f0f0', borderRadius: 4, marginBottom: 8 }} />
        ))}
      </main>
    );
  }

  if (actions.isError || me.isError) {
    return (
      <main style={{ fontFamily: 'system-ui, sans-serif', padding: 32 }}>
        {nav}
        <h1>Action items</h1>
        <p role="alert" style={{ color: 'crimson' }}>
          Failed to load action items.
        </p>
        <button type="button" onClick={() => void actions.refetch()}>
          Retry
        </button>
      </main>
    );
  }

  const items = actions.data.items;
  const sourceRetros = [...new Map(items.map((i) => [i.sourceRetroId, i.sourceRetroName])).entries()];

  const filtered = items.filter((i) => {
    if (mineOnly && i.ownerId !== me.data.id) return false;
    if (statusFilter.size > 0 && !statusFilter.has(i.status)) return false;
    if (sourceRetroFilter && i.sourceRetroId !== sourceRetroFilter) return false;
    return true;
  });

  // Layout spec: "Sorted by due date ascending, with Done and Dropped at the bottom."
  const sorted = [...filtered].sort((a, b) => {
    const aSettled = a.status === 'done' || a.status === 'dropped';
    const bSettled = b.status === 'done' || b.status === 'dropped';
    if (aSettled !== bSettled) return aSettled ? 1 : -1;
    return (a.dueDate ?? '9999-99-99').localeCompare(b.dueDate ?? '9999-99-99');
  });

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 32 }}>
      {nav}
      <h1>Action items</h1>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <label>
          <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} /> Mine
        </label>
        {ALL_STATUSES.map((s) => (
          <label key={s}>
            <input type="checkbox" checked={statusFilter.has(s)} onChange={() => toggleStatusFilter(s)} /> {STATUS_LABEL[s]}
          </label>
        ))}
        <select aria-label="Source retro" value={sourceRetroFilter} onChange={(e) => setSourceRetroFilter(e.target.value)}>
          <option value="">All retros</option>
          {sourceRetros.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </div>

      {items.length === 0 && <p>No action items yet. They'll appear after your first retro.</p>}
      {items.length > 0 && sorted.length === 0 && (
        <p>
          No items match these filters.{' '}
          <button type="button" onClick={clearFilters}>
            Clear filters
          </button>
        </p>
      )}
      {sorted.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #ddd' }}>
              <th style={{ padding: 8 }}>Title</th>
              <th style={{ padding: 8 }}>Owner</th>
              <th style={{ padding: 8 }}>Due</th>
              <th style={{ padding: 8 }}>Status</th>
              <th style={{ padding: 8 }}>Source retro</th>
              <th style={{ padding: 8 }}>Last updated</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((item) => (
              <ActionItemTableRow
                key={item.id}
                item={item}
                teamId={teamId}
                accessToken={accessToken}
                expanded={expandedId === item.id}
                onToggleExpand={() => setExpandedId((prev) => (prev === item.id ? null : item.id))}
                onStatusChange={(status) => statusChange.mutate({ itemId: item.id, status })}
              />
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
