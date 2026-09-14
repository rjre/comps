/**
 * Milliseconds until the next occurrence of `hour` (0-23, local time) —
 * later today if it hasn't happened yet, otherwise tomorrow. Kept pure and
 * separate from the worker's loop so it's testable without waiting on a
 * real clock.
 */
export function msUntilNextHour(hour: number, now = new Date()): number {
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}
