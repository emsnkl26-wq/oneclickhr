-- ============================================================================
-- 037_jobs_org_isolation.sql — an org sees ITS OWN jobs, nobody else's.
--
-- 015's `jobs_select` had a third clause letting ANY active member read every
-- tenant's PUBLISHED jobs, so employees can browse openings elsewhere. Org
-- users are active members too, so /org/jobs listed other companies' roles
-- (with their applicant counts) next to the workspace's own.
--
-- The cross-tenant clause now applies to employees only. Org users keep full
-- access to their own tenant (drafts included); the public portal reads with
-- the service role and is unaffected. Applications were already scoped by
-- `job_applications_select`.
--
-- Re-runnable.
-- ============================================================================

drop policy if exists jobs_select on public.jobs;
create policy jobs_select on public.jobs for select to authenticated
using (
  (select app.is_super_admin())
  or (tenant_id = (select app.current_tenant_id()) and (select app.is_org()))
  or (status = 'published' and (select app.is_employee()) and (select app.is_active_member()))
);
