-- ============================================================================
-- NextKinLife EMS — 005_seed.sql
-- Seeds the SUPER ADMIN (the platform owner — us) plus two demo tenants whose
-- only job is to prove, with real rows, that Tenant A cannot see Tenant B.
--
-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ BEFORE YOU RUN THIS: change the three passwords in the `v_*_pw` variables │
-- │ below. They are placeholders. The super admin is the platform root        │
-- │ account and is never created through a signup form.                       │
-- └──────────────────────────────────────────────────────────────────────────┘
--
-- Re-running is safe: every insert is keyed on email/slug and skipped if the
-- account already exists. Nothing here is destructive.
--
-- To seed ONLY the super admin (a production install), delete the
-- "DEMO TENANTS" block at the bottom before running.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helper: create a confirmed auth user directly, the way the Dashboard would.
--
-- Supabase Auth normally owns this table. Writing it by hand is legitimate for
-- seeding but has two sharp edges, both handled below:
--   • auth.identities must get a matching row or the user cannot sign in with a
--     password (GoTrue looks the provider identity up, not just auth.users).
--   • several token columns are NOT NULL with an empty-string default in some
--     GoTrue versions; passing '' explicitly works across all of them.
-- ---------------------------------------------------------------------------
create or replace function public.seed_auth_user(
  p_email     text,
  p_password  text,
  p_app_meta  jsonb default '{}'::jsonb,
  p_user_meta jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = auth, public, extensions, pg_temp
as $$
declare
  v_id uuid;
begin
  select u.id into v_id from auth.users u where lower(u.email) = lower(p_email);
  if v_id is not null then
    return v_id;             -- already seeded; leave it alone
  end if;

  v_id := gen_random_uuid();

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, recovery_sent_at, last_sign_in_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000',
    v_id,
    'authenticated',
    'authenticated',
    lower(p_email),
    extensions.crypt(p_password, extensions.gen_salt('bf')),
    now(), null, null,
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')) || p_app_meta,
    p_user_meta,
    now(), now(),
    '', '', '', ''
  );

  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(),
    v_id,
    v_id::text,
    jsonb_build_object('sub', v_id::text, 'email', lower(p_email), 'email_verified', true),
    'email',
    now(), now(), now()
  );

  return v_id;
end;
$$;

revoke execute on function public.seed_auth_user(text, text, jsonb, jsonb)
  from anon, authenticated, public;

-- ===========================================================================
-- SUPER ADMIN — the platform owner. tenant_id IS NULL, sees every org.
-- ===========================================================================
do $$
declare
  v_email text := 'superadmin@nextkinlife.com';   -- <<< CHANGE ME
  v_pw    text := 'ChangeMe!SuperAdmin#2026';     -- <<< CHANGE ME
  v_id    uuid;
begin
  v_id := public.seed_auth_user(
    v_email, v_pw,
    jsonb_build_object('app_role', 'super_admin'),
    jsonb_build_object('full_name', 'Platform Owner')
  );

  -- handle_new_user() already made the profile; make the role explicit in case
  -- this seed runs against a database where the trigger was added later.
  update public.profiles
     set role      = 'super_admin',
         tenant_id = null,
         full_name = coalesce(full_name, 'Platform Owner'),
         is_active = true
   where id = v_id;

  raise notice 'Super admin ready: % (id %)', v_email, v_id;
end $$;

-- ===========================================================================
-- DEMO TENANTS — the fixture the cross-tenant isolation test runs against.
-- Two unrelated orgs, each with employees and one row in every tenant-scoped
-- table that matters. Delete this whole block for a production install.
-- ===========================================================================
do $$
declare
  v_a_pw  text := 'ChangeMe!OrgA#2026';           -- <<< CHANGE ME
  v_b_pw  text := 'ChangeMe!OrgB#2026';           -- <<< CHANGE ME
  v_emp_pw text := 'ChangeMe!Employee#2026';      -- <<< CHANGE ME

  v_org_a uuid; v_org_b uuid;
  v_tenant_a uuid; v_tenant_b uuid;
  v_dept_a uuid; v_dept_b uuid;
  v_emp_a1 uuid; v_emp_a2 uuid; v_emp_b1 uuid;
  v_board_a uuid; v_board_b uuid;
  v_col_a uuid; v_col_b uuid;
  v_wa_a uuid;
  v_task_a uuid;
