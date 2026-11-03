/** RN-062: the "Welcome <first name>" greeting. The first name is the first word of the profile's
 * display name; when there's no usable one it falls back to the local part of the email (the bit
 * before "@").
 *
 * The server's own fallback for a Google account with no name is the email itself (see
 * apps/api/src/auth/token.ts), so a display name that *is* an email counts as "no name" here
 * too — "Welcome ada@example.com" is exactly what the fallback exists to avoid. */
export function firstNameFor(displayName: string | null | undefined, email: string | null | undefined): string {
  const name = displayName?.trim() ?? '';
  if (name && !name.includes('@')) return name.split(/\s+/)[0]!;
  const localPart = (email ?? '').split('@')[0]?.trim() ?? '';
  return localPart;
}
