-- Device tokens/telemetry are service-only. The legacy devices policies must
-- never expose credential hashes through SELECT * to browser clients.
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