begin
  -- --- Org owners (self-signup path: the profiles trigger mints the tenant) --
  v_org_a := public.seed_auth_user(
    'owner@acme-health.test', v_a_pw, '{}'::jsonb,
    jsonb_build_object('full_name', 'Ada Owner', 'org_name', 'Acme Health')
  );
  v_org_b := public.seed_auth_user(
    'owner@borealis-care.test', v_b_pw, '{}'::jsonb,
    jsonb_build_object('full_name', 'Bo Owner', 'org_name', 'Borealis Care')
  );

  select tenant_id into v_tenant_a from public.profiles where id = v_org_a;
  select tenant_id into v_tenant_b from public.profiles where id = v_org_b;

  if v_tenant_a is null or v_tenant_b is null then
    raise exception 'Tenant provisioning trigger did not run — apply 003 before 005';
  end if;
  if v_tenant_a = v_tenant_b then
    raise exception 'Both demo orgs landed in the same tenant — provisioning is broken';
  end if;

  -- --- Departments ---------------------------------------------------------
  insert into public.departments (tenant_id, name) values (v_tenant_a, 'Engineering')
    on conflict do nothing;
  insert into public.departments (tenant_id, name) values (v_tenant_b, 'Care Ops')
    on conflict do nothing;
  select id into v_dept_a from public.departments where tenant_id = v_tenant_a limit 1;
  select id into v_dept_b from public.departments where tenant_id = v_tenant_b limit 1;

  -- --- Employees (admin-created path: tenant + role come from app_metadata) --
  v_emp_a1 := public.seed_auth_user(
    'nurse.a1@acme-health.test', v_emp_pw,
    jsonb_build_object('app_role', 'employee', 'tenant_id', v_tenant_a::text,
                       'must_change_password', true),
    jsonb_build_object('full_name', 'Alice Employee')
  );
  v_emp_a2 := public.seed_auth_user(
    'nurse.a2@acme-health.test', v_emp_pw,
    jsonb_build_object('app_role', 'employee', 'tenant_id', v_tenant_a::text,
                       'must_change_password', true),
    jsonb_build_object('full_name', 'Amit Employee')
  );
  v_emp_b1 := public.seed_auth_user(
    'carer.b1@borealis-care.test', v_emp_pw,
    jsonb_build_object('app_role', 'employee', 'tenant_id', v_tenant_b::text,
                       'must_change_password', true),
    jsonb_build_object('full_name', 'Bea Employee')
  );

  update public.profiles set department_id = v_dept_a, designation = 'Staff Nurse',
         employee_code = 'ACM-001', phone = '+1 555 0101', date_of_joining = current_date - 400
   where id = v_emp_a1;
  update public.profiles set department_id = v_dept_a, designation = 'Care Coordinator',
         employee_code = 'ACM-002', phone = '+1 555 0102', date_of_joining = current_date - 120
   where id = v_emp_a2;
  update public.profiles set department_id = v_dept_b, designation = 'Support Worker',
         employee_code = 'BOR-001', phone = '+44 20 7946 0000', date_of_joining = current_date - 60
   where id = v_emp_b1;

  -- --- Attendance ----------------------------------------------------------
  insert into public.attendance (tenant_id, employee_id, date, login_time, logout_time, total_hours, is_late)
  values
    (v_tenant_a, v_emp_a1, current_date - 1, now() - interval '1 day 9 hours', now() - interval '1 day 1 hour', 8.00, false),
    (v_tenant_a, v_emp_a2, current_date - 1, now() - interval '1 day 8 hours', now() - interval '1 day 30 minutes', 7.50, true),
    (v_tenant_b, v_emp_b1, current_date - 1, now() - interval '1 day 9 hours', now() - interval '1 day 2 hours', 7.00, false)
  on conflict (tenant_id, employee_id, date) do nothing;

  /*
   * From here on the rows have no natural unique key, so `ON CONFLICT DO
   * NOTHING` would not stop a second run from duplicating them. Everything
   * above IS keyed (email, slug, or a real unique index) and is genuinely
   * idempotent; this guard is what makes the same true of the rest.
   */
  if exists (select 1 from public.leaves where tenant_id = v_tenant_a) then
    raise notice 'Demo fixture already present — skipping the unkeyed demo rows.';
    raise notice 'Demo tenant A (Acme Health)   = %', v_tenant_a;
    raise notice 'Demo tenant B (Borealis Care) = %', v_tenant_b;
    return;
  end if;

  -- --- Leaves --------------------------------------------------------------
  insert into public.leaves (tenant_id, employee_id, start_date, end_date, days, reason, status)
  values
    (v_tenant_a, v_emp_a1, current_date + 7, current_date + 9, 3, 'Family function', 'pending'),
    (v_tenant_b, v_emp_b1, current_date + 3, current_date + 3, 1, 'Medical appointment', 'pending');

  -- --- Payslips (file_url holds the R2 KEY, not a URL) ----------------------
  insert into public.payslips (tenant_id, employee_id, month, year, file_url, file_name, uploaded_by)
  values
    (v_tenant_a, v_emp_a1, extract(month from current_date)::int, extract(year from current_date)::int,
     v_tenant_a::text || '/demo-payslip-a.pdf', 'payslip.pdf', v_org_a),
    (v_tenant_b, v_emp_b1, extract(month from current_date)::int, extract(year from current_date)::int,
     v_tenant_b::text || '/demo-payslip-b.pdf', 'payslip.pdf', v_org_b)
  on conflict (tenant_id, employee_id, year, month) do nothing;

  -- --- Invoices ------------------------------------------------------------
  insert into public.invoices (tenant_id, invoice_number, bill_to, items, subtotal, total, balance_due, status, created_by)
  values
    (v_tenant_a, 'INV-0001',
     jsonb_build_object('name', 'Northside Clinic', 'email', 'ap@northside.test'),
     jsonb_build_array(jsonb_build_object('description', 'Agency staffing — March', 'quantity', 120, 'rate', 42, 'amount', 5040)),
     5040, 5040, 5040, 'sent', v_org_a),
    (v_tenant_b, 'INV-0001',
     jsonb_build_object('name', 'Lakeside Trust', 'email', 'finance@lakeside.test'),
     jsonb_build_array(jsonb_build_object('description', 'Care hours — March', 'quantity', 80, 'rate', 38, 'amount', 3040)),
     3040, 3040, 0, 'paid', v_org_b)
  on conflict (tenant_id, invoice_number) do nothing;

  -- --- Notifications -------------------------------------------------------
  insert into public.notifications (tenant_id, title, description, send_to_type, created_by)
  values
    (v_tenant_a, 'Welcome to Acme Health EMS', 'Clock in from your dashboard each morning.', 'all', v_org_a),
    (v_tenant_b, 'Borealis Care policy update', 'New timesheet policy effective Monday.', 'all', v_org_b);

  -- --- Work authorizations: dated to land exactly on the 90/30/7/0 milestones
  -- so the visa cron can be exercised without waiting a quarter.
  insert into public.work_authorizations (tenant_id, employee_id, visa_type, visa_number, start_date, expiry_date)
  values (v_tenant_a, v_emp_a1, 'H-1B', 'HB-ACM-77120', current_date - 700, current_date + 90)
  returning id into v_wa_a;

  insert into public.work_authorizations (tenant_id, employee_id, visa_type, visa_number, start_date, expiry_date)
  values (v_tenant_b, v_emp_b1, 'H-1B', 'HB-BOR-31855', current_date - 300, current_date + 30);

  -- --- Kanban --------------------------------------------------------------
  select id into v_board_a from public.boards where tenant_id = v_tenant_a limit 1;
  select id into v_board_b from public.boards where tenant_id = v_tenant_b limit 1;
  select id into v_col_a from public.board_columns where board_id = v_board_a order by position limit 1;
  select id into v_col_b from public.board_columns where board_id = v_board_b order by position limit 1;

  insert into public.tasks (tenant_id, board_id, column_id, title, description, position, priority, due_date, created_by)
  values (v_tenant_a, v_board_a, v_col_a, 'Collect March timesheets',
          'Chase the two outstanding submissions.', 1000, 'high', current_date + 5, v_org_a)
  returning id into v_task_a;

  insert into public.task_assignees (task_id, profile_id, tenant_id)
  values (v_task_a, v_emp_a1, v_tenant_a) on conflict do nothing;

  insert into public.tasks (tenant_id, board_id, column_id, title, position, priority, created_by)
  values (v_tenant_b, v_board_b, v_col_b, 'Renew DBS checks', 1000, 'medium', v_org_b);

  raise notice 'Demo tenant A (Acme Health)   = %', v_tenant_a;
  raise notice 'Demo tenant B (Borealis Care) = %', v_tenant_b;
  raise notice 'Isolation fixture ready. Run: npm run test:isolation';
end $$;
