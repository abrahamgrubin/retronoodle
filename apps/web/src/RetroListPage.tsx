import { useQuery } from '@tanstack/react-query';
import type { RetroPhase } from '@retronoodle/shared';
import {
  Alert,
  Button,
  Chip,
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
import { AppShell } from './AppShell';
import { fetchTeamRetros } from './retros';
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

  const retros = useQuery({
    queryKey: ['teamRetros', teamId, accessToken],
    queryFn: () => fetchTeamRetros(accessToken as string, teamId),
    enabled: !!accessToken,
  });

  const nav = (
    <Typography variant="body2">
      <strong>Retros</strong> · <Link href={`/teams/${teamId}/actions`}>Action items</Link>
    </Typography>
  );

  if (!accessToken) {
    return (
      <AppShell nav={nav}>
        <Typography>Sign in to see this team's retros.</Typography>
      </AppShell>
    );
  }

  if (retros.isPending) {
    return (
      <AppShell nav={nav}>
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
      <AppShell nav={nav}>
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
    <AppShell nav={nav}>
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
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </AppShell>
  );
}
