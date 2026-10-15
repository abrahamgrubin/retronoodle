import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { uuidv7 } from 'uuidv7';
import { Alert, Box, Button, Chip, CircularProgress, Divider, Stack, Typography } from '@mui/material';
import { AppShell } from './AppShell';
import { postMutation } from './mutations';
import { fetchRecap } from './recap';
import { useSession } from './useSession';

const STATUS_LABEL: Record<string, string> = { open: 'Open', in_progress: 'In progress', done: 'Done', dropped: 'Dropped' };

/**
 * /r/:retroId/recap (RN-045): "built from the DB" for everything except `topicSummaries`/
 * `decisions`, the recap agent team's own stored output (ai.generateRecap, enqueued at close).
 * Polls every 3s while `status` is `pending` — generation is a handful of sequential Claude
 * calls (one per discussed topic, plus one for the whole meeting), typically done well within a
 * minute, but there's no Realtime wiring for this page (it's normally visited once, right after
 * close — see generateRecap.ts's own comment on why polling was simpler here than a new channel).
 */
export function RecapPage({ retroId }: { retroId: string }) {
  const session = useSession();
  const accessToken = session?.access_token;
  const queryClient = useQueryClient();

  const recap = useQuery({
    queryKey: ['recap', retroId, accessToken],
    queryFn: () => fetchRecap(accessToken as string, retroId),
    enabled: !!accessToken,
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 3000 : false),
  });

  const retry = useMutation({
    mutationFn: () =>
      postMutation(accessToken as string, retroId, { mutationId: uuidv7(), type: 'recap.regenerate', payload: {} }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['recap', retroId, accessToken] }),
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
    <AppShell>
      <Typography variant="h4" gutterBottom>
        {data.retroName} · Recap
      </Typography>

      {data.status === 'pending' && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 2 }}>
          <CircularProgress size={20} />
          <Typography color="text.secondary">Generating recap…</Typography>
        </Stack>
      )}

      {data.status === 'unavailable' && (
        <Box sx={{ mt: 2 }}>
          <Alert severity="warning">Recap unavailable.</Alert>
          {data.isFacilitator && (
            <Button sx={{ mt: 1 }} type="button" variant="outlined" disabled={retry.isPending} onClick={() => retry.mutate()}>
              {retry.isPending ? 'Retrying…' : 'Retry'}
            </Button>
          )}
        </Box>
      )}

      {data.status === 'ready' && data.recap && (
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
                    <Typography variant="body2">{t.summary}</Typography>
                  </Box>
                ))}
              </Stack>
            )}
          </Box>

          <Divider />

          <Box>
            <Typography variant="h6" gutterBottom>
              Decisions
            </Typography>
            {data.recap.decisions.length === 0 ? (
              <Typography color="text.secondary">No decisions were recorded.</Typography>
            ) : (
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                {data.recap.decisions.map((d, i) => (
                  <Box component="li" key={i}>
                    <Typography variant="body2">
                      {d.text} <Typography component="span" variant="caption" color="text.secondary">({d.topicName})</Typography>
                    </Typography>
                  </Box>
                ))}
              </Box>
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
              {data.recap.attendance.length > 0 ? data.recap.attendance.map((a) => a.displayName).join(', ') : 'No attendance recorded.'}
            </Typography>
          </Box>
        </Stack>
      )}
    </AppShell>
  );
}
