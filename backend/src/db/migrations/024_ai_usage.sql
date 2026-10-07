-- AI usage widget. Collectors push aggregate quota windows and token counts with a
-- dedicated integration token; only its SHA-256 hash is stored. `providers` holds the
-- last snapshot per provider (see backend/src/aiUsage/snapshot.ts), validated by the
-- backend; the CHECK only bounds its shape and size. Admin API keys for the
-- server-side usage reports are stored encrypted in api_keys as anthropic_admin and
-- openai_admin.
CREATE TABLE IF NOT EXISTS ai_usage_reports (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE CHECK (token_hash IS NULL OR token_hash ~ '^[a-f0-9]{64}$'),
  token_created_at TIMESTAMPTZ,
  providers JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(providers) = 'object' AND octet_length(providers::text) <= 32000),
  received_at TIMESTAMPTZ
);
ALTER TABLE ai_usage_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ai_usage_reports FROM PUBLIC;
-- Supabase installations have these roles; alternate PostgREST installations
-- may grant access to their dedicated backend role instead.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ai_usage_reports FROM anon;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ai_usage_reports FROM authenticated;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ai_usage_reports TO service_role;
  END IF;
END $$;

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS show_ai_usage BOOLEAN NOT NULL DEFAULT false;
