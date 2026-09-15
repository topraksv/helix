-- 1.8.0: the sync change probe keeps no service-role RPC surface.
--
-- Migrations 32 and 38 revoked the probe from `public` and `anon` only. On the
-- hosted project the `postgres` role's default privileges also grant EXECUTE on
-- every new function to `service_role`, and the local stack's do not, so the
-- pgTAP assertion held locally and failed against the linked project. Measured
-- there on 2026-09-15: {postgres=X, service_role=X, authenticated=X}.
--
-- The probe keys on `auth.uid()`, so a service-role call reads nothing: this
-- closes a surface nobody uses rather than a leak. The same default applies to
-- any later function, so a revoke list names `service_role` explicitly.

begin;

revoke all on function public.sync_cursors() from service_role;

commit;
