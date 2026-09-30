import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { fetchHealth } from './api';
import { fetchMe, signInWithGoogle, signOut } from './auth';
import { supabase } from './supabaseClient';

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
        <p>
          {me.isPending
            ? 'Loading profile…'
            : me.isError
              ? 'Failed to load profile'
              : `Signed in as ${me.data.displayName}`}{' '}
          <button onClick={() => void signOut()}>Sign out</button>
        </p>
      ) : (
        <button onClick={() => void signInWithGoogle()} disabled={!supabase}>
          Continue with Google
        </button>
      )}
    </main>
  );
}
