/**
 * @file data/clock.ts
 * Single source of "today" for the agent and tools.
 *
 * Defaults to the real current date at the trial site (US Eastern time).
 * Set DEMO_TODAY=YYYY-MM-DD to pin it, e.g. for tests or a rehearsed demo.
 */

export const SITE_TIMEZONE = 'America/New_York';

/** Today's date at the trial site as YYYY-MM-DD. */
export function today(): string {
  if (process.env.DEMO_TODAY) return process.env.DEMO_TODAY;
  // en-CA formats dates as YYYY-MM-DD.
  return new Date().toLocaleDateString('en-CA', { timeZone: SITE_TIMEZONE });
}
