import { createTheme } from '@mui/material/styles';

/**
 * MUI theme: primary blue matches the app's existing accent (#2563eb, used for buttons/links
 * before this redesign); secondary amber matches the existing highlight color (#f59e0b, used for
 * votes/warnings). No brand identity existed beyond those two colors — everything else here is
 * MUI's own sensible defaults (spacing, elevation, typography).
 */
export const theme = createTheme({
  palette: {
    primary: { main: '#2563eb' },
    secondary: { main: '#f59e0b' },
    background: { default: '#f8fafc' },
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: 'Roboto, system-ui, sans-serif',
  },
  components: {
    MuiButton: { defaultProps: { disableElevation: true } },
  },
});
