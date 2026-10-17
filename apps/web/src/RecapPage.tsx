import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { uuidv7 } from 'uuidv7';
import type { RecapDecision } from '@retronoodle/shared';
import { Alert, Box, Button, Chip, CircularProgress, Divider, Stack, TextField, Typography } from '@mui/material';
import { AppShell } from './AppShell';
import { postMutation } from './mutations';
import { NavDrawerContent } from './NavDrawer';
import { fetchRecap } from './recap';
import { useSession } from './useSession';

const STATUS_LABEL: Record<string, string> = { open: 'Open', in_progress: 'In progress', done: 'Done', dropped: 'Dropped' };

/** A topic's recap summary (facilitator-only edit) — mirrors BoardPage.tsx's GroupSummaryView:
 * click Edit, type, Save or Cancel. `summary` always reflects the server's last-saved value
 * (read directly, not through `draft`) so a successful save's refetch is never shadowed by stale
 * local state once editing closes. */
function TopicSummaryRow({
  topicName,
  summary,
  canEdit,
  onSave,
}: {
  topicName: string;
  summary: string;
  canEdit: boolean;
  onSave: (summary: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(summary);

  if (editing) {
    return (
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
          {topicName}
        </Typography>
        <TextField
          autoFocus
          fullWidth
          multiline
          minRows={2}
          size="small"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label={`Summary for ${topicName}`}
        />
        <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
          <Button
            size="small"
            type="button"
            onClick={() => {
              const trimmed = draft.trim();
              if (!trimmed) return;
              onSave(trimmed);
              setEditing(false);
            }}
          >
            Save
          </Button>
          <Button
            size="small"
            type="button"
            onClick={() => {
              setDraft(summary);
              setEditing(false);
            }}
          >
            Cancel
          </Button>
        </Stack>
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="subtitle2">{topicName}</Typography>
      <Typography variant="body2">{summary}</Typography>
      {canEdit && (
        <Button
          size="small"
          type="button"
          onClick={() => {
            setDraft(summary);
            setEditing(true);
          }}
        >
          Edit
        </Button>
      )}
    </Box>
  );
}

/** One decision (facilitator-only edit) — `topicName` is a read-only label (which topic this
 * came from), never itself editable; only `text` is. Saving resends the *whole* decisions array
 * (RecapEditDecisionsPayload's own comment on why: no stable id per decision to address one in
 * place), which the caller (`saveDecision` below) builds from the current list plus this one
 * change. */
function DecisionRow({
  decision,
  canEdit,
  onSave,
}: {
  decision: RecapDecision;
  canEdit: boolean;
  onSave: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(decision.text);

  if (editing) {
    return (
      <Box component="li" sx={{ listStyle: 'none', mb: 1 }}>
        <TextField
          autoFocus
          fullWidth
          multiline
          size="small"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label={`Decision for ${decision.topicName}`}
        />
        <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
          <Button
            size="small"
            type="button"
            onClick={() => {
              const trimmed = draft.trim();
              if (!trimmed) return;
              onSave(trimmed);
              setEditing(false);
            }}
          >
            Save
          </Button>
          <Button
            size="small"
            type="button"
            onClick={() => {
              setDraft(decision.text);
              setEditing(false);
            }}
          >
            Cancel
          </Button>
        </Stack>
      </Box>
    );
  }

  return (
    <Box component="li">
      <Typography variant="body2">
        {decision.text}{' '}
        <Typography component="span" variant="caption" color="text.secondary">
          ({decision.topicName})
        </Typography>
      </Typography>
      {canEdit && (
        <Button
          size="small"
          type="button"
          onClick={() => {
            setDraft(decision.text);
            setEditing(true);
          }}
        >
          Edit
        </Button>
      )}
    </Box>
  );
}

/** The recap page's own free-text section, independent of the AI recap entirely (no summary/
 * decision to defer to) — allowed to save back to empty (clearing it out is a valid edit, not an
 * error), unlike TopicSummaryRow/DecisionRow above which both require non-empty text. */
function AdditionalNotesSection({
  notes,
  canEdit,
  saving,
  onSave,
}: {
  notes: string;
  canEdit: boolean;
  saving: boolean;
  onSave: (notes: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(notes);

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Additional notes
      </Typography>
      {editing ? (
        <>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={4}
            size="small"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Additional notes"
          />
          <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
            <Button
              size="small"
              type="button"
              disabled={saving}
              onClick={() => {
                onSave(draft.trim());
                setEditing(false);
              }}
            >
              Save
            </Button>
            <Button
              size="small"
              type="button"
              onClick={() => {
                setDraft(notes);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </Stack>
        </>
      ) : (
        <>
          {notes ? (
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
              {notes}
            </Typography>
          ) : (
            <Typography color="text.secondary">No additional notes yet.</Typography>
          )}
          {canEdit && (
            <Button
              size="small"
              type="button"
              sx={{ mt: 0.5 }}
              onClick={() => {
                setDraft(notes);
                setEditing(true);
              }}
            >
              Edit
            </Button>
          )}
        </>
      )}
    </Box>
  );
}

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

  // No optimistic update for any of these three — this page has no Realtime channel to race
  // against (unlike BoardPage.tsx's own summary edits), so there's nothing to gain from guessing
  // ahead of a refetch that's already only ever a few hundred ms away.
  const editTopicSummary = useMutation({
    mutationFn: (payload: { topicId: string; summary: string }) =>
      postMutation(accessToken as string, retroId, { mutationId: uuidv7(), type: 'recap.editTopicSummary', payload }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['recap', retroId, accessToken] }),
  });

  const editDecisions = useMutation({
    mutationFn: (decisions: RecapDecision[]) =>
      postMutation(accessToken as string, retroId, { mutationId: uuidv7(), type: 'recap.editDecisions', payload: { decisions } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['recap', retroId, accessToken] }),
  });

  const editNotes = useMutation({
    mutationFn: (notes: string) =>
      postMutation(accessToken as string, retroId, { mutationId: uuidv7(), type: 'recap.editNotes', payload: { notes } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['recap', retroId, accessToken] }),
  });

  // Decisions have no stable id of their own (RecapEditDecisionsPayload's own comment on why) —
  // this is what lets DecisionRow's onSave stay a plain "here's my new text" callback instead of
  // needing to know about the rest of the array itself.
  function saveDecision(index: number, text: string) {
    if (!recap.data?.recap) return;
    const next = recap.data.recap.decisions.map((d, i) => (i === index ? { ...d, text } : d));
    editDecisions.mutate(next);
  }

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
                  <TopicSummaryRow
                    key={t.topicId}
                    topicName={t.topicName}
                    summary={t.summary}
                    canEdit={data.isFacilitator}
                    onSave={(summary) => editTopicSummary.mutate({ topicId: t.topicId, summary })}
                  />
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
                  <DecisionRow key={i} decision={d} canEdit={data.isFacilitator} onSave={(text) => saveDecision(i, text)} />
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

          <Divider />

          <AdditionalNotesSection
            notes={data.additionalNotes}
            canEdit={data.isFacilitator}
            saving={editNotes.isPending}
            onSave={(notes) => editNotes.mutate(notes)}
          />
        </Stack>
      )}
    </AppShell>
  );
}
