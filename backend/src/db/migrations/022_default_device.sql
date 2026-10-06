-- The device the dashboard opens when no device is chosen in the URL.
-- No foreign key: users are copied before devices during database migration,
-- and the API returns the ID only while it is one of the user's devices, so a
-- deleted or reassigned device is never offered as a default.
ALTER TABLE users ADD COLUMN IF NOT EXISTS default_device_id UUID;
