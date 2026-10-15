-- Language of the words a device's display draws (widget labels, weekday and month
-- names). Presentation belongs to the device, like its time zone, so there is no
-- account-level column: a device without its own row, or a row written before this
-- migration, keeps drawing English.
ALTER TABLE public.device_displays
  ADD COLUMN IF NOT EXISTS display_language text NOT NULL DEFAULT 'en'
  CHECK (display_language IN ('en', 'da'));

COMMENT ON COLUMN public.device_displays.display_language IS
  'Display language for widget text: en or da; independent of news language and the web app language';

-- Run afterwards as a separate statement so PostgREST sees the new column:
-- NOTIFY pgrst, 'reload schema';
