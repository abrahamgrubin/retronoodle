import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RetroListItem, RetroPhase } from '@retronoodle/shared';
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Link,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import { AppShell } from './AppShell';
import { NavDrawerContent } from './NavDrawer';
import { deleteRetro, fetchTeamRetros } from './retros';
import { fetchMyTeams } from './teams';
import { useSession } from './useSession';

// RN-010's own header pill copy — reused here rather than inventing a second label set.
function phaseLabel(phase: RetroPhase): string {
  return phase.replace('_', ' ');
}

const PHASE_COLOR: Record<RetroPhase, 'default' | 'info' | 'warning' | 'success'> = {
  setup: 'default',
  review: 'info',
  write: 'info',
  group: 'info',
  vote: 'info',
  discuss: 'info',
  wrap_up: 'warning',
  closed: 'success',
};

/** RN-026: `/teams/:id/retros` — "retro list ... links to it [a closed retro's recap]." A plain
 * TanStack-Query list page, the same category as RN-024's Action items page: no phase, no seq,
 * nothing live to subscribe to. Every retro (any phase) links to `/retros/:id`, which already
 * renders correctly whatever phase it's in — a closed one renders read-only (BoardPage.tsx). */
export function RetroListPage({ teamId }: { teamId: string }) {
  const session = useSession();
  const accessToken = session?.access_token;

  const queryClient = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState<RetroListItem | null>(null);

  const retros = useQuery({
    queryKey: ['teamRetros', teamId, accessToken],
    queryFn: () => fetchTeamRetros(accessToken as string, teamId),
    enabled: !!accessToken,
  });

  // Same key the home page uses, so this is usually already cached rather than a second fetch.
  const teams = useQuery({
    queryKey: ['myTeams', accessToken],
    queryFn: () => fetchMyTeams(accessToken as string),
    enabled: !!accessToken,
  });
  const teamRole = teams.data?.find((t) => t.id === teamId)?.role ?? null;
  const userId = session?.user.id;

  const remove = useMutation({
    mutationFn: (retroId: string) => deleteRetro(accessToken as string, retroId),
    onSuccess: () => {
      setPendingDelete(null);
      void queryClient.invalidateQueries({ queryKey: ['teamRetros', teamId, accessToken] });
    },
  });

  // The drawer (left-side, every page) covers this same Retros/Action items navigation now —
  // nothing left for a page-specific `nav` to add.
  const drawer = (collapsed: boolean) => <NavDrawerContent teamId={teamId} collapsed={collapsed} />;

  if (!accessToken) {
    return (
      <AppShell drawer={drawer}>
        <Typography>Sign in to see this team's retros.</Typography>
      </AppShell>
    );
  }

  if (retros.isPending) {
    return (
      <AppShell drawer={drawer}>
        <Typography variant="h4" gutterBottom>
          Retros
        </Typography>
        <Stack spacing={1}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} variant="rounded" height={32} />
          ))}
        </Stack>
      </AppShell>
    );
  }

  if (retros.isError) {
    return (
      <AppShell drawer={drawer}>
        <Typography variant="h4" gutterBottom>
          Retros
        </Typography>
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => void retros.refetch()}>
              Retry
            </Button>
          }
        >
          Failed to load retros.
        </Alert>
      </AppShell>
    );
  }

  return (
    <AppShell drawer={drawer}>
      <Typography variant="h4" gutterBottom>
        Retros
      </Typography>
      {retros.data.length === 0 && <Typography>No retros yet.</Typography>}
      {retros.data.length > 0 && (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Created</TableCell>
              <TableCell>Closed</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {retros.data.map((retro) => (
              <TableRow key={retro.id} hover>
                <TableCell>
                  <Link href={`/retros/${retro.id}`}>{retro.name}</Link>
                </TableCell>
                <TableCell>
                  <Chip size="small" label={phaseLabel(retro.phase)} color={PHASE_COLOR[retro.phase]} />
                </TableCell>
                <TableCell>{new Date(retro.createdAt).toLocaleDateString()}</TableCell>
                <TableCell>{retro.closedAt ? new Date(retro.closedAt).toLocaleDateString() : '—'}</TableCell>
                <TableCell align="right" sx={{ width: 48 }}>
                  {/* Same rule the route enforces (`retro.delete`): the facilitator, or an admin
                      of this team. Shown per row rather than asked per row — the list already
                      carries each retro's facilitator, and the caller's own role comes from the
                      teams query the home page has usually warmed already. */}
                  {(retro.facilitatorId === userId || teamRole === 'admin') && (
                    <IconButton
                      size="small"
                      aria-label={`Delete ${retro.name}`}
                      disabled={remove.isPending}
                      onClick={() => setPendingDelete(retro)}
                    >
                      <DeleteOutlinedIcon fontSize="small" />
                    </IconButton>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Deleting is reversible in the database (retros.deleted_at) but not from the UI, so it
          asks first and names the retro — a misread row in a list of similar sprint names is
          the likely mistake here. */}
      <Dialog open={!!pendingDelete} onClose={() => !remove.isPending && setPendingDelete(null)}>
        <DialogTitle>Delete {pendingDelete?.name}?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            It disappears from this list and its board stops opening, for everyone on the team. Action items created in this
            retro are kept.
          </Typography>
          {remove.isError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              Failed to delete the retro.
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button type="button" disabled={remove.isPending} onClick={() => setPendingDelete(null)}>
            Cancel
          </Button>
          <Button
            type="button"
            color="error"
            variant="contained"
            disabled={remove.isPending}
            onClick={() => pendingDelete && remove.mutate(pendingDelete.id)}
          >
            {remove.isPending ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </AppShell>
  );
}
