ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS energy_price_settings jsonb NOT NULL DEFAULT '{"mode":"spot"}'::jsonb;

COMMENT ON COLUMN public.user_preferences.energy_price_settings IS
  'Electricity price basis: spot, or consumer variable-cost estimate with grid GLN, required tariff codes and retailer markup in ore/kWh excluding VAT.';
