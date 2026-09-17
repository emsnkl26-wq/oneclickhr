-- ============================================================================
-- 036_tenants_tracking_mode_grant.sql — the missing grant behind "You do not
-- have permission to do that." on every single Workspace settings save.
--
-- 013_domain_verification.sql revoked blanket UPDATE on `tenants` and
-- re-granted it column by column, exactly so a browser session could never
-- rewrite the domain-verification columns. 025_tracking_mode.sql then added
-- `tenants.default_tracking_mode` and granted it SELECT (029) so the org-side
-- Settings page can show it — but never granted UPDATE. The Workspace form
-- (src/app/org/settings/settings-form.tsx) sends `defaultTrackingMode` on
-- EVERY submit, so `PATCH /api/org/settings` failed with Postgres's column
-- privilege error (42501) on every save, not just ones that changed it.
--
-- Re-runnable.
-- ============================================================================

grant update (default_tracking_mode) on public.tenants to authenticated;
