/** Avatar and column color helpers, shared by the board (BoardPage.tsx) and the Discuss screen
 * (DiscussScreen.tsx) — kept in their own module so the two don't import each other. */

/** RN-044: first letter of up to the first two words — "Ada Lovelace" -> "AL", "Cher" -> "C". A
 * pure function so the truncation logic (here and in OnlineAvatarStack below) is unit-testable
 * without a live Presence connection. */
export function initialsFor(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  const letters = (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '');
  return letters.toUpperCase();
}

/** A stable hash of `id` into one of `palette`'s entries — same id always picks the same color
 * (across reconnects/resyncs), different ids spread across the palette without any per-user
 * state. Shared by colorForId (avatars) and cardColorForId (cards) below, each with their own
 * palette rather than one color meaning two different things. */
function pickFromPalette(id: string, palette: string[]): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return palette[Math.abs(hash) % palette.length]!;
}

/** RN-044: every MUI Avatar with no `src` renders the same gray by default (found live — every
 * participant looked identical). No avatar-image infra exists yet. Matches the Figma design's own
 * 6-color avatar set (Coral/Teal/Indigo/Rose/Violet/Amber). */
const AVATAR_PALETTE = ['#C2410C', '#0F766E', '#4338CA', '#BE123C', '#6D28D9', '#B45309'];

export function colorForId(id: string): string {
  return pickFromPalette(id, AVATAR_PALETTE);
}

/** Figma's sticky-note palette, keyed by `column.color` (a named keyword — "green"/"pink"/
 * "yellow"/"blue"/"purple" — stored on the column itself, seeded from the template or, for
 * Action items, hard-coded server-side; see retros.ts). `accent` is the small header dot /
 * group-border color; `card` is the sticky-note background, both pulled from the design's exact
 * hex values where given — "purple" never appears in the design (no 4-column template was in the
 * captured frames), so its pair is this file's own extrapolation to match the same pastel
 * family, not a value from Figma. Falls back to treating an unrecognized name as a literal CSS
 * color for both (keeps working if a template ever adds a color outside this set). */
const COLUMN_PALETTE: Record<string, { accent: string; card: string }> = {
  green: { accent: '#16A34A', card: '#C9F2D3' },
  pink: { accent: '#E11D48', card: '#FFD3DE' },
  yellow: { accent: '#CA8A04', card: '#FFF0A3' },
  blue: { accent: '#2563EB', card: '#CFE3FF' },
  purple: { accent: '#7C3AED', card: '#E6D9FF' },
};

export function columnPalette(colorName: string): { accent: string; card: string } {
  return COLUMN_PALETTE[colorName] ?? { accent: colorName, card: colorName };
}
