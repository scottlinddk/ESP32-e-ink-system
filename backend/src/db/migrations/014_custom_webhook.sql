-- The backend service role is the only data path; no client RLS policies.
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
-- Supabase installations have these roles; alternate PostgREST installations
-- may grant access to their dedicated backend role instead.
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
