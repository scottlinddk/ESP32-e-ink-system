-- Safe to reapply after later schema migrations. Do not grant all future tables.
REVOKE ALL ON DATABASE eink FROM anon, authenticated;
REVOKE ALL ON SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated, eink_authenticator, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated, eink_authenticator, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated, eink_authenticator, service_role;
REVOKE ALL ON SCHEMA migration_control FROM PUBLIC, anon, authenticated, eink_authenticator, service_role;
GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.users, public.user_preferences, public.api_keys, public.devices,
  public.firmware_versions, public.api_usage, public.custom_webhooks,
  public.device_delivery, public.orders
TO service_role;
-- UUID defaults use pg_catalog.gen_random_uuid(); no sequence/RPC grants needed.
-- Existing update triggers keep working; callers cannot invoke trigger functions.
ALTER ROLE service_role SET statement_timeout = '15s';
ALTER ROLE eink_authenticator SET statement_timeout = '15s';
NOTIFY pgrst, 'reload schema';
