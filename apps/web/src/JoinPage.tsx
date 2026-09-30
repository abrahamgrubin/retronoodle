import { useQuery } from '@tanstack/react-query';
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

  if (!supabase) return <p>Supabase is not configured.</p>;

  if (!accessToken) {
    return (
      <main style={{ fontFamily: 'system-ui, sans-serif', padding: 32 }}>
        <p>Sign in to join this retro.</p>
        <button onClick={() => void signInWithGoogle()}>Continue with Google</button>
      </main>
    );
  }

  if (join.isPending) return <p>Joining…</p>;

  if (join.isError) {
    const message = join.error instanceof JoinError ? join.error.message : 'Something went wrong.';
    return <p>{message}</p>;
  }

  return (
    <p>
      Joined <strong>{join.data.name}</strong>. <a href={`/retros/${join.data.retroId}`}>Go to the board</a>
    </p>
  );
}
