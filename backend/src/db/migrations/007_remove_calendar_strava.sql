-- Remove ICS/Google Calendar and Strava integrations.
-- Cleans up databases that already ran migrations 003, 005, or 006
-- (those files have been deleted; fresh databases never create these).
ALTER TABLE user_preferences
  DROP COLUMN IF EXISTS show_calendar,
  DROP COLUMN IF EXISTS ics_calendar_url,
  DROP COLUMN IF EXISTS show_gcal,
  DROP COLUMN IF EXISTS gcal_calendar_id,
  DROP COLUMN IF EXISTS gcal_label,
  DROP COLUMN IF EXISTS show_strava,
  DROP COLUMN IF EXISTS strava_run_goal_km,
  DROP COLUMN IF EXISTS strava_ride_goal_km,
  DROP COLUMN IF EXISTS strava_elevation_goal_m;

DROP TABLE IF EXISTS oauth_connections;
