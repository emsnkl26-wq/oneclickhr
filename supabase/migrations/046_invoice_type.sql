-- ============================================================================
-- 046_invoice_type.sql — an invoice is either NORMAL or FREELANCER.
--
--   normal      Hourly/timesheet-backed staffing invoice. When one is
--               generated from approved weeks (024, from-timesheets), the
--               weeks stay linked through timesheets.invoice_id exactly as
--               before, and the printed PDF appends an auto-built timesheet
--               summary page from that link — see src/lib/invoice-pdf.ts.
--   freelancer  Entered by hand: a fixed fee or custom line items, no
--               timesheet involved at all.
--
-- The choice is made per invoice, in the same form that creates or edits one
-- (invoice-workspace.tsx) — not derived from the employee record, since one
-- person can be billed either way depending on the engagement.
--
-- Everything created before this migration is `normal` by default, which
-- matches what every existing invoice actually is.
--
-- Re-runnable.
-- ============================================================================

alter table public.invoices
  add column if not exists invoice_type text not null default 'normal';

do $$ begin
  alter table public.invoices add constraint invoices_invoice_type_ck
    check (invoice_type in ('normal', 'freelancer'));
exception when duplicate_object then null; end $$;
