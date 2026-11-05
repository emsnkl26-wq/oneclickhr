-- ============================================================================
-- 063_invoice_deductions.sql — named amounts taken OFF an invoice total.
--
--   invoices.deductions   A jsonb array of { label, amount } — a discount, a
--                         retainer already paid, a withholding, an adjustment.
--                         Each amount is subtracted from (subtotal + tax) when
--                         the total is computed on the server. Empty by default,
--                         so every existing invoice is unchanged: an invoice
--                         with no deductions totals exactly as it did before.
--
-- Stored like `items` (001) — a jsonb array on the row, not a child table —
-- because a deduction has no life of its own: it is part of the document, read
-- and written only with the invoice it belongs to.
--
-- RLS: nothing new. `invoices` is already tenant-scoped and the new column
-- inherits those policies. `invoices` keeps table-level grants (it was never
-- column-revoked the way `tenants` was in 013), so no per-column grant is needed
-- here — see 042, which added `subject`/`payment_details` the same way.
--
-- Re-runnable.
-- ============================================================================

alter table public.invoices
  add column if not exists deductions jsonb not null default '[]'::jsonb;
