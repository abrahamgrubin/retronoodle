import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Alert, Box, Button, ButtonBase, Skeleton, Stack, TextField, Typography } from '@mui/material';
import type { TemplateResponse } from '@retronoodle/shared';
import { AppShell } from './AppShell';
import { SignInPage } from './SignInPage';
import { createTeam, fetchMyTeams } from './teams';
import { createRetro } from './retros';
import { fetchTeamTemplates } from './templates';
import { setCachedJoinCode } from './joinLinkStorage';
import { NavDrawerContent } from './NavDrawer';
import { BORDER, INDIGO, INDIGO_HOVER, INDIGO_SOFT, INK, MUTED, PAGE_BG, PLACEHOLDER } from './designTokens';
import { firstNameFor } from './profileName';
import { useMe } from './useMe';
import { useSession } from './useSession';

/* RN-062: the home page, restyled to Figma "Home · team workspace" (131:1213) and "Home · no team
 * (mock)" (156:923). The create-retro and create-team mutations are the same as before; only the
 * chrome around them changed. */

const TAGLINE = 'A little reflection. A better way forward. Start your next team retrospective with RetroNoodle.';

/** Figma "Create a retro" / "Create a team" panel (131:1264 / 156:954): white, 1px border, 12px
 * radius, a 24px-padded top section and a 24px-padded form section split by a border. Both the
 * retro form and the team form use this so they look the same. */
