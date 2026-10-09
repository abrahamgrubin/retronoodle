import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FocusEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  IconButton,
  Link,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { AppShell } from './AppShell';
import { fetchHealth } from './api';
import { fetchMe, signInWithGoogle, signOut } from './auth';
import { supabase } from './supabaseClient';
import { createTeam, fetchMyTeams } from './teams';
import { createRetro } from './retros';
import { fetchTeamTemplates } from './templates';
import { useSession } from './useSession';

const ACTION_ITEMS_COLOR = 'blue'; // always appended last by the API; never stored on a template.

function ColumnPreviewDots({ columns }: { columns: { title: string; color: string }[] }) {
  const dots = [...columns, { title: 'Action items', color: ACTION_ITEMS_COLOR }];
  return (
    <Stack direction="row" spacing={0.5}>
      {dots.map((col, index) => (
        <Box
          key={`${col.title}-${index}`}
          title={col.title}
          sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: col.color }}
        />
      ))}
    </Stack>
  );
}

function RetroCreator({ accessToken, teamId }: { accessToken: string; teamId: string }) {
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [retroName, setRetroName] = useState('');
  const templates = useQuery({
    queryKey: ['templates', teamId, accessToken],
    queryFn: () => fetchTeamTemplates(accessToken, teamId),
  });
  const create = useMutation({
    mutationFn: (name: string) => createRetro(accessToken, teamId, name, selectedTemplateId as string),
  });

  if (create.isSuccess) {
    const joinUrl = `${window.location.origin}/join/${create.data.joinCode}`;
    return (
      <Stack spacing={1}>
        <Typography>
          Created <strong>{create.data.name}</strong>. <Link href={`/retros/${create.data.id}`}>Go to the board</Link>
        </Typography>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <TextField
            size="small"
            value={joinUrl}
            slotProps={{
              htmlInput: { readOnly: true, onFocus: (e: FocusEvent<HTMLInputElement>) => e.currentTarget.select() },
            }}
            sx={{ width: 320 }}
          />
          <IconButton aria-label="Copy join link" onClick={() => void navigator.clipboard.writeText(joinUrl)}>
            <ContentCopyIcon fontSize="small" />
          </IconButton>
        </Stack>
      </Stack>
    );
  }

  if (templates.isPending) return <Typography>Loading templates…</Typography>;
  if (templates.isError) return <Alert severity="error">Failed to load templates.</Alert>;

  return (
    <Box
      component="form"
      onSubmit={(e) => {
        e.preventDefault();
        if (selectedTemplateId && retroName.trim()) create.mutate(retroName.trim());
      }}
    >
      <Typography sx={{ mb: 1 }}>Pick a template:</Typography>
      <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap", mb: 2 }}>
        {templates.data.map((template) => (
          <Card
            key={template.id}
            variant="outlined"
            sx={{ borderColor: selectedTemplateId === template.id ? 'primary.main' : undefined, borderWidth: selectedTemplateId === template.id ? 2 : 1 }}
          >
            <CardActionArea onClick={() => setSelectedTemplateId(template.id)} sx={{ p: 1.5 }}>
              <Typography sx={{ fontWeight: "bold" }}>{template.name}</Typography>
              <Box sx={{ mt: 0.5 }}>
                <ColumnPreviewDots columns={template.columns} />
              </Box>
            </CardActionArea>
          </Card>
        ))}
      </Stack>
      <Stack direction="row" spacing={1}>
        <TextField
          size="small"
          value={retroName}
          onChange={(e) => setRetroName(e.target.value)}
          placeholder="Retro name"
          disabled={create.isPending}
        />
        <Button type="submit" variant="contained" disabled={create.isPending || !selectedTemplateId || !retroName.trim()}>
          Create a retro
        </Button>
      </Stack>
    </Box>
  );
}

function TeamsPanel({ accessToken }: { accessToken: string }) {
  const queryClient = useQueryClient();
  const [newTeamName, setNewTeamName] = useState('');
  const teams = useQuery({ queryKey: ['myTeams', accessToken], queryFn: () => fetchMyTeams(accessToken) });
  const create = useMutation({
    mutationFn: (name: string) => createTeam(accessToken, name),
    onSuccess: () => {
      setNewTeamName('');
      void queryClient.invalidateQueries({ queryKey: ['myTeams', accessToken] });
    },
  });

  if (teams.isPending) return <Typography>Loading teams…</Typography>;
  if (teams.isError) return <Alert severity="error">Failed to load teams.</Alert>;

  // A user with one team lands on it; zero teams shows "Create a team" (RN-005).
  if (teams.data.length === 0) {
    return (
      <Box
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (newTeamName.trim()) create.mutate(newTeamName.trim());
        }}
      >
        <Typography sx={{ mb: 1 }}>You're not on a team yet.</Typography>
        <Stack direction="row" spacing={1}>
          <TextField
            size="small"
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            placeholder="Team name"
            disabled={create.isPending}
          />
          <Button type="submit" variant="contained" disabled={create.isPending || !newTeamName.trim()}>
            Create a team
          </Button>
        </Stack>
      </Box>
    );
  }

  const [team] = teams.data;
  if (!team) return null; // unreachable: teams.data.length > 0 was checked above

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Typography>
          Your team: <strong>{team.name}</strong>
        </Typography>
        <Chip size="small" label={team.role} />
      </Stack>
      {/* RN-024/RN-026: "reached from the team top bar tabs 'Retros' and 'Action items.'" Retro
          creation stays here (the home page); the list of past retros is its own page now. */}
      <Stack direction="row" spacing={2}>
        <Link href={`/teams/${team.id}/retros`}>Retros</Link>
        <Link href={`/teams/${team.id}/actions`}>Action items</Link>
      </Stack>
      <Card variant="outlined">
        <CardContent>
          <RetroCreator accessToken={accessToken} teamId={team.id} />
        </CardContent>
      </Card>
    </Stack>
  );
}

export function App() {
  const health = useQuery({ queryKey: ['health'], queryFn: () => fetchHealth() });
  const session = useSession();

  const accessToken = session?.access_token;
  const me = useQuery({
    queryKey: ['me', accessToken],
    queryFn: () => fetchMe(accessToken as string),
    enabled: !!accessToken,
  });

  return (
    <AppShell>
      <Stack spacing={3}>
        <Chip
          size="small"
          sx={{ alignSelf: 'flex-start' }}
          label={`API: ${health.isPending ? 'checking…' : health.isError ? 'unreachable' : `ok at ${health.data.time}`}`}
          color={health.isError ? 'error' : health.isPending ? 'default' : 'success'}
        />
        {accessToken ? (
          <>
            <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
              <Typography>
                {me.isPending ? 'Loading profile…' : me.isError ? 'Failed to load profile' : `Signed in as ${me.data.displayName}`}
              </Typography>
              <Button size="small" onClick={() => void signOut()}>
                Sign out
              </Button>
            </Stack>
            <TeamsPanel accessToken={accessToken} />
          </>
        ) : (
          <Button variant="contained" size="large" sx={{ alignSelf: 'flex-start' }} onClick={() => void signInWithGoogle()} disabled={!supabase}>
            Continue with Google
          </Button>
        )}
      </Stack>
    </AppShell>
  );
}
