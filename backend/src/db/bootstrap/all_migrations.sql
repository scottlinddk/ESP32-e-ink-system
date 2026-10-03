-- ============================================================
-- ESP32 e-ink system: combined migrations (001 to 019)
-- Source: backend/src/db/migrations/ @ b1cec65
-- Run ONCE against an EMPTY Supabase database (SQL Editor).
-- Everything runs in one transaction: if a step fails, all is rolled back.
-- Not idempotent (CREATE POLICY/TRIGGER, 015, 018, 019): empty database only.
-- Keep in sync with the individual migration files.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 001_initial.sql
-- ------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  show_energy_price BOOLEAN DEFAULT true,
  show_weather BOOLEAN DEFAULT true,
  show_news BOOLEAN DEFAULT true,
  show_air_quality BOOLEAN DEFAULT false,
  energy_price_location TEXT DEFAULT 'DK1',
  weather_location TEXT DEFAULT '55.3,10.4',
  news_language TEXT DEFAULT 'da',
  refresh_interval_minutes INT DEFAULT 30,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(user_id)
);
CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON user_preferences(user_id);

CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  api_key TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(user_id, provider)
);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);

CREATE TABLE IF NOT EXISTS devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT UNIQUE NOT NULL,
  device_name TEXT DEFAULT 'My Display',
  license_key TEXT UNIQUE NOT NULL,
  firmware_version TEXT DEFAULT '1.0.0',
  last_seen_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id);
CREATE INDEX IF NOT EXISTS idx_devices_license_key ON devices(license_key);
CREATE INDEX IF NOT EXISTS idx_devices_device_id ON devices(device_id);

CREATE TABLE IF NOT EXISTS firmware_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  download_path TEXT NOT NULL,
  checksum TEXT,
  release_notes TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_firmware_versions_user_id ON firmware_versions(user_id);
CREATE INDEX IF NOT EXISTS idx_firmware_versions_active ON firmware_versions(user_id, active);

CREATE TABLE IF NOT EXISTS api_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT,
  called_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_api_usage_user_id ON api_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_called_at ON api_usage(called_at);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_charge_id TEXT,
  amount_cents INT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_stripe_charge_id ON orders(stripe_charge_id);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- NOTE: The backend uses the service_role key which bypasses RLS.
CREATE POLICY "users_select_own" ON users
  FOR SELECT USING (true);
CREATE POLICY "users_insert_own" ON users
  FOR INSERT WITH CHECK (true);
CREATE POLICY "users_update_own" ON users
  FOR UPDATE USING (true);
CREATE POLICY "prefs_all" ON user_preferences
  FOR ALL USING (true);
CREATE POLICY "api_keys_all" ON api_keys
  FOR ALL USING (true);
CREATE POLICY "devices_all" ON devices
  FOR ALL USING (true);
CREATE POLICY "api_usage_all" ON api_usage
  FOR ALL USING (true);
CREATE POLICY "orders_all" ON orders
  FOR ALL USING (true);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_user_preferences_updated_at
  BEFORE UPDATE ON user_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_devices_updated_at
  BEFORE UPDATE ON devices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- 002_ev_integrations.sql
-- ------------------------------------------------------------
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS show_monta BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS show_zaptec BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS monta_fields JSONB DEFAULT '["charger_status","active_session"]',
  ADD COLUMN IF NOT EXISTS zaptec_fields JSONB DEFAULT '["charger_status","active_session"]';

-- ------------------------------------------------------------
-- 002_layout.sql
-- ------------------------------------------------------------
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS layout JSONB DEFAULT NULL;

-- ------------------------------------------------------------
-- 004_notion.sql
-- ------------------------------------------------------------
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS show_notion BOOLEAN DEFAULT false;

