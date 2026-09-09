-- ---------------------------------------------------------------------------
-- 019 — a name for every uploaded document.
--
-- `file_name` is whatever the person's scanner called it ("scan_002.pdf"), so
-- the Documents card on a profile was a list of unidentifiable files. The
-- onboarding wizard already collected a label per additional document; it just
-- had nowhere to land. This is that column.
--
-- Nullable on purpose: everything uploaded before this migration has no label,
-- and the display side falls back to `file_name`.
-- ---------------------------------------------------------------------------

alter table public.documents
  add column if not exists label text;

alter table public.documents
  drop constraint if exists documents_label_len_ck;
alter table public.documents
  add constraint documents_label_len_ck check (label is null or length(label) <= 120);