function Panel({ heading, copy, body, form }: { heading: string; copy: string; body?: ReactNode; form: ReactNode }) {
  return (
    <Box sx={{ bgcolor: 'white', border: `1px solid ${BORDER}`, borderRadius: '12px', overflow: 'hidden' }}>
      <Box sx={{ p: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <Typography component="h2" sx={{ fontSize: 20, fontWeight: 700, lineHeight: '28px', color: INK }}>
            {heading}
          </Typography>
          <Typography sx={{ fontSize: 14, lineHeight: '20px', color: MUTED }}>{copy}</Typography>
        </Box>
        {body}
      </Box>
      <Box sx={{ borderTop: `1px solid ${BORDER}`, p: '24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>{form}</Box>
    </Box>
  );
}

/** The 44px name field + indigo "+ Create …" button row at the bottom of each panel (Figma
 * "Retro setup", 131:1312 / 156:989). Stacks below the `sm` breakpoint. */
function NameForm({
  id,
  label,
  value,
  onChange,
  disabled,
  submitLabel,
  canSubmit,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
  submitLabel: string;
  canSubmit: boolean;
}) {
  return (
    <>
      <Typography component="label" htmlFor={id} sx={{ fontSize: 14, fontWeight: 500, color: INK }}>
        {label}
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing="12px" sx={{ alignItems: { xs: 'stretch', sm: 'center' } }}>
        <TextField
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={label}
          disabled={disabled}
          fullWidth
          sx={{
            '& .MuiOutlinedInput-root': {
              height: 44,
              borderRadius: '8px',
              fontSize: 15,
              color: INK,
              bgcolor: 'white',
              '& fieldset': { borderColor: BORDER },
              '&:hover fieldset': { borderColor: PLACEHOLDER },
              '&.Mui-focused fieldset': { borderColor: INDIGO, borderWidth: 1 },
            },
            '& .MuiOutlinedInput-input': { px: '14px', py: 0, height: 44, boxSizing: 'border-box' },
            '& .MuiOutlinedInput-input::placeholder': { color: PLACEHOLDER, opacity: 1 },
          }}
        />
        <Button
          type="submit"
          variant="contained"
          disabled={!canSubmit}
          startIcon={<Box component="img" src="/icons/plus-white-18.svg" alt="" sx={{ width: 18, height: 18 }} />}
          sx={{
            height: 44,
            px: '20px',
            borderRadius: '8px',
            bgcolor: INDIGO,
            fontSize: 14,
            fontWeight: 500,
            textTransform: 'none',
            whiteSpace: 'nowrap',
            flexShrink: 0,
            '&:hover': { bgcolor: INDIGO_HOVER },
            '& .MuiButton-startIcon': { mr: '8px', ml: 0 },
          }}
        >
          {submitLabel}
        </Button>
      </Stack>
    </>
  );
}

/** Figma "Template choices" (131:1271): four across at desktop, two below `lg`, one below `sm`. */
const templateGridSx = {
  display: 'grid',
  gap: '16px',
  gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' },
} as const;

const TEMPLATE_CARD_HEIGHT = 328;

/** The template cards as one radio group labelled "Template" (RN-062): Tab lands on the selected
 * card (or the first, before anything's picked), arrow keys move the selection and the focus
 * together, Space/Enter select, and clicking the selected card leaves it selected — a radio, not
 * a toggle. Visual spec is Figma "Template card" (131:1272 selected / 131:1282 unselected). */
function TemplatePicker({
  templates,
  selectedId,
  onSelect,
}: {
  templates: TemplateResponse[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function selectAndFocus(index: number) {
    const wrapped = (index + templates.length) % templates.length;
    const template = templates[wrapped];
    if (!template) return;
    onSelect(template.id);
    cardRefs.current[wrapped]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        selectAndFocus(index + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        selectAndFocus(index - 1);
        break;
      case ' ':
      case 'Enter':
        event.preventDefault();
        selectAndFocus(index);
        break;
    }
  }

  const tabStopIndex = selectedId ? templates.findIndex((t) => t.id === selectedId) : 0;

  return (
    <Box role="radiogroup" aria-label="Template" sx={templateGridSx}>
      {templates.map((template, index) => {
        const selected = template.id === selectedId;
        return (
          <ButtonBase
            key={template.id}
            ref={(el) => {
              cardRefs.current[index] = el;
            }}
            role="radio"
            aria-checked={selected}
            tabIndex={index === tabStopIndex ? 0 : -1}
            onClick={() => onSelect(template.id)}
            onKeyDown={(e) => onKeyDown(e, index)}
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'stretch',
              textAlign: 'left',
              minHeight: TEMPLATE_CARD_HEIGHT,
              minWidth: 0,
              bgcolor: 'white',
              border: `1px solid ${selected ? INDIGO : BORDER}`,
              // The selected card's 2px border is drawn as 1px border + 1px inset ring so picking
              // a card doesn't nudge its neighbours by a pixel.
              boxShadow: selected ? `inset 0 0 0 1px ${INDIGO}` : 'none',
              borderRadius: '8px',
              overflow: 'hidden',
              '&:hover': { borderColor: selected ? INDIGO : PLACEHOLDER },
              '&.Mui-focusVisible': { outline: `2px solid ${INDIGO}`, outlineOffset: 2 },
            }}
          >
            {template.imageUrl ? (
              <Box component="img" src={template.imageUrl} alt="" sx={{ width: '100%', height: 140, objectFit: 'cover', display: 'block', flexShrink: 0 }} />
            ) : (
              <Box sx={{ width: '100%', height: 140, bgcolor: INDIGO_SOFT, flexShrink: 0 }} />
            )}
            <Box sx={{ p: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <Typography component="span" sx={{ fontSize: 16, fontWeight: 700, lineHeight: '24px', color: INK }}>
                {template.name}
              </Typography>
              {template.description && (
                <Typography component="span" sx={{ fontSize: 14, lineHeight: '20px', color: MUTED }}>
                  {template.description}
                </Typography>
              )}
            </Box>
          </ButtonBase>
        );
      })}
    </Box>
  );
}

function TemplateSkeletons() {
  return (
    <Box sx={templateGridSx} aria-busy="true" aria-label="Loading templates">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} variant="rounded" height={TEMPLATE_CARD_HEIGHT} sx={{ borderRadius: '8px' }} />
      ))}
    </Box>
  );
}

function CreateRetroPanel({ accessToken, teamId }: { accessToken: string; teamId: string }) {
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

  let body: ReactNode;
  if (templates.isPending) {
    body = <TemplateSkeletons />;
  } else if (templates.isError) {
    body = (
      <Alert
        severity="error"
        action={
          <Button color="inherit" size="small" onClick={() => void templates.refetch()}>
            Retry
          </Button>
        }
      >
        Failed to load templates.
      </Alert>
    );
  } else {
    body = <TemplatePicker templates={templates.data} selectedId={selectedTemplateId} onSelect={setSelectedTemplateId} />;
  }

  return (
    <Box
      component="form"
      onSubmit={(e) => {
        e.preventDefault();
        if (selectedTemplateId && retroName.trim()) create.mutate(retroName.trim());
      }}
    >
      <Panel
        heading="Create a retro"
        copy="Pick a template to guide the conversation."
        body={body}
        form={
          <NameForm
            id="retro-name"
            label="Retro name"
            value={retroName}
            onChange={setRetroName}
            disabled={create.isPending}
            submitLabel="Create a retro"
            canSubmit={!create.isPending && !!selectedTemplateId && retroName.trim().length > 0}
          />
        }
      />
    </Box>
  );
}

/** Figma "Home · no team (mock)" (156:923): same panel, no template picker. Creating the team
 * invalidates `myTeams`, so App() re-renders straight into the retro form (RN-005). */
function CreateTeamPanel({ accessToken }: { accessToken: string }) {
  const queryClient = useQueryClient();
  const [teamName, setTeamName] = useState('');
  const create = useMutation({
    mutationFn: (name: string) => createTeam(accessToken, name),
    onSuccess: () => {
      setTeamName('');
      void queryClient.invalidateQueries({ queryKey: ['myTeams', accessToken] });
    },
  });

  return (
    <Box
      component="form"
      onSubmit={(e) => {
        e.preventDefault();
        if (teamName.trim()) create.mutate(teamName.trim());
      }}
    >
      <Panel
        heading="Create a team"
        copy="You're not on a team yet. Create one to start running retros."
        form={
          <NameForm
            id="team-name"
            label="Team name"
            value={teamName}
            onChange={setTeamName}
            disabled={create.isPending}
            submitLabel="Create a team"
            canSubmit={!create.isPending && teamName.trim().length > 0}
          />
        }
      />
    </Box>
  );
}

/** Figma "Workspace shortcut" (131:1324 / 131:1331): a plain link styled as a card, so it's in
 * the Tab order and opens in a new tab on middle-click like any other link. */
function ShortcutCard({ href, icon, iconSize, title, copy }: { href: string; icon: string; iconSize: number; title: string; copy: string }) {
  return (
    <ButtonBase
      component="a"
      href={href}
      sx={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        p: '20px',
        bgcolor: 'white',
        border: `1px solid ${BORDER}`,
        borderRadius: '8px',
        textAlign: 'left',
        '&:hover': { borderColor: PLACEHOLDER },
        '&.Mui-focusVisible': { outline: `2px solid ${INDIGO}`, outlineOffset: 2 },
      }}
    >
      <Box sx={{ width: 40, height: 40, borderRadius: '8px', bgcolor: INDIGO_SOFT, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Box component="img" src={icon} alt="" sx={{ width: iconSize, height: iconSize }} />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '5px' }}>
        <Typography component="span" sx={{ fontSize: 16, fontWeight: 500, color: INK }}>
          {title}
        </Typography>
        <Typography component="span" sx={{ fontSize: 14, lineHeight: '20px', color: MUTED }}>
          {copy}
        </Typography>
      </Box>
      <Box component="img" src="/icons/arrow-right-indigo.svg" alt="" sx={{ width: 18, height: 18, flexShrink: 0 }} />
    </ButtonBase>
  );
}

function BetweenRetros({ teamId }: { teamId: string }) {
  return (
    <Box component="section" aria-labelledby="between-retros-heading" sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <Typography component="h2" id="between-retros-heading" sx={{ fontSize: 16, fontWeight: 500, color: INK }}>
        Between retros
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing="16px">
        <ShortcutCard
          href={`/teams/${teamId}/actions`}
          icon="/icons/list-checks-indigo-20.svg"
          iconSize={20}
          title="Action Items"
          copy="Keep your team's next steps moving forward."
        />
        <ShortcutCard
          href={`/teams/${teamId}/retros`}
          icon="/icons/panels-top-left-indigo.svg"
          iconSize={24}
          title="Previous Retros"
          copy="Take a look at how far your team has come from where they started."
        />
      </Stack>
    </Box>
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
  const me = useMe(accessToken);
  // Retros are created in the user's first team, as before (a team switcher is a later story).
  const team = teams.data?.[0];

  // Signed out gets the full-page sign-in card, not an AppShell with one button in it — there's
  // no nav to show yet and nothing else on the page.
  if (!accessToken || !session) return <SignInPage />;

  // The profile's display name is the source of truth; until GET /me answers, the same Google
  // metadata the server derives it from stands in, so the greeting doesn't flash the email.
  const meta = session.user.user_metadata as { full_name?: string; name?: string } | undefined;
  const firstName = firstNameFor(me.data?.displayName ?? meta?.full_name ?? meta?.name, session.user.email);

  let panel: ReactNode;
  if (teams.isPending) {
    panel = (
      <Panel
        heading="Create a retro"
        copy="Pick a template to guide the conversation."
        body={<TemplateSkeletons />}
        form={<Skeleton variant="rounded" height={44} sx={{ borderRadius: '8px' }} />}
      />
    );
  } else if (teams.isError) {
    panel = (
      <Alert
        severity="error"
        action={
          <Button color="inherit" size="small" onClick={() => void teams.refetch()}>
            Retry
          </Button>
        }
      >
        Failed to load teams.
      </Alert>
    );
  } else if (team) {
    panel = <CreateRetroPanel accessToken={accessToken} teamId={team.id} />;
  } else {
    panel = <CreateTeamPanel accessToken={accessToken} />;
  }

  return (
    <AppShell fullWidth drawer={(collapsed) => <NavDrawerContent teamId={team?.id} collapsed={collapsed} />}>
      {/* Figma "Home workspace" (131:1250): 80px side padding at desktop, 36px top, 64px bottom,
          32px between sections, on the page's slate-50 background. */}
      <Box
        sx={{
          bgcolor: PAGE_BG,
          minHeight: '100vh',
          px: { xs: '16px', sm: '32px', lg: '80px' },
          pt: '36px',
          pb: '64px',
          display: 'flex',
          flexDirection: 'column',
          gap: '32px',
        }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <Typography component="h1" sx={{ fontSize: 32, fontWeight: 700, lineHeight: '40px', letterSpacing: '-0.6px', color: INK, overflowWrap: 'anywhere' }}>
            Welcome {firstName}
          </Typography>
          <Typography sx={{ fontSize: 16, lineHeight: '24px', color: MUTED }}>{TAGLINE}</Typography>
        </Box>
        {panel}
        {team && <BetweenRetros teamId={team.id} />}
      </Box>
    </AppShell>
  );
}