-- ------------------------------------------------------------
-- 007_remove_calendar_strava.sql
-- (no-op on a fresh database; 012 adds the calendar columns again)
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 008_opendisplay.sql
-- ------------------------------------------------------------
ALTER TABLE devices ADD COLUMN IF NOT EXISTS ble_name TEXT;
CREATE INDEX IF NOT EXISTS idx_devices_ble_name ON devices(ble_name);
ALTER TABLE devices ALTER COLUMN license_key DROP NOT NULL;

-- ------------------------------------------------------------
-- 009_display_profile.sql
-- ------------------------------------------------------------
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS display_profile jsonb;
COMMENT ON COLUMN user_preferences.display_profile IS 'Native monochrome dimensions and clockwise content rotation; null uses legacy 250x122';

-- ------------------------------------------------------------
-- 010_rss.sql
-- ------------------------------------------------------------
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS news_source TEXT NOT NULL DEFAULT 'newsapi' CHECK (news_source IN ('newsapi', 'rss')),
  ADD COLUMN IF NOT EXISTS news_feed_url TEXT NOT NULL DEFAULT '' CHECK (length(news_feed_url) <= 2048),
  ADD COLUMN IF NOT EXISTS news_item_limit INTEGER NOT NULL DEFAULT 3 CHECK (news_item_limit BETWEEN 1 AND 10);

-- ------------------------------------------------------------
-- 011_custom_content.sql
-- ------------------------------------------------------------
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS show_custom_text BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS custom_text TEXT NOT NULL DEFAULT '' CHECK (char_length(custom_text) <= 2000),
  ADD COLUMN IF NOT EXISTS show_custom_image BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS custom_image JSONB CHECK (custom_image IS NULL OR (
    jsonb_typeof(custom_image) = 'object' AND octet_length(custom_image::text) <= 45000
  ));

-- ------------------------------------------------------------
-- 012_calendar.sql
-- ------------------------------------------------------------
ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS show_calendar boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS calendar_timezone text NOT NULL DEFAULT 'Europe/Copenhagen',
  ADD COLUMN IF NOT EXISTS calendar_days integer NOT NULL DEFAULT 7 CHECK (calendar_days BETWEEN 1 AND 30),
  ADD COLUMN IF NOT EXISTS calendar_item_limit integer NOT NULL DEFAULT 5 CHECK (calendar_item_limit BETWEEN 1 AND 10);

-- ------------------------------------------------------------
-- 013_display_schedule.sql
-- ------------------------------------------------------------
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS display_schedule JSONB DEFAULT NULL;

-- ------------------------------------------------------------
-- 014_custom_webhook.sql
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS custom_webhooks (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE CHECK (token_hash IS NULL OR token_hash ~ '^[a-f0-9]{64}$'),
  token_created_at TIMESTAMPTZ,
  rows JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(rows) = 'array' AND jsonb_array_length(rows) <= 12 AND octet_length(rows::text) <= 16000),
  observed_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ
);
ALTER TABLE custom_webhooks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON custom_webhooks FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON custom_webhooks FROM anon;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON custom_webhooks FROM authenticated;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON custom_webhooks TO service_role;
  END IF;
END $$;

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS show_custom_webhook BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS custom_webhook_ttl_minutes INTEGER NOT NULL DEFAULT 60 CHECK (custom_webhook_ttl_minutes BETWEEN 1 AND 1440);

