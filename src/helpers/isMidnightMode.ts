// Midnight mode runs from 00:00 up to (not including) 06:00 on the screen's
// local clock. During that window the plain black background is swapped for
// the animated seascape.
export const MIDNIGHT_MODE_END_HOUR = 6;

export const isMidnightMode = (now: Date): boolean =>
  now.getHours() < MIDNIGHT_MODE_END_HOUR;
