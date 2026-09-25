-- ============================================================================
-- 047_composite_set_null_fix.sql — make every tenant-carrying `ON DELETE SET
-- NULL` key null ONLY its own column.
--
-- THE BUG. A composite key such as
--
--     foreign key (assignment_id, tenant_id)
--       references employee_assignments (id, tenant_id) on delete set null
--
-- nulls EVERY referencing column when the parent row goes — including
-- `tenant_id`, which is NOT NULL. So the delete of the parent fails with
-- 23502 (not_null_violation) the moment a single child row points at it.
-- That is why deleting a placement that already had a timesheet answered
-- "Something went wrong", and it is the same failure waiting behind deleting
-- a vendor, a client, a project, an invoice or a recurring expense that
-- anything still references.
--
-- 040 and 043 already wrote their keys the right way — `set null (col)`,
-- Postgres 15+. This finds every other one through the catalog and rebuilds
-- it the same way, so the fix covers keys nobody remembered to list here.
--
-- A key is rebuilt when it:
--   • lives in `public`,
--   • is ON DELETE SET NULL with no column list yet (confdelsetcols is null),
--   • has more than one column and one of them is `tenant_id`.
-- Everything except `tenant_id` becomes the SET NULL list.
--
-- Re-runnable: a rebuilt key has confdelsetcols set and is skipped next time.
-- ============================================================================

do $$
declare
  r        record;
  v_def    text;
  v_cols   text;
begin
  for r in
    select con.oid,
           con.conname,
           con.conrelid::regclass as tbl,
           con.conrelid,
           con.conkey
      from pg_constraint con
      join pg_namespace n on n.oid = con.connamespace
     where n.nspname = 'public'
       and con.contype = 'f'
       and con.confdeltype = 'n'
       and con.confdelsetcols is null
       and array_length(con.conkey, 1) > 1
       and exists (
         select 1 from pg_attribute a
          where a.attrelid = con.conrelid
            and a.attnum = any (con.conkey)
            and a.attname = 'tenant_id'
       )
  loop
    select string_agg(quote_ident(a.attname), ', ' order by k.ord)
      into v_cols
      from unnest(r.conkey) with ordinality as k(attnum, ord)
      join pg_attribute a on a.attrelid = r.conrelid and a.attnum = k.attnum
     where a.attname <> 'tenant_id';

    v_def := pg_get_constraintdef(r.oid);
    v_def := replace(v_def, 'ON DELETE SET NULL', format('ON DELETE SET NULL (%s)', v_cols));

    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    execute format('alter table %s add constraint %I %s', r.tbl, r.conname, v_def);

    raise notice '[047] % on % now: %', r.conname, r.tbl, v_def;
  end loop;
end $$;
