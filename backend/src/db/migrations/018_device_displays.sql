-- Presentation belongs to a device; integrations and credentials stay on its owner.
-- No backfill: an unconfigured device continues to use its owner's legacy settings.
ALTER TABLE public.devices ADD CONSTRAINT devices_id_user_id_key UNIQUE (id, user_id);
CREATE TABLE public.device_displays (
  device_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  layout jsonb CHECK (layout IS NULL OR jsonb_typeof(layout) = 'object'),
  display_schedule jsonb CHECK (display_schedule IS NULL OR jsonb_typeof(display_schedule) = 'object'),
  active_layout_id text CHECK (active_layout_id IS NULL OR active_layout_id ~ '^[A-Za-z0-9_-]{1,48}$'),
  display_profile jsonb CHECK (display_profile IS NULL OR jsonb_typeof(display_profile) = 'object'),
  display_timezone text NOT NULL DEFAULT 'Europe/Copenhagen' CHECK (length(display_timezone) BETWEEN 1 AND 64),
  refresh_interval_minutes integer NOT NULL DEFAULT 30 CHECK (refresh_interval_minutes BETWEEN 1 AND 1440),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT device_displays_device_owner_fkey FOREIGN KEY (device_id, owner_id)
    REFERENCES public.devices(id, user_id) ON DELETE CASCADE ON UPDATE CASCADE
);
ALTER TABLE public.device_displays ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.device_displays FROM anon, authenticated;
GRANT ALL ON public.device_displays TO service_role;

-- An administrative transfer must not revive settings from any previous owner.
CREATE FUNCTION public.clear_device_display_on_transfer() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.device_displays WHERE device_id = NEW.id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.clear_device_display_on_transfer() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER clear_device_display_on_transfer
AFTER UPDATE OF user_id ON public.devices
FOR EACH ROW WHEN (OLD.user_id IS DISTINCT FROM NEW.user_id)
EXECUTE FUNCTION public.clear_device_display_on_transfer();
