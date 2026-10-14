-- ============================================================================
-- 061_seat_limit_and_domain_deadline.sql — two platform limits, both owned by
-- the server and both reversible from the super-admin console.
--
-- 1. SEATS. Every workspace gets 20 employee accounts. The product is free, so
--    the cap is what keeps "free" finite: an org that needs more asks us, and a
--    super admin raises that one workspace's number. The limit therefore has to
--    be a PER-TENANT column rather than a constant in the application — the
--    whole point is that it differs per customer — and it has to be unwritable
--    by the customer, or it is not a limit at all.
--
--    It is NOT enforced by a constraint or a trigger. The count it would have
--    to take ("how many active employees does this tenant have?") is a scan of
--    another table on every profile write, and a trigger that raises would
--    surface as a bare 23514 in the middle of a five-step onboarding that has
--    already created an auth user. The check lives in `src/lib/seats.ts`, at
--    the top of the two handlers that mint an account, where it can refuse
--    BEFORE anything is created and say who to contact. This column is the
--    number those handlers read.
--
-- 2. THE DOMAIN DEADLINE DROPS FROM 14 DAYS TO 3 — and, for the first time,
--    it is a kill switch.
--
--    013 said, at length, that `domain_verify_due_at` was "a DEADLINE FOR THE
--    BANNER, not a kill switch", and that nothing is gated when it passes.
--    That is no longer true, and this header is where the change is recorded:
--    an unverified workspace past its deadline is PAUSED. Its people can sign
--    in and see one screen — the verification screen — and nothing else.
--
--    WHY THE PAUSE IS NOT A `status` CHANGE. `tenant_status` already has
--    'suspended', and reaching for it here would have been the smaller diff.
--    It is wrong twice over: a suspension is a deliberate platform act against
--    a customer, recorded and reversed by a human, and overloading it would
--    mean a cron job writing the same column a super admin writes, with no way
--    to tell afterwards which of the two paused a workspace — or, worse,
--    unpausing one the platform had suspended on purpose. It would also need
--    that cron to exist, and to run on time, for the limit to mean anything.
--
--    So the pause is DERIVED, live, from the two columns already here:
--    unverified AND past due. It needs no scheduled job, it cannot drift, it
--    lifts itself the instant verification succeeds, and `status` keeps its one
--    meaning. `src/lib/domain-lock.ts` is the single place that spells it out.
--
--    EXISTING WORKSPACES ARE NOT PAUSED BY THIS MIGRATION. An unverified
--    workspace with eleven days left does not get locked out the moment this
--    file runs; §2 below gives every one of them a full 3 days from now,
--    whatever their old deadline said.
--
-- Re-runnable: idempotent column add, an unconditional default, and a backfill
-- that only ever moves a deadline FORWARD from today.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Seats
-- ---------------------------------------------------------------------------

alter table public.tenants
  -- 20 is the free allowance. 0 is permitted and means "no new employees" —
  -- a usable state for a workspace being wound down, and the reason this is
  -- not `check (employee_limit > 0)`. The upper bound is a typo guard, not a
  -- product rule.
  add column if not exists employee_limit integer not null default 20;

do $$ begin
  alter table public.tenants
    add constraint tenants_employee_limit_ck
    check (employee_limit between 0 and 100000);
exception when duplicate_object then null; end $$;

/*
 * READABLE by the workspace, WRITABLE by nobody but the service role.
 *
 * 013 revoked the blanket grants on this table and re-granted column by column,
 * so a column added later is invisible to `authenticated` until it is named —
 * which is the right default for anything the server owns, and the reason this
 * grant is SELECT only. The org's own Employees page shows "14 of 20", so it
 * has to read it; nothing in the product lets it write one.
 *
 * Grants accumulate, so this adds to 013's list rather than replacing it.
 */
grant select (employee_limit) on public.tenants to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The deadline: 3 days
-- ---------------------------------------------------------------------------

-- New workspaces from here on.
alter table public.tenants
  alter column domain_verify_due_at set default (now() + interval '3 days');

/*
 * Workspaces that already exist.
 *
 * `greatest(now() + 3 days, ...)` is deliberately NOT what this does — that
 * would EXTEND a 14-day window that is nearly up. `least()` is also wrong: it
 * would pause, today, every unverified workspace whose deadline has already
 * passed under the old rule, including ones that have never seen the banner
 * say anything urgent.
 *
 * What is fair is the same thing 013 did when it introduced the column: give
 * everyone the full window starting now. Nobody is locked out by a deploy, and
 * everybody is on the 3-day rule within 3 days.
 *
 * Verified workspaces are untouched — their deadline is already irrelevant,
 * and moving it would only confuse the audit trail.
 */
update public.tenants
   set domain_verify_due_at = now() + interval '3 days'
 where domain_verified_at is null;

-- ---------------------------------------------------------------------------
-- 3. The column guard, with one more server-owned column
--
-- 013's `tg_tenants_guard`, unchanged except for `employee_limit`. The grant
-- above already makes it unwritable from a session; this is 013's second,
-- independent wall, and the comment there explains why both exist. Reproduced
-- in full because `create or replace` needs the whole body — read 013 before
-- changing anything else in here.
-- ---------------------------------------------------------------------------
create or replace function public.tg_tenants_guard()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  -- Domain identity is server-owned end to end. An org changes its domain
  -- through /api/org/domain, which re-checks availability and resets the proof.
  if new.domain                        is distinct from old.domain
     or new.domain_verified_at         is distinct from old.domain_verified_at
     or new.domain_token               is distinct from old.domain_token
     or new.domain_verification_method is distinct from old.domain_verification_method
     -- Including the deadline: an org that could push its own due date out has
     -- a countdown that means nothing. As of 061 that countdown ends in a
     -- lockout, so this line is now load-bearing rather than tidy.
     or new.domain_verify_due_at       is distinct from old.domain_verify_due_at then
    raise exception 'Domain verification is managed by the server';
  end if;

  -- Not new rules, just ones that until now lived only in application code.
  if new.id is distinct from old.id or new.slug is distinct from old.slug then
    raise exception 'Workspace identity is immutable';
  end if;
  if new.status is distinct from old.status then
    raise exception 'Workspace status is managed by the platform';
  end if;
  -- (061) A workspace that could raise its own seat limit has no seat limit.
  if new.employee_limit is distinct from old.employee_limit then
    raise exception 'The employee limit is managed by the platform';
  end if;

  return new;
end;
$$;

drop trigger if exists tenants_guard on public.tenants;
create trigger tenants_guard before update on public.tenants
  for each row execute function public.tg_tenants_guard();
