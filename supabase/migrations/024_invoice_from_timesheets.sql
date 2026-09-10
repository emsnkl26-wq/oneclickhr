-- ============================================================================
-- 024_invoice_from_timesheets.sql — an invoice remembers which weeks it billed.
--
-- The chain this completes:
--
--     timesheet (approved)  ->  invoice (to the vendor, at bill_rate)
--
-- `timesheets.invoice_id` is the important half. Without it there is nothing
-- stopping the same approved week being billed twice — and "we invoiced Infosys
-- for the same fortnight in March twice" is the kind of mistake that costs a
-- customer relationship rather than an afternoon.
--
-- The partial unique index is what actually prevents it. A check in the API
-- would be a check-then-write, and two people clicking Generate at the same
-- moment would both pass it.
--
-- Re-runnable.
-- ============================================================================

alter table public.invoices
  add column if not exists vendor_id    uuid,
  add column if not exists client_id    uuid,
  add column if not exists period_start date,
  add column if not exists period_end   date;

do $$ begin
  alter table public.invoices add constraint invoices_vendor_fk
    foreign key (vendor_id, tenant_id) references public.vendors (id, tenant_id) on delete set null;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.invoices add constraint invoices_client_fk
    foreign key (client_id, tenant_id) references public.clients (id, tenant_id) on delete set null;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.invoices add constraint invoices_period_ck
    check (period_end is null or period_start is null or period_end >= period_start);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.invoices add constraint invoices_id_tenant_uq unique (id, tenant_id);
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- The link back, and the guarantee that goes with it.
-- ---------------------------------------------------------------------------
alter table public.timesheets
  add column if not exists invoice_id uuid,
  add column if not exists invoiced_at timestamptz;

do $$ begin
  alter table public.timesheets add constraint timesheets_invoice_fk
    foreign key (invoice_id, tenant_id) references public.invoices (id, tenant_id) on delete set null;
exception when duplicate_object then null; end $$;

-- ONE invoice per timesheet. The index is the guarantee; the API's check is
-- only there to produce a sentence instead of a constraint error.
create unique index if not exists timesheets_invoice_uq
  on public.timesheets (id)
  where invoice_id is not null;

create index if not exists timesheets_uninvoiced_idx
  on public.timesheets (tenant_id, employee_id, status)
  where invoice_id is null;

create index if not exists invoices_vendor_idx
  on public.invoices (tenant_id, vendor_id, issue_date desc)
  where vendor_id is not null;
