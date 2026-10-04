-- Opt-in per device: the firmware keeps Wi-Fi online and checks for screen
-- update requests every few seconds instead of deep sleeping between frames.
-- Intended for USB-powered panels; the default preserves battery behaviour.
ALTER TABLE public.device_delivery
  ADD COLUMN instant_updates boolean NOT NULL DEFAULT false;
