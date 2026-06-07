-- ESP32 Display SaaS — EV Integration Migration
-- Adds Monta and Zaptec EV charging integration support

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS show_monta BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS show_zaptec BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS monta_fields JSONB DEFAULT '["charger_status","active_session"]',
  ADD COLUMN IF NOT EXISTS zaptec_fields JSONB DEFAULT '["charger_status","active_session"]';
