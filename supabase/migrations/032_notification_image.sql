-- ---------------------------------------------------------------------------
-- 032 — Announcements can carry a picture.
--
-- ONE COLUMN, TWO KINDS OF VALUE. `image_url` holds either an R2 object key
-- (from the ordinary two-phase upload) or an external `https://` URL someone
-- pasted. They are told apart by shape at render time — a key never starts with
-- a scheme — rather than by a second discriminator column that could disagree
-- with the value beside it.
--
-- No storage guarantees for the pasted kind: an external image can rot or be
-- swapped by whoever controls that host. That is the trade the "or paste a link"
-- half of the field makes, and the composer says so.
--
-- RLS is untouched. Reading an announcement already implies being in its
-- audience (`notifications_select` in 002), and this column rides along with the
-- row it belongs to; an R2 key still only resolves through /api/files/view,
-- which re-checks the tenant.
-- ---------------------------------------------------------------------------

alter table public.notifications add column if not exists image_url text;

do $$
begin
  alter table public.notifications
    add constraint notifications_image_url_len_ck
    check (image_url is null or length(image_url) between 1 and 2000);
exception
  when duplicate_object then null;
end
$$;

comment on column public.notifications.image_url is
  'Optional image: an R2 object key, or an external https:// URL. Distinguished by shape.';
