-- ============================================================================
-- 042_invoice_layout.sql — what the printed invoice needs that it did not have.
--
--   invoices.subject           The "FOR:" line under the header — who and what
--                              the invoice is for, e.g. "AI/ML Engineer -
--                              Tejaswini Garikipati". Optional.
--   invoices.payment_details   The bank block printed at the foot of the page,
--                              SNAPSHOTTED per invoice: an invoice already sent
--                              must keep the account it told the client to pay,
--                              even after the org changes banks.
--   tenants.invoice_payment_details
--                              The default a new invoice starts from, edited in
--                              Settings -> Company details.
--
-- RLS: nothing new. Both tables are already tenant-scoped and new columns
-- inherit the policies. `tenants` is the exception for GRANTS — 013 revoked
-- blanket SELECT/UPDATE and re-grants column by column (see 031, 033, 036), so
-- the new tenant column is granted explicitly or the settings save fails 42501.
--
-- Re-runnable.
-- ============================================================================

alter table public.invoices
  add column if not exists subject         text,
  add column if not exists payment_details text;

alter table public.tenants
  add column if not exists invoice_payment_details text;

grant select (invoice_payment_details) on public.tenants to authenticated;
grant update (invoice_payment_details) on public.tenants to authenticated;
