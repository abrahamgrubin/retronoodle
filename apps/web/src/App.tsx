import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Box, Button, Card, CardActionArea, CardContent, CardMedia, Stack, TextField, Typography } from '@mui/material';
import { AppShell } from './AppShell';
import { SignInPage } from './SignInPage';
import { createTeam, fetchMyTeams } from './teams';
import { createRetro } from './retros';
import type { RetroCreatedResponse } from '@retronoodle/shared';
import { fetchTeamTemplates } from './templates';
import { setCachedJoinCode } from './joinLinkStorage';
import { InviteDialog } from './InviteDialog';
import { NavDrawerContent } from './NavDrawer';
import { useSession } from './useSession';

function RetroCreator({ accessToken, teamId }: { accessToken: string; teamId: string }) {
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [retroName, setRetroName] = useState('');
  // RN-062: set once the retro exists; opens the invite dialog instead of going straight to the board.
  const [created, setCreated] = useState<RetroCreatedResponse | null>(null);
  const templates = useQuery({
    queryKey: ['templates', teamId, accessToken],
    queryFn: () => fetchTeamTemplates(accessToken, teamId),
  });
  const create = useMutation({
    mutationFn: (name: string) => createRetro(accessToken, teamId, name, selectedTemplateId as string),
    // RN-062: the invite dialog opens first; it always ends at the board (goToBoard). The join code
    // is cached now either way — the board's own "Copy share link" button relies on it, without
    // having to regenerate (and invalidate) it (joinLinkStorage.ts).
    onSuccess: (data) => {
      setCachedJoinCode(data.id, data.joinCode);
      setCreated(data);
    },
  });

  function goToBoard(retroId: string) {
    window.location.href = `/retros/${retroId}`;
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
      {created && (
        <InviteDialog
          accessToken={accessToken}
          teamId={teamId}
          retroId={created.id}
          retroName={created.name}
          joinCode={created.joinCode}
          onClose={() => goToBoard(created.id)}
        />
      )}
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

  // RN-024/RN-026's own "Retros"/"Action items" links now live in the page's left-side drawer
  // (App()'s own AppShell call below) instead of inline text here.
  return (
    <Card variant="outlined">
      <CardContent>
        <RetroCreator accessToken={accessToken} teamId={team.id} />
      </CardContent>
    </Card>
  );
}

export function App() {
  const session = useSession();
  const accessToken = session?.access_token;
  const teams = useQuery({
    queryKey: ['myTeams', accessToken],
    queryFn: () => fetchMyTeams(accessToken as string),
    enabled: !!accessToken,
  });
  const team = teams.data?.[0];

  // Signed out gets the full-page sign-in card, not an AppShell with one button in it — there's
  // no nav to show yet (every drawer link needs a team id) and nothing else on the page.
  if (!accessToken) return <SignInPage />;

  return (
    <AppShell drawer={team ? (collapsed) => <NavDrawerContent teamId={team.id} collapsed={collapsed} /> : undefined}>
      <Stack spacing={3}>
        <TeamsPanel accessToken={accessToken} />
      </Stack>
    </AppShell>
  );
}
