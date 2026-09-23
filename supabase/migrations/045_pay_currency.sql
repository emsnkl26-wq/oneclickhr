-- ============================================================================
-- 045_pay_currency.sql — the currency an employee's pay is in.
--
-- The onboarding wizard labelled every pay rate with the workspace currency
-- (USD by default), so an employee in India was shown an "Annual salary" in
-- dollars. Pay is now denominated per person:
--
--   employee_onboarding.pay_currency   what the org picked in the wizard
--   profiles.pay_currency              copied across on invite / complete
--
-- Both nullable: a draft that never had a pay rate has no currency either, and
-- readers fall back to the employee's country, then the workspace currency.
--
-- RLS: nothing new — columns on already-scoped tables with table-level grants.
--
-- Re-runnable.
-- ============================================================================

alter table public.employee_onboarding
  add column if not exists pay_currency text;

alter table public.profiles
  add column if not exists pay_currency text;

do $$ begin
  alter table public.employee_onboarding add constraint employee_onboarding_pay_currency_ck
    check (pay_currency is null or pay_currency ~ '^[A-Z]{3}$');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.profiles add constraint profiles_pay_currency_ck
    check (pay_currency is null or pay_currency ~ '^[A-Z]{3}$');
exception when duplicate_object then null; end $$;
