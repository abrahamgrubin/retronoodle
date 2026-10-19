import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card as MuiCard,
  Divider,
  FormControl,
  FormLabel,
  Stack,
  SvgIcon,
  TextField,
  Typography,
} from '@mui/material';
import { styled } from '@mui/material/styles';
import { signInWithGoogle, signInWithPassword } from './auth';
import { supabase } from './supabaseClient';

/** MUI's own sign-in template (docs/data/material/getting-started/templates/sign-in, v9.5.0),
 * minus the parts with nothing behind them here: no Facebook button, no "Sign up" link (accounts
 * come from Google or a join link), no "Remember me" (supabase-js persists the session either
 * way) and no "Forgot password" (no email flow is configured). AppTheme/CssBaseline/
 * ColorModeSelect are dropped too — main.tsx already wraps the whole app in ThemeProvider. */
const Card = styled(MuiCard)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  alignSelf: 'center',
  width: '100%',
  padding: theme.spacing(4),
  gap: theme.spacing(2),
  margin: 'auto',
  [theme.breakpoints.up('sm')]: {
    maxWidth: '450px',
  },
  boxShadow: 'hsla(220, 30%, 5%, 0.05) 0px 5px 15px 0px, hsla(220, 25%, 10%, 0.05) 0px 15px 35px -5px',
}));

const SignInContainer = styled(Stack)(({ theme }) => ({
  minHeight: '100dvh',
  padding: theme.spacing(2),
  [theme.breakpoints.up('sm')]: {
    padding: theme.spacing(4),
  },
  '&::before': {
    content: '""',
    display: 'block',
    position: 'absolute',
    zIndex: -1,
    inset: 0,
    backgroundImage: 'radial-gradient(ellipse at 50% 50%, hsl(210, 100%, 97%), hsl(0, 0%, 100%))',
    backgroundRepeat: 'no-repeat',
  },
}));

/** The template's own GoogleIcon, inlined — it's the only one of its CustomIcons this page uses. */
function GoogleIcon() {
  return (
    <SvgIcon>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path
          d="M15.68 8.18182C15.68 7.61455 15.6291 7.06909 15.5345 6.54545H8V9.64364H12.3055C12.1164 10.64 11.5491 11.4836 10.6982 12.0509V14.0655H13.2945C14.8073 12.6691 15.68 10.6182 15.68 8.18182Z"
          fill="#4285F4"
        />
        <path
          d="M8 16C10.16 16 11.9709 15.2873 13.2945 14.0655L10.6982 12.0509C9.98545 12.5309 9.07636 12.8218 8 12.8218C5.92 12.8218 4.15273 11.4182 3.52 9.52727H0.858182V11.5927C2.17455 14.2036 4.87273 16 8 16Z"
          fill="#34A853"
        />
        <path
          d="M3.52 9.52C3.36 9.04 3.26545 8.53091 3.26545 8C3.26545 7.46909 3.36 6.96 3.52 6.48V4.41455H0.858182C0.312727 5.49091 0 6.70545 0 8C0 9.29455 0.312727 10.5091 0.858182 11.5855L2.93091 9.97091L3.52 9.52Z"
          fill="#FBBC05"
        />
        <path
          d="M8 3.18545C9.17818 3.18545 10.2255 3.59273 11.0618 4.37818L13.3527 2.08727C11.9636 0.792727 10.16 0 8 0C4.87273 0 2.17455 1.79636 0.858182 4.41455L3.52 6.48C4.15273 4.58909 5.92 3.18545 8 3.18545Z"
          fill="#EA4335"
        />
      </svg>
    </SvgIcon>
  );
}

/** The email/password half of the card, rendered only in dev (`import.meta.env.DEV`, the same
 * gate supabaseClient.ts's own Playwright hook uses — false in a production build, so this never
 * ships). It exists because a local Supabase stack has no Google provider configured, which would
 * otherwise leave no way at all to sign in against one. Credentials come from supabase/seed.sql. */
function DevEmailSignIn() {
  const [email, setEmail] = useState('demo@retronoodle.com');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function validate(): boolean {
    const nextEmailError = /\S+@\S+\.\S+/.test(email) ? '' : 'Please enter a valid email address.';
    const nextPasswordError = password.length >= 6 ? '' : 'Password must be at least 6 characters long.';
    setEmailError(nextEmailError);
    setPasswordError(nextPasswordError);
    return !nextEmailError && !nextPasswordError;
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await signInWithPassword(email, password);
      // No navigation: useSession's own onAuthStateChange listener re-renders whoever mounted
      // this page the moment the session lands.
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Sign-in failed.');
      setSubmitting(false);
    }
  }

  return (
    <>
      <Box component="form" onSubmit={submit} noValidate sx={{ display: 'flex', flexDirection: 'column', width: '100%', gap: 2 }}>
        {submitError && <Alert severity="error">{submitError}</Alert>}
        <FormControl>
          <FormLabel htmlFor="email">Email</FormLabel>
          <TextField
            error={!!emailError}
            helperText={emailError}
            id="email"
            type="email"
            name="email"
            placeholder="your@email.com"
            autoComplete="email"
            autoFocus
            required
            fullWidth
            variant="outlined"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </FormControl>
        <FormControl>
          <FormLabel htmlFor="password">Password</FormLabel>
          <TextField
            error={!!passwordError}
            helperText={passwordError}
            id="password"
            type="password"
            name="password"
            placeholder="••••••"
            autoComplete="current-password"
            required
            fullWidth
            variant="outlined"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </FormControl>
        <Button type="submit" fullWidth variant="contained" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </Box>
      <Divider>or</Divider>
    </>
  );
}

/** RN-003's sign-in screen. `title` lets a page that needs its own framing (a join link, say)
 * say why you're being asked to sign in, rather than this hardcoding one context. */
export function SignInPage({ title = 'Sign in' }: { title?: string }) {
  return (
    <SignInContainer direction="column" sx={{ justifyContent: 'center' }}>
      <Card variant="outlined">
        <Typography component="h1" variant="h4" sx={{ width: '100%', fontSize: 'clamp(2rem, 10vw, 2.15rem)' }}>
          {title}
        </Typography>
        {!supabase && <Alert severity="error">Supabase is not configured (see .env.example).</Alert>}
        {import.meta.env.DEV && supabase && <DevEmailSignIn />}
        <Button fullWidth variant="outlined" startIcon={<GoogleIcon />} disabled={!supabase} onClick={() => void signInWithGoogle()}>
          Sign in with Google
        </Button>
      </Card>
    </SignInContainer>
  );
}
