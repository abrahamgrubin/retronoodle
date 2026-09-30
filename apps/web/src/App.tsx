import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { fetchHealth } from './api';
import { fetchMe, signInWithGoogle, signOut } from './auth';
import { supabase } from './supabaseClient';
import { createTeam, fetchMyTeams } from './teams';

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

  if (teams.isPending) return <p>Loading teams…</p>;
  if (teams.isError) return <p>Failed to load teams.</p>;

  // A user with one team lands on it; zero teams shows "Create a team" (RN-005).
  if (teams.data.length === 0) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (newTeamName.trim()) create.mutate(newTeamName.trim());
        }}
      >
        <p>You're not on a team yet.</p>
        <input
          value={newTeamName}
          onChange={(e) => setNewTeamName(e.target.value)}
          placeholder="Team name"
          disabled={create.isPending}
        />
        <button type="submit" disabled={create.isPending || !newTeamName.trim()}>
          Create a team
        </button>
      </form>
    );
  }

  const [team] = teams.data;
  if (!team) return null; // unreachable: teams.data.length > 0 was checked above

  return (
    <p>
      Your team: <strong>{team.name}</strong> ({team.role})
    </p>
  );
}

export function App() {
  const health = useQuery({ queryKey: ['health'], queryFn: () => fetchHealth() });
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => setSession(newSession));
    return () => subscription.unsubscribe();
  }, []);

  const accessToken = session?.access_token;
  const me = useQuery({
    queryKey: ['me', accessToken],
    queryFn: () => fetchMe(accessToken as string),
    enabled: !!accessToken,
  });

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 32 }}>
      <h1>RetroNoodle</h1>
      <p>
        API:{' '}
        {health.isPending ? 'checking…' : health.isError ? 'unreachable' : `ok at ${health.data.time}`}
      </p>
      {accessToken ? (
        <>
          <p>
            {me.isPending
              ? 'Loading profile…'
              : me.isError
                ? 'Failed to load profile'
                : `Signed in as ${me.data.displayName}`}{' '}
            <button onClick={() => void signOut()}>Sign out</button>
          </p>
          <TeamsPanel accessToken={accessToken} />
        </>
      ) : (
        <button onClick={() => void signInWithGoogle()} disabled={!supabase}>
          Continue with Google
        </button>
      )}
    </main>
  );
}
