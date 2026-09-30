/** RN-012: the client keeps a clock offset rather than trusting its own clock or polling the
 * server every second ("no per-second ticks"). Computed once, from the board's `serverTime`
 * (GET /board's response) against the local clock at the moment it arrived. */
export function computeClockOffsetMs(serverTimeIso: string, localNowMs: number = Date.now()): number {
  return new Date(serverTimeIso).getTime() - localNowMs;
}

/** Milliseconds remaining until `phaseDeadlineIso`, estimated against the server's clock via the
 * offset — not the caller's own `Date.now()` directly, which is exactly what makes two browsers
 * with clocks seconds apart agree on the same remaining time. Null in, null out: a phase with no
 * timer (setup, closed) has nothing to count down. Can go negative once the deadline has passed
 * — callers clamp for display (see `formatCountdown`) but a negative value is what signals "the
 * timer has hit zero" to the alert logic. */
export function remainingMs(phaseDeadlineIso: string | null, clockOffsetMs: number, localNowMs: number = Date.now()): number | null {
  if (phaseDeadlineIso === null) return null;
  const estimatedServerNow = localNowMs + clockOffsetMs;
  return new Date(phaseDeadlineIso).getTime() - estimatedServerNow;
}

/** `m:ss`, clamped at zero — never counts past 00:00 or into negative minutes on screen. */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
