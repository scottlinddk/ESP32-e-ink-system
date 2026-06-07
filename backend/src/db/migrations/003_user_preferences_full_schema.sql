-- Migration: add all backend-expected columns to user_preferences.
-- The Supabase project was provisioned with a minimal table
-- (only default_timezone / default_price_area). This adds the full
-- set the backend reads and writes.
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS show_energy_price BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_weather BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_news BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_calendar BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS show_air_quality BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS energy_price_location TEXT DEFAULT 'DK1',
  ADD COLUMN IF NOT EXISTS weather_location TEXT DEFAULT '55.3,10.4',
  ADD COLUMN IF NOT EXISTS news_language TEXT DEFAULT 'da',
  ADD COLUMN IF NOT EXISTS refresh_interval_minutes INT DEFAULT 30,
  ADD COLUMN IF NOT EXISTS layout JSONB DEFAULT NULL;
