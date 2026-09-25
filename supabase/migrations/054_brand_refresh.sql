-- ============================================================================
-- 054_brand_refresh.sql — the OneclickHR rebrand: crimson -> orange.
--
-- WHY THIS IS A DATA CHANGE AND NOT ONLY A STYLESHEET CHANGE
--
--   `tenants.primary_color` has always defaulted to the platform colour, so every
--   workspace that never picked its own is storing the OLD default, #C41E33, in
--   its row. The app writes a workspace's stored colour over the brand tokens at
--   request time (see brandCss in src/components/shell/app-shell.tsx), which
--   means re-colouring the stylesheet alone would leave every existing workspace
--   crimson while a new one came out orange.
--
--   This moves the default, and moves the rows still sitting on the old one.
--
--   The app also treats #C41E33 as "unset" when it reads a colour
--   (brandColorOrDefault in src/lib/brand.ts), so nothing looks wrong in the gap
--   between deploying the code and running this. Running it makes the stored
--   data agree with what is shown, which is what the platform console's
--   organization list and the exports read directly.
--
-- WHAT IT DOES NOT TOUCH
--
--   Any colour that is not exactly the old default. A workspace that chose teal
--   keeps teal. A workspace that deliberately chose #C41E33 is indistinguishable
--   from one that never chose, so it is moved too — the owner can pick the
--   colour again in Settings.
--
-- SAFE TO RUN TWICE: the update matches only the old default, and the second run
-- finds nothing.
-- ============================================================================

alter table public.tenants
  alter column primary_color set default '#FF6A00';

update public.tenants
   set primary_color = '#FF6A00'
 where upper(primary_color) = '#C41E33';

comment on column public.tenants.primary_color is
  'Per-org theming: overrides the OneclickHR orange (#FF6A00) inside this workspace.';