-- ------------------------------------------------------------
-- 015_device_delivery.sql
-- ------------------------------------------------------------
CREATE TABLE public.device_delivery (
  device_id uuid PRIMARY KEY REFERENCES public.devices(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash text CHECK (token_hash IS NULL OR token_hash ~ '^[0-9a-f]{64}$'),
  rotated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  last_seen_at timestamptz,
  firmware_version text,
  battery_percent double precision CHECK (battery_percent BETWEEN 0 AND 100),
  rssi integer CHECK (rssi BETWEEN -150 AND 0),
  last_applied_hash text CHECK (last_applied_hash IS NULL OR last_applied_hash ~ '^[0-9a-f]{64}$')
);
ALTER TABLE public.device_delivery ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.device_delivery FROM anon, authenticated;
GRANT ALL ON public.device_delivery TO service_role;

-- ------------------------------------------------------------
-- 016_display_timezone.sql
-- ------------------------------------------------------------
ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS display_timezone text NOT NULL DEFAULT 'Europe/Copenhagen';

COMMENT ON COLUMN public.user_preferences.display_timezone IS
  'IANA time zone for the display status clock; calendar and quiet hours use their own settings';

-- ------------------------------------------------------------
-- 017_energy_price_settings.sql
-- ------------------------------------------------------------
ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS energy_price_settings jsonb NOT NULL DEFAULT '{"mode":"spot"}'::jsonb;

COMMENT ON COLUMN public.user_preferences.energy_price_settings IS
  'Electricity price basis: spot, or consumer variable-cost estimate with grid GLN, required tariff codes and retailer markup in ore/kWh excluding VAT.';

-- ------------------------------------------------------------
-- 018_device_displays.sql
-- ------------------------------------------------------------
ALTER TABLE public.devices ADD CONSTRAINT devices_id_user_id_key UNIQUE (id, user_id);
CREATE TABLE public.device_displays (
  device_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  layout jsonb CHECK (layout IS NULL OR jsonb_typeof(layout) = 'object'),
  display_schedule jsonb CHECK (display_schedule IS NULL OR jsonb_typeof(display_schedule) = 'object'),
  active_layout_id text CHECK (active_layout_id IS NULL OR active_layout_id ~ '^[A-Za-z0-9_-]{1,48}$'),
  display_profile jsonb CHECK (display_profile IS NULL OR jsonb_typeof(display_profile) = 'object'),
  display_timezone text NOT NULL DEFAULT 'Europe/Copenhagen' CHECK (length(display_timezone) BETWEEN 1 AND 64),
  refresh_interval_minutes integer NOT NULL DEFAULT 30 CHECK (refresh_interval_minutes BETWEEN 1 AND 1440),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT device_displays_device_owner_fkey FOREIGN KEY (device_id, owner_id)
    REFERENCES public.devices(id, user_id) ON DELETE CASCADE ON UPDATE CASCADE
);
ALTER TABLE public.device_displays ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.device_displays FROM anon, authenticated;
GRANT ALL ON public.device_displays TO service_role;

CREATE FUNCTION public.clear_device_display_on_transfer() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.device_displays WHERE device_id = NEW.id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.clear_device_display_on_transfer() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER clear_device_display_on_transfer
AFTER UPDATE OF user_id ON public.devices
FOR EACH ROW WHEN (OLD.user_id IS DISTINCT FROM NEW.user_id)
EXECUTE FUNCTION public.clear_device_display_on_transfer();

-- ------------------------------------------------------------
-- 019_device_refresh.sql
-- ------------------------------------------------------------
ALTER TABLE public.device_delivery
  ADD COLUMN refresh_request_id uuid,
  ADD COLUMN refresh_requested_at timestamptz,
  ADD COLUMN refresh_applied_at timestamptz;

COMMIT;

-- Run afterwards as a separate statement so PostgREST sees the new tables:
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- RECOMMENDED (not part of the repo migrations, commented out):
-- 001 grants anon/authenticated full access (USING (true)) to users,
-- api_keys, devices etc. If the anon key is public, it can read api_keys.
-- The backend uses service_role and does not need these policies.
-- Remove them after the migration:
--
-- DROP POLICY "users_select_own" ON users;
-- DROP POLICY "users_insert_own" ON users;
-- DROP POLICY "users_update_own" ON users;
-- DROP POLICY "prefs_all" ON user_preferences;
-- DROP POLICY "api_keys_all" ON api_keys;
-- DROP POLICY "devices_all" ON devices;
-- DROP POLICY "api_usage_all" ON api_usage;
-- DROP POLICY "orders_all" ON orders;
-- ============================================================
