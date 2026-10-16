import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Box, Button, Card, CardActionArea, CardContent, CardMedia, Chip, Link, Stack, TextField, Typography } from '@mui/material';
import { AppShell } from './AppShell';
import { fetchHealth } from './api';
import { fetchMe, signInWithGoogle, signOut } from './auth';
import { supabase } from './supabaseClient';
import { createTeam, fetchMyTeams } from './teams';
import { createRetro } from './retros';
import { fetchTeamTemplates } from './templates';
import { setCachedJoinCode } from './joinLinkStorage';
import { useSession } from './useSession';

const ACTION_ITEMS_COLOR = 'blue'; // always appended last by the API; never stored on a template.

function RetroCreator({ accessToken, teamId }: { accessToken: string; teamId: string }) {
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [retroName, setRetroName] = useState('');
  const templates = useQuery({
    queryKey: ['templates', teamId, accessToken],
    queryFn: () => fetchTeamTemplates(accessToken, teamId),
  });
  const create = useMutation({
    mutationFn: (name: string) => createRetro(accessToken, teamId, name, selectedTemplateId as string),
    // Straight to the board, no inline "created!" panel on this page — the join link moved to
    // its own "Copy share link" button in the board's own header (BoardPage.tsx), so there's
    // nothing left to show here first. Caching the code now is what lets that button work
    // without immediately having to regenerate (and invalidate) it (joinLinkStorage.ts).
    onSuccess: (data) => {
      setCachedJoinCode(data.id, data.joinCode);
      window.location.href = `/retros/${data.id}`;
    },
  });

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
      <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap", mb: 2}} useFlexGap>
        {templates.data.map((template) => (
          <Card
            key={template.id}
            variant="outlined"
            sx={{
              width: 260,
              borderColor: selectedTemplateId === template.id ? 'primary.main' : undefined,
              borderWidth: selectedTemplateId === template.id ? 2 : 1,
            }}
          >
            <CardActionArea onClick={() => setSelectedTemplateId(template.id)}>
              {template.imageUrl && (
                <CardMedia component="img" height="140" image={template.imageUrl} alt={template.name} sx={{ objectFit: 'cover' }} />
              )}
              <CardContent>
                <Typography gutterBottom variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                  {template.name}
                </Typography>
                {template.description && (
                  <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
                    {template.description}
                  </Typography>
                )}
              </CardContent>
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
