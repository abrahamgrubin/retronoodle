import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { fetchHealth } from './api';
import { fetchMe, signInWithGoogle, signOut } from './auth';
import { supabase } from './supabaseClient';
import { createTeam, fetchMyTeams } from './teams';
import { createRetro } from './retros';
import { fetchTeamTemplates } from './templates';

const ACTION_ITEMS_COLOR = 'blue'; // always appended last by the API; never stored on a template.

function ColumnPreviewDots({ columns }: { columns: { title: string; color: string }[] }) {
  const dots = [...columns, { title: 'Action items', color: ACTION_ITEMS_COLOR }];
  return (
    <span style={{ display: 'inline-flex', gap: 4 }}>
      {dots.map((col, index) => (
        <span
          key={`${col.title}-${index}`}
          title={col.title}
          style={{ width: 10, height: 10, borderRadius: '50%', background: col.color, display: 'inline-block' }}
        />
      ))}
    </span>
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
      <p>
        Created <strong>{create.data.name}</strong>. Join link:{' '}
        <input readOnly value={joinUrl} onFocus={(e) => e.target.select()} style={{ width: 320 }} />{' '}
        <button onClick={() => void navigator.clipboard.writeText(joinUrl)}>Copy</button>
      </p>
    );
  }

  if (templates.isPending) return <p>Loading templates…</p>;
  if (templates.isError) return <p>Failed to load templates.</p>;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (selectedTemplateId && retroName.trim()) create.mutate(retroName.trim());
      }}
    >
      <p>Pick a template:</p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {templates.data.map((template) => (
          <label
            key={template.id}
            style={{
              border: selectedTemplateId === template.id ? '2px solid #3366ff' : '1px solid #ccc',
              borderRadius: 6,
              padding: 8,
              cursor: 'pointer',
            }}
          >
            <input
              type="radio"
              name="template"
              checked={selectedTemplateId === template.id}
              onChange={() => setSelectedTemplateId(template.id)}
            />{' '}
            <strong>{template.name}</strong>
            <div style={{ marginTop: 4 }}>
              <ColumnPreviewDots columns={template.columns} />
            </div>
          </label>
        ))}
      </div>
      <input
        value={retroName}
        onChange={(e) => setRetroName(e.target.value)}
        placeholder="Retro name"
        disabled={create.isPending}
      />
      <button type="submit" disabled={create.isPending || !selectedTemplateId || !retroName.trim()}>
        Create a retro
      </button>
    </form>
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
    <>
      <p>
        Your team: <strong>{team.name}</strong> ({team.role})
      </p>
      <RetroCreator accessToken={accessToken} teamId={team.id} />
    </>
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
