-- OpenDisplay migration: swap license-key pairing for BLE-name-based device identity.
-- Devices are now identified by their BLE advertisement name (OD + chip-ID hex).

ALTER TABLE devices ADD COLUMN IF NOT EXISTS ble_name TEXT;
CREATE INDEX IF NOT EXISTS idx_devices_ble_name ON devices(ble_name);

-- Make license_key nullable so existing rows stay valid while new OpenDisplay
-- devices have no license key.
ALTER TABLE devices ALTER COLUMN license_key DROP NOT NULL;
