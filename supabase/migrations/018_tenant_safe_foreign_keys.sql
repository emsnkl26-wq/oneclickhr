-- ============================================================================
-- 018_tenant_safe_foreign_keys.sql — make a child row structurally unable to
-- point at another tenant's parent.
--
-- THE HOLE THIS CLOSES. `npm run test:isolation` caught it:
--
--     ✗ Org A cannot smuggle its own tenant_id onto a Tenant B board
--         WRITE SUCCEEDED across the tenant boundary
--
-- The tasks INSERT policy (002_rls.sql) reads:
--
--     with check (tenant_id = app.current_tenant_id() and app.is_org())
--
-- which is a complete check of the column it looks at and no check at all of
-- the ones it does not. Org A inserting `tenant_id = A, board_id = <B's board>`
-- is telling the TRUTH about its own tenant, so the predicate passes. The
-- foreign key then only asks whether that board EXISTS — never whose it is.
-- The result is a row in A's tenant hanging off B's board.
--
-- WHY A CONSTRAINT AND NOT A BETTER POLICY. A policy could be taught to check
-- the parent, and the same mistake could then be made again by the next policy
-- anyone writes. More importantly a policy binds only `authenticated`: the
-- service-role client used by the API routes and cron bypasses RLS entirely,
-- so a policy fix would leave every server-side write path still able to do it
-- by accident. A composite foreign key binds EVERY writer, including the
-- service role and including psql, and it cannot be forgotten later because it
-- is part of the table's shape.
--
-- HOW IT WORKS. The parent gains a UNIQUE (id, tenant_id) — redundant on its
-- own, since `id` is already unique, but it is what lets a foreign key target
-- the PAIR. The child's key then carries tenant_id along:
--
--     foreign key (board_id, tenant_id) references boards (id, tenant_id)
--
-- so "this board, in MY tenant" is the only thing that satisfies it. Pointing
-- at B's board while claiming tenant A now has no matching parent row and is
-- rejected by the database itself.
--
-- COST AT RUNTIME: none worth measuring. The check is the same index lookup the
-- single-column key already performed, against a two-column index instead.
--
-- NULLABLE CHILD KEYS are handled by the default MATCH SIMPLE semantics: when
-- any column of the key is NULL the constraint is not enforced, which is what
-- `timesheet_entries.project_id` (an entry with no project) already relies on.
--
-- NOT INCLUDED: job_applications.job_id -> jobs.id. Both sides' tenant_id are
-- NULLABLE by design there (a platform job belongs to no tenant), so a
-- composite key would silently not apply to exactly the rows worth protecting.
-- That table is also written by the PUBLIC apply flow rather than by a tenant
-- user, so it is a different threat model and wants its own thinking.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Refuse to run if the data already violates what we are about to enforce.
--
-- Adding the constraint would fail anyway; this fails FIRST with a message that
-- says which rows and why, instead of a bare constraint-violation error. Rows
-- like this are illegitimate by definition, but deleting a customer's data from
-- inside a migration is not this file's decision to make.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad   integer := 0;
  v_total integer := 0;
  r       record;
begin
  for r in
    select * from (values
      ('board_columns',     'board_id',     'boards'),
      ('tasks',             'board_id',     'boards'),
      ('tasks',             'column_id',    'board_columns'),
      ('project_assignments','project_id',  'projects'),
      ('timesheet_entries', 'timesheet_id', 'timesheets'),
      ('timesheet_entries', 'project_id',   'projects'),
      ('ticket_messages',   'ticket_id',    'tickets')
    ) as t(child, col, parent)
  loop
    execute format(
      'select count(*) from public.%I c join public.%I p on p.id = c.%I
        where c.%I is not null and c.tenant_id is distinct from p.tenant_id',
      r.child, r.parent, r.col, r.col
    ) into v_bad;

    if v_bad > 0 then
      raise warning '[018] %.% has % row(s) pointing at a % in another tenant',
        r.child, r.col, v_bad, r.parent;
      v_total := v_total + v_bad;
    end if;
  end loop;

  if v_total > 0 then
    raise exception
      '[018] % cross-tenant row(s) exist; review and remove them, then re-run. '
      'The warnings above name each table. If these came from the isolation '
      'test, deleting the two demo tenants removes them by cascade.', v_total;
  end if;

  raise notice '[018] no cross-tenant rows — safe to add the constraints';
end $$;

-- ---------------------------------------------------------------------------
-- 1. Parent tables: the composite key a tenant-aware FK can point at.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('boards'),        ('board_columns'), ('projects'),
      ('timesheets'),    ('tickets')
    ) as t(tbl)
  loop
    if not exists (
      select 1 from pg_constraint
       where conname = format('%s_id_tenant_uq', r.tbl)
         and conrelid = format('public.%I', r.tbl)::regclass
    ) then
      execute format(
        'alter table public.%I add constraint %I unique (id, tenant_id)',
        r.tbl, format('%s_id_tenant_uq', r.tbl)
      );
      raise notice '[018] % gained UNIQUE (id, tenant_id)', r.tbl;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Children: drop the tenant-blind key, add the tenant-carrying one.
--
-- The existing constraint is found through the catalog rather than by its
-- generated name, so this works whether or not it was ever renamed. ON DELETE
-- is restated per relationship because it is behaviour, not boilerplate:
-- `timesheet_entries.project_id` nulls out (an entry survives its project being
-- removed) while everything else cascades.
-- ---------------------------------------------------------------------------
do $$
declare
  r       record;
  v_name  text;
begin
  for r in
    select * from (values
      ('board_columns',      'board_id',     'boards',        'cascade'),
      ('tasks',              'board_id',     'boards',        'cascade'),
      ('tasks',              'column_id',    'board_columns', 'cascade'),
      ('project_assignments','project_id',   'projects',      'cascade'),
      ('timesheet_entries',  'timesheet_id', 'timesheets',    'cascade'),
      ('timesheet_entries',  'project_id',   'projects',      'set null'),
      ('ticket_messages',    'ticket_id',    'tickets',       'cascade')
    ) as t(child, col, parent, on_delete)
  loop
    -- Already converted? The composite key names itself, so its presence is the
    -- idempotency marker.
    if exists (
      select 1 from pg_constraint
       where conname = format('%s_%s_tenant_fkey', r.child, r.col)
         and conrelid = format('public.%I', r.child)::regclass
    ) then
      continue;
    end if;

    -- The old single-column FK on this column, whatever it is called.
    select con.conname into v_name
      from pg_constraint con
      join pg_attribute a
        on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
     where con.contype = 'f'
       and con.conrelid = format('public.%I', r.child)::regclass
       and con.confrelid = format('public.%I', r.parent)::regclass
       and array_length(con.conkey, 1) = 1
       and a.attname = r.col
     limit 1;

    if v_name is not null then
      execute format('alter table public.%I drop constraint %I', r.child, v_name);
    end if;

    execute format(
      'alter table public.%I add constraint %I
         foreign key (%I, tenant_id) references public.%I (id, tenant_id)
         on delete %s',
      r.child,
      format('%s_%s_tenant_fkey', r.child, r.col),
      r.col, r.parent, r.on_delete
    );

    raise notice '[018] %.% now references %(id, tenant_id)', r.child, r.col, r.parent;
  end loop;
end $$;

analyze public.tasks;
analyze public.board_columns;
analyze public.timesheet_entries;
analyze public.ticket_messages;
analyze public.project_assignments;
