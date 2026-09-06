-- ============================================================================
-- 017_rls_hoist_refresh.sql — re-run 009's RLS hoisting over every policy that
-- has been created since it ran.
--
-- WHY THIS EXISTS AT ALL. 009_performance.sql rewrites the policies in `public`
-- so that zero-argument session helpers are evaluated ONCE per statement (an
-- InitPlan) rather than once per row. That sweep is a SNAPSHOT: it fixed the
-- policies that existed at position 009 and says nothing about anything added
-- afterwards. Migrations 010-016 then added projects, timesheets, helpdesk,
-- letters, self-onboarding and jobs.
--
-- Most of those were written pre-hoisted by hand and need nothing. One was not:
--
--     employee_onboarding_delete   (014_employee_self_onboarding.sql)
--         using (tenant_id = app.current_tenant_id() and app.is_org() and ...)
--
-- which re-derives the caller's tenant and role for every row it examines.
--
-- Rather than patch that single policy, this re-runs the SAME sweep. It fixes
-- that one and anything else a later migration has added, and it is the step to
-- repeat after any future batch of policy work. That is the real point: the
-- hoisting is a property the schema should hold CONTINUOUSLY, not something
-- that was done once in 009 and quietly decayed afterwards.
--
-- IDEMPOTENT. The block strips any wrapper a previous run added before adding
-- its own, so re-running cannot nest them, and a policy already in the right
-- shape is skipped rather than rewritten.
--
-- CHANGES NO PERMISSIONS. It rewrites the expression, never the rule: the same
-- predicate over the same helpers, evaluated fewer times. Only ZERO-ARGUMENT
-- calls are hoisted — a call like app.is_task_assignee(tasks.id) depends on the
-- row and is deliberately left exactly where it is.
--
-- The block below is carried over verbatim from 009 so the two cannot drift
-- apart in what they consider safe to rewrite.
-- ============================================================================

do $$
declare
  rec       record;
  new_qual  text;
  new_check text;
  statement text;
  changed   integer := 0;
begin
  -- Deparsing qualifies anything outside the search_path, which is what keeps
  -- `app.*` and `auth.*` recognisable to the patterns below.
  set local search_path = public, pg_catalog;

  for rec in
    select schemaname, tablename, policyname, qual, with_check
      from pg_policies
     where schemaname = 'public'
  loop
    -- Normalise first: strip any wrapper a previous run of this migration
    -- added, so re-running cannot nest `(select (select ...))`.
    new_qual := regexp_replace(
      coalesce(rec.qual, ''),
      '\( SELECT (app\.[a-z_]+\(\)|auth\.(uid|jwt|role)\(\))\)',
      '\1', 'g'
    );
    new_check := regexp_replace(
      coalesce(rec.with_check, ''),
      '\( SELECT (app\.[a-z_]+\(\)|auth\.(uid|jwt|role)\(\))\)',
      '\1', 'g'
    );

    -- `\(\)` in the pattern is deliberate: it matches only calls that take no
    -- arguments, which are the only ones that are constant for the statement.
    new_qual := regexp_replace(
      new_qual, '(app\.[a-z_]+\(\)|auth\.(uid|jwt|role)\(\))', '( SELECT \1)', 'g'
    );
    new_check := regexp_replace(
      new_check, '(app\.[a-z_]+\(\)|auth\.(uid|jwt|role)\(\))', '( SELECT \1)', 'g'
    );

    if new_qual = coalesce(rec.qual, '') and new_check = coalesce(rec.with_check, '') then
      continue;
    end if;

    statement := format('alter policy %I on %I.%I', rec.policyname, rec.schemaname, rec.tablename);
    if rec.qual is not null then
      statement := statement || format(' using (%s)', new_qual);
    end if;
    if rec.with_check is not null then
      statement := statement || format(' with check (%s)', new_check);
    end if;

    execute statement;
    changed := changed + 1;
  end loop;

  raise notice '[017] hoisted session helpers in % RLS policies', changed;
end;
$$;

-- Refresh the planner's statistics for the tables added since 009, whose access
-- paths this may have just changed.
analyze public.employee_onboarding;
analyze public.projects;
analyze public.timesheets;
analyze public.tickets;
analyze public.jobs;
