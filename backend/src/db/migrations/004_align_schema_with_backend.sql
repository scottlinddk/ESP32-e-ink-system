-- Migration: align Supabase schema with what the backend expects.
-- The Supabase project was provisioned with a different schema version
-- than the git migration files define. This closes the gaps.

-- devices: add missing columns the backend inserts/reads
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS device_id TEXT,
  ADD COLUMN IF NOT EXISTS device_name TEXT;

-- devices: unique index for getDeviceByDeviceId lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_device_id
  ON devices (device_id)
  WHERE device_id IS NOT NULL;

-- devices: screen_profile_id was NOT NULL which crashes createDevice
--          (the backend never supplies it)
ALTER TABLE devices
  ALTER COLUMN screen_profile_id DROP NOT NULL;

-- api_keys: upsert uses onConflict:'user_id,provider' — needs a unique constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.api_keys'::regclass
      AND contype = 'u'
      AND conname = 'api_keys_user_id_provider_key'
  ) THEN
    ALTER TABLE api_keys
      ADD CONSTRAINT api_keys_user_id_provider_key UNIQUE (user_id, provider);
  END IF;
END $$;

-- firmware_versions: is_default is an optional field on the TypeScript type
ALTER TABLE firmware_versions
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT false;
