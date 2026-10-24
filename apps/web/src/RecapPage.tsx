import { useQuery } from '@tanstack/react-query';
import { Alert, Box, Chip, Divider, Stack, Typography } from '@mui/material';
import { AppShell } from './AppShell';
import { NavDrawerContent } from './NavDrawer';
import { fetchRecap } from './recap';
import { useSession } from './useSession';

const STATUS_LABEL: Record<string, string> = { open: 'Open', in_progress: 'In progress', done: 'Done', dropped: 'Dropped' };

/**
 * /r/:retroId/recap (RN-045): what the team ended Wrap up with — topic summaries, action items,
 * topics not discussed, attendance and additional notes. Read-only — everything here is edited
 * during Wrap up. Nothing is generated at close, so the page is ready as soon as the retro is.
 */
export function RecapPage({ retroId }: { retroId: string }) {
  const session = useSession();
  const accessToken = session?.access_token;

  const recap = useQuery({
    queryKey: ['recap', retroId, accessToken],
    queryFn: () => fetchRecap(accessToken as string, retroId),
    enabled: !!accessToken,
  });

  if (!accessToken) {
    return (
      <AppShell>
        <Typography>Sign in to see this retro's recap.</Typography>
      </AppShell>
    );
  }

  if (recap.isPending) {
    return (
      <AppShell>
        <Typography sx={{ p: 4 }}>Loading recap…</Typography>
      </AppShell>
    );
  }

  if (recap.isError) {
    return (
      <AppShell>
        <Alert severity="error" sx={{ m: 4 }}>
          Failed to load the recap.
        </Alert>
      </AppShell>
    );
  }

  const data = recap.data;

  return (
    <AppShell drawer={(collapsed) => <NavDrawerContent teamId={data.teamId} collapsed={collapsed} />}>
      <Typography variant="h4" gutterBottom>
        {data.retroName} · Recap
      </Typography>

      <Stack spacing={3} sx={{ mt: 2 }}>
        <Box>
          <Typography variant="h6" gutterBottom>
            Topic summaries
          </Typography>
          {data.recap.topicSummaries.length === 0 ? (
            <Typography color="text.secondary">Nothing was discussed.</Typography>
          ) : (
            <Stack spacing={1.5}>
              {data.recap.topicSummaries.map((t) => (
                <Box key={t.topicId}>
                  <Typography variant="subtitle2">{t.topicName}</Typography>
                  {t.summary ? (
                    <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                      {t.summary}
                    </Typography>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      Not summarized.
                    </Typography>
                  )}
                </Box>
              ))}
            </Stack>
          )}
        </Box>

        <Divider />

        <Box>
          <Typography variant="h6" gutterBottom>
            Action items
          </Typography>
          {data.recap.actionItems.length === 0 ? (
            <Typography color="text.secondary">No action items.</Typography>
          ) : (
            <Stack spacing={1}>
              {data.recap.actionItems.map((a) => (
                <Stack key={a.id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Typography variant="body2" sx={{ flexGrow: 1 }}>
                    {a.title}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {a.ownerName ?? 'Unassigned'}
                  </Typography>
                  <Chip size="small" label={STATUS_LABEL[a.status] ?? a.status} />
                </Stack>
              ))}
            </Stack>
          )}
        </Box>

        <Divider />

        <Box>
          <Typography variant="h6" gutterBottom>
            Not discussed
          </Typography>
          {data.recap.undiscussedTopics.length === 0 ? (
            <Typography color="text.secondary">Every topic was discussed.</Typography>
          ) : (
            <Typography variant="body2">{data.recap.undiscussedTopics.map((t) => t.topicName).join(', ')}</Typography>
          )}
        </Box>

        <Divider />

        <Box>
          <Typography variant="h6" gutterBottom>
            Attendance
          </Typography>
          <Typography variant="body2">
            {data.recap.attendance.length > 0
              ? data.recap.attendance.map((a) => (a.isFacilitator ? `${a.displayName} (facilitator)` : a.displayName)).join(', ')
              : 'No attendance recorded.'}
          </Typography>
        </Box>

        <Divider />

        <Box>
          <Typography variant="h6" gutterBottom>
            Additional notes
          </Typography>
          {data.additionalNotes ? (
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {data.additionalNotes}
            </Typography>
          ) : (
            <Typography color="text.secondary">No additional notes.</Typography>
          )}
        </Box>
      </Stack>
    </AppShell>
  );
}
