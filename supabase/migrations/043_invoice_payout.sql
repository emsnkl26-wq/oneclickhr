-- ============================================================================
-- 043_invoice_payout.sql — an invoice can be billed in one currency and paid
-- out in another.
--
-- The common case this is for: the vendor is invoiced in USD, the consultant
-- is paid in INR. Until now an invoice held ONE currency — the one billed — so
-- what the org owes the person behind it lived nowhere next to it.
--
--   invoices.employee_id      Who the invoice is for, when it is for one person.
--   invoices.payout_amount    What the org pays that person for this invoice,
--   invoices.payout_currency  in THEIR currency. Internal: never printed on the
--                             invoice the vendor receives.
--   invoices.exchange_rate    Optional. 1 unit of `currency` = this many units of
--                             `payout_currency`, as the org booked it. Stored
--                             rather than looked up, because a rate fetched
--                             later would silently rewrite last month's margin.
--
-- RLS: nothing new. `invoices` is already org-only (002), so an employee can
-- read neither the bill figure nor this one.
--
-- Re-runnable.
-- ============================================================================

alter table public.invoices
  add column if not exists employee_id     uuid,
  add column if not exists payout_amount   numeric(14,2),
  add column if not exists payout_currency text,
  add column if not exists exchange_rate   numeric(18,6);

do $$ begin
  alter table public.invoices add constraint invoices_employee_fk
    -- `set null (employee_id)`, not a bare `set null`: on a composite key the
    -- bare form would null tenant_id too, which is NOT NULL, and the delete of
    -- the profile would fail instead of detaching the invoice.
    foreign key (employee_id, tenant_id) references public.profiles (id, tenant_id)
    on delete set null (employee_id);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.invoices add constraint invoices_payout_amount_ck
    check (payout_amount is null or payout_amount >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.invoices add constraint invoices_payout_currency_ck
    check (payout_currency is null or payout_currency ~ '^[A-Z]{3}$');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.invoices add constraint invoices_exchange_rate_ck
    check (exchange_rate is null or exchange_rate > 0);
exception when duplicate_object then null; end $$;

create index if not exists invoices_employee_idx
  on public.invoices (tenant_id, employee_id, issue_date desc)
  where employee_id is not null;
