-- A request remains pending until the device reports successful application.
-- Keep its ID/timestamps after acknowledgement so the owner can see the result.
ALTER TABLE public.device_delivery
  ADD COLUMN refresh_request_id uuid,
  ADD COLUMN refresh_requested_at timestamptz,
  ADD COLUMN refresh_applied_at timestamptz;
