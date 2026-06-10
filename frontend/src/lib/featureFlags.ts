/* =========================================================================
   featureFlags.ts — toggle integrations on/off
   Flip a flag to true to re-enable the integration's UI everywhere.
   ========================================================================= */

export const FEATURES = {
  strava: false,
  googleCalendar: false,
} as const;
