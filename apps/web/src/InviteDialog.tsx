import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  List,
  ListItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { InviteError, sendInvites } from './retros';
import { fetchTeamMembers } from './teams';
import { isPlausibleEmail, parseEmailInput } from './inviteEmails';

interface Props {
  accessToken: string;
  teamId: string;
  retroId: string;
  retroName: string;
  joinCode: string;
  /** Called on Skip, Done, Escape or backdrop click — the retro already exists, so every exit
   * goes to its board. */
  onClose: () => void;
}

function describeError(err: unknown): string {
  if (err instanceof InviteError) {
    if (err.code === 'email_unavailable') return "Email isn't set up on this server yet. Copy the share link instead.";
    if (err.code === 'stale_join_code') return 'This link was replaced. Open the board and copy the new share link.';
    if (err.code === 'no_recipients') return 'Pick at least one person other than yourself.';
  }
  return 'Could not send the invites. Try again.';
}

/** RN-062: shown right after Create retro. Team members picked here are an invite list only —
 * nobody becomes a participant until they open the link. */
export function InviteDialog({ accessToken, teamId, retroId, retroName, joinCode, onClose }: Props) {
  const members = useQuery({
    queryKey: ['teamMembers', teamId, accessToken],
    queryFn: () => fetchTeamMembers(accessToken, teamId),
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [emails, setEmails] = useState<string[]>([]);
  const [emailText, setEmailText] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  const memberIds = useMemo(() => (members.data ?? []).map((m) => m.id), [members.data]);
  const allSelected = memberIds.length > 0 && memberIds.every((id) => selected.has(id));
  const someSelected = memberIds.some((id) => selected.has(id));

  const send = useMutation({
    mutationFn: (pendingEmails: string[]) =>
      sendInvites(accessToken, retroId, { joinCode, userIds: [...selected], emails: pendingEmails }),
  });

  function commitEmailText(): string[] {
    if (!emailText.trim()) return emails;
    const { added, rejected } = parseEmailInput(emailText, emails);
    setEmailError(rejected.length ? `Not a valid email: ${rejected.join(', ')}` : null);
    setEmailText(rejected.join(' '));
    const next = [...emails, ...added];
    setEmails(next);
    return next;
  }

  async function copyLink() {
    await navigator.clipboard.writeText(`${window.location.origin}/join/${joinCode}`);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }

  const nothingToSend = selected.size === 0 && emails.length === 0 && !isPlausibleEmail(emailText.split(/[\s,;]+/)[0] ?? '');

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="invite-dialog-title">
      <DialogTitle id="invite-dialog-title">Invite people to “{retroName}”</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={3}>
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              Team members
            </Typography>
            {members.isPending && <CircularProgress size={20} aria-label="Loading team members" />}
            {members.isError && <Alert severity="error">Could not load your team.</Alert>}
            {members.data && members.data.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                No one else is on your team yet. Use the link or add emails below.
              </Typography>
            )}
            {members.data && members.data.length > 0 && (
              <>
                <FormControlLabel
                  label="Add all team members"
                  control={
                    <Checkbox
                      checked={allSelected}
                      indeterminate={someSelected && !allSelected}
                      onChange={(e) => setSelected(e.target.checked ? new Set(memberIds) : new Set())}
                    />
                  }
                />
                <List dense disablePadding sx={{ maxHeight: 220, overflowY: 'auto', pl: 2 }}>
                  {members.data.map((m) => (
                    <ListItem key={m.id} disablePadding>
                      <FormControlLabel
                        label={m.displayName}
                        control={
                          <Checkbox
                            checked={selected.has(m.id)}
                            onChange={(e) => {
                              const next = new Set(selected);
                              if (e.target.checked) next.add(m.id);
                              else next.delete(m.id);
                              setSelected(next);
                            }}
                          />
                        }
                      />
                    </ListItem>
                  ))}
                </List>
              </>
            )}
          </Box>

          <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              Not on your team? Add their email
            </Typography>
            <Stack direction="row" spacing={1}>
              <TextField
                size="small"
                fullWidth
                type="email"
                placeholder="name@company.com"
                value={emailText}
                error={emailError !== null}
                helperText={emailError ?? 'Press Enter or comma to add. They join the team when they open the link.'}
                onChange={(e) => {
                  setEmailText(e.target.value);
                  setEmailError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    commitEmailText();
                  }
                }}
                onBlur={() => {
                  commitEmailText();
                }}
                slotProps={{ htmlInput: { 'aria-label': 'Email address' } }}
              />
              <Button variant="outlined" onClick={commitEmailText} disabled={!emailText.trim()}>
                Add
              </Button>
            </Stack>
            {emails.length > 0 && (
              <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
                {emails.map((email) => (
                  <Chip key={email} label={email} onDelete={() => setEmails(emails.filter((e) => e !== email))} />
                ))}
              </Stack>
            )}
          </Box>

          <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              Or share the link yourself
            </Typography>
            <Button variant="outlined" onClick={copyLink}>
              {linkCopied ? 'Copied!' : 'Copy share link'}
            </Button>
          </Box>

          {send.isSuccess && (
            <Alert severity={send.data.failed > 0 ? 'warning' : 'success'}>
              {send.data.queued} {send.data.queued === 1 ? 'invite' : 'invites'} on the way
              {send.data.failed > 0 ? `; ${send.data.failed} could not be queued.` : '.'}
            </Alert>
          )}
          {send.isError && <Alert severity="error">{describeError(send.error)}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{send.isSuccess ? 'Go to board' : 'Skip for now'}</Button>
        <Button
          variant="contained"
          disabled={send.isPending || nothingToSend}
          onClick={() =>
            // Clear the picks once sent so "Send more" can't email the same people twice.
            send.mutate(commitEmailText(), {
              onSuccess: () => {
                setSelected(new Set());
                setEmails([]);
              },
            })
          }
        >
          {send.isPending ? 'Sending…' : send.isSuccess ? 'Send more' : 'Send invites'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
