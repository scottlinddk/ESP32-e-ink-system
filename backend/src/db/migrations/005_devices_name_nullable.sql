-- Migration: make devices.name nullable.
-- The Supabase devices table uses 'name' but the backend writes 'device_name'.
-- Both columns now exist; name must be nullable so inserts that only
-- provide device_name don't fail a NOT NULL constraint.
ALTER TABLE devices ALTER COLUMN name DROP NOT NULL;
