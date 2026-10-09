import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ActionItemStatus, TeamActionItem } from '@retronoodle/shared';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Collapse,
  FormControlLabel,
  Link,
  MenuItem,
  Select,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { AppShell } from './AppShell';
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
function StatusHistoryRow({ teamId, itemId, accessToken, open }: { teamId: string; itemId: string; accessToken: string; open: boolean }) {
  const history = useQuery({
    queryKey: ['actionItemHistory', teamId, itemId],
    queryFn: () => fetchActionItemHistory(accessToken, teamId, itemId),
    enabled: open,
  });

  return (
    <TableRow>
      <TableCell colSpan={6} sx={{ p: 0, borderBottom: open ? undefined : 'none' }}>
        <Collapse in={open} unmountOnExit>
          <Box sx={{ bgcolor: 'grey.50', p: 2 }}>
            {history.isPending && (
              <Typography variant="caption" color="text.secondary">
                Loading history…
              </Typography>
            )}
            {history.isError && (
              <Typography variant="caption" color="error">
                Failed to load history.
              </Typography>
            )}
            {history.data && history.data.entries.length === 0 && (
              <Typography variant="caption" color="text.secondary">
                No status changes yet.
              </Typography>
            )}
            {history.data && history.data.entries.length > 0 && (
              <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2 }}>
                {history.data.entries.map((e) => (
                  <Typography component="li" variant="caption" key={e.id}>
                    {e.actorName ?? 'Someone'} changed {STATUS_LABEL[e.fromStatus]} → {STATUS_LABEL[e.toStatus]} on{' '}
                    {new Date(e.createdAt).toLocaleString()}
                  </Typography>
                ))}
              </Stack>
            )}
          </Box>
        </Collapse>
      </TableCell>
    </TableRow>
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
      <TableRow onClick={onToggleExpand} hover sx={{ cursor: 'pointer' }}>
        <TableCell>{item.title}</TableCell>
        <TableCell>{item.ownerName ?? 'Unassigned'}</TableCell>
        <TableCell sx={{ color: overdue ? 'error.main' : undefined }}>{item.dueDate ?? '—'}</TableCell>
        <TableCell onClick={(e) => e.stopPropagation()}>
          <Select
            size="small"
            variant="standard"
            aria-label={`Status for ${item.title}`}
            value={item.status}
            onChange={(e) => onStatusChange(e.target.value as ActionItemStatus)}
            sx={{
              color: STATUS_COLOR[item.status],
              textDecoration: item.status === 'dropped' ? 'line-through' : undefined,
            }}
          >
            {ALL_STATUSES.map((s) => (
              <MenuItem key={s} value={s}>
                {STATUS_LABEL[s]}
              </MenuItem>
            ))}
          </Select>
        </TableCell>
        <TableCell onClick={(e) => e.stopPropagation()}>
          <Link href={`/retros/${item.sourceRetroId}`}>{item.sourceRetroName}</Link>
        </TableCell>
        <TableCell>{new Date(item.updatedAt).toLocaleDateString()}</TableCell>
      </TableRow>
      <StatusHistoryRow teamId={teamId} itemId={item.id} accessToken={accessToken} open={expanded} />
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
    <Typography variant="body2">
      <Link href={`/teams/${teamId}/retros`}>Retros</Link> · <strong>Action items</strong>
    </Typography>
  );

  if (!accessToken) {
    return (
      <AppShell nav={nav}>
        <Typography>Sign in to see this team's action items.</Typography>
      </AppShell>
    );
  }

  if (actions.isPending || me.isPending) {
    return (
      <AppShell nav={nav}>
        <Typography variant="h4" gutterBottom>
          Action items
        </Typography>
        <Stack spacing={1}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} variant="rounded" height={32} />
          ))}
        </Stack>
      </AppShell>
    );
  }

  if (actions.isError || me.isError) {
    return (
      <AppShell nav={nav}>
        <Typography variant="h4" gutterBottom>
          Action items
        </Typography>
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => void actions.refetch()}>
              Retry
            </Button>
          }
        >
          Failed to load action items.
        </Alert>
      </AppShell>
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
    <AppShell nav={nav}>
      <Typography variant="h4" gutterBottom>
        Action items
      </Typography>
      <Stack direction="row" spacing={2} sx={{ alignItems: "center", flexWrap: "wrap", mb: 2 }}>
        <FormControlLabel
          control={<Checkbox checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />}
          label="Mine"
        />
        {ALL_STATUSES.map((s) => (
          <FormControlLabel
            key={s}
            control={<Checkbox checked={statusFilter.has(s)} onChange={() => toggleStatusFilter(s)} />}
            label={STATUS_LABEL[s]}
          />
        ))}
        <Select
          size="small"
          displayEmpty
          aria-label="Source retro"
          value={sourceRetroFilter}
          onChange={(e) => setSourceRetroFilter(e.target.value)}
        >
          <MenuItem value="">All retros</MenuItem>
          {sourceRetros.map(([id, name]) => (
            <MenuItem key={id} value={id}>
              {name}
            </MenuItem>
          ))}
        </Select>
      </Stack>

      {items.length === 0 && <Typography>No action items yet. They'll appear after your first retro.</Typography>}
      {items.length > 0 && sorted.length === 0 && (
        <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
          <Typography>No items match these filters.</Typography>
          <Button size="small" onClick={clearFilters}>
            Clear filters
          </Button>
        </Stack>
      )}
      {sorted.length > 0 && (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Title</TableCell>
              <TableCell>Owner</TableCell>
              <TableCell>Due</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Source retro</TableCell>
              <TableCell>Last updated</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
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
          </TableBody>
        </Table>
      )}
    </AppShell>
  );
}
