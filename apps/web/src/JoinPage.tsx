import { useQuery } from '@tanstack/react-query';
import { Alert, Button, CircularProgress, Link, Stack, Typography } from '@mui/material';
import { AppShell } from './AppShell';
import { signInWithGoogle } from './auth';
import { supabase } from './supabaseClient';
import { JoinError, joinRetro } from './retros';
import { useSession } from './useSession';

/** GET a join link (RN-006): if not signed in, sign in with Google first (redirectTo brings the
 * user right back here); then call the API, which adds them to the team and retro. */
export function JoinPage({ code }: { code: string }) {
  const session = useSession();
  const accessToken = session?.access_token;
  const join = useQuery({
    queryKey: ['join', code, accessToken],
    queryFn: () => joinRetro(code, accessToken as string),
    enabled: !!accessToken,
    retry: false,
  });

  if (!supabase) {
    return (
      <AppShell>
        <Alert severity="error">Supabase is not configured.</Alert>
      </AppShell>
    );
  }

  if (!accessToken) {
    return (
      <AppShell>
        <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
          <Typography>Sign in to join this retro.</Typography>
          <Button variant="contained" onClick={() => void signInWithGoogle()}>
            Continue with Google
          </Button>
        </Stack>
      </AppShell>
    );
  }

  if (join.isPending) {
    return (
      <AppShell>
        <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
          <CircularProgress size={20} />
          <Typography>Joining…</Typography>
        </Stack>
      </AppShell>
    );
  }

  if (join.isError) {
    const message = join.error instanceof JoinError ? join.error.message : 'Something went wrong.';
    return (
      <AppShell>
        <Alert severity="error">{message}</Alert>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Typography>
        Joined <strong>{join.data.name}</strong>.{' '}
        <Link href={`/retros/${join.data.retroId}`}>Go to the board</Link>
      </Typography>
    </AppShell>
  );
}
