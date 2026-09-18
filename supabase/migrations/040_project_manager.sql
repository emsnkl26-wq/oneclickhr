-- 040_project_manager.sql — a project manager per project.
--
-- `manager_id` points at any profile in the SAME tenant (an org admin or an
-- employee). The foreign key is composite, 018-style, so a project is
-- structurally unable to name a manager from another workspace; the API also
-- re-checks it so the error is friendly rather than a constraint violation.
--
-- ON DELETE SET NULL (manager_id) — column-list form (PG15+) so removing the
-- person clears only the manager, never the project's own tenant_id.
--
-- No new policy is needed for visibility: `projects_select` already lets an
-- assigned employee read the project row, and `profiles_select` already lets
-- any active member read a colleague's directory card.
--
-- Placements (employee_assignments) need no change here: 022's
-- `my_assignments` view already exposes an employee's OWN rows with pay_rate
-- and without bill_rate, while the base table stays org-only.

alter table public.projects
  add column if not exists manager_id uuid;

do $$ begin
  alter table public.projects
    add constraint projects_manager_fk
    foreign key (manager_id, tenant_id)
    references public.profiles (id, tenant_id)
    on delete set null (manager_id);
exception when duplicate_object then null; end $$;

create index if not exists projects_manager_idx
  on public.projects (tenant_id, manager_id)
  where manager_id is not null;

comment on column public.projects.manager_id is
  'Project manager: a profile (org admin or employee) in the same tenant.';

notify pgrst, 'reload schema';
