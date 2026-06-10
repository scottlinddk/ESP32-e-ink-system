CREATE TABLE IF NOT EXISTS oauth_connections (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL,
  access_token        TEXT NOT NULL,
  refresh_token       TEXT,
  expires_at          TIMESTAMPTZ,
  provider_account_id TEXT,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_oauth_connections_user_id ON oauth_connections(user_id);

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS show_strava            BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS strava_run_goal_km     INTEGER,
  ADD COLUMN IF NOT EXISTS strava_ride_goal_km    INTEGER,
  ADD COLUMN IF NOT EXISTS strava_elevation_goal_m INTEGER;
