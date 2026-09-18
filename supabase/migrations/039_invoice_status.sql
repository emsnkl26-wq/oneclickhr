-- 039_invoice_status.sql — invoices learn "partially paid" and WHEN they were paid.
--
-- `invoice_status` (001) already has draft / sent / paid / overdue / cancelled.
-- This EXTENDS it rather than inventing a second status column:
--
--   partially_paid   money has arrived, but not all of it
--   paid_at          the date the (last) payment landed — what the Finance
--                    overview buckets income by. `issue_date` answers "when did
--                    we bill?", which is a different question from "when did
--                    the money arrive?".
--
-- `overdue` stays storable for anyone who sets it by hand, but the app also
-- DERIVES it: a sent / partially paid invoice whose due_date has passed reads as
-- overdue without a job having to flip it.
--
-- RLS: nothing new. `invoices` is already tenant-scoped by 002's policies and a
-- new column inherits them.

-- ADD VALUE cannot run inside a transaction block that later USES the value, so
-- nothing below references 'partially_paid' as a literal.
alter type public.invoice_status add value if not exists 'partially_paid' after 'sent';

alter table public.invoices
  add column if not exists paid_at date;

-- Backfill: invoices already marked paid get the best date we have for it.
update public.invoices
   set paid_at = coalesce(updated_at::date, issue_date)
 where status = 'paid' and paid_at is null;

create index if not exists invoices_tenant_paid_at_idx
  on public.invoices (tenant_id, paid_at)
  where paid_at is not null;
