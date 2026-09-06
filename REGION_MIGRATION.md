# Moving the Supabase project to another region

Supabase cannot move a project between regions. Correcting the region means
creating a **new project** and pointing the app at it. This is the runbook for
doing that without losing anything.

**Why we are doing it:** the users are in the United States, and the original
project was created in `ap-northeast-1` (Tokyo). Every page render makes several
serial round trips from the Vercel function to Postgres, so a misplaced database
adds hundreds of milliseconds to every single navigation — before a line of
application code runs. See §1 of `SETUP.md` for the full reasoning.

**Target:** Supabase in **East US (North Virginia)** = `us-east-1`, with Vercel
functions in `iad1` (Washington DC). Same metro, ~1-2 ms apart. `vercel.json`
already pins `iad1`.

---

## The one rule

> ### Create and verify the new project BEFORE deleting the old one.
>
> Supabase project deletion is **irreversible** and takes the database with it.
> There is no undo, no grace period, and no support recovery. The old project
> costs nothing to leave running for a few extra days.

Delete the old project only at §8, after the new one is serving traffic.

---

## What carries over, and what does not

| Thing | Carries over? | Notes |
|---|---|---|
| Schema, functions, RLS policies, indexes | **Yes** — re-run the migrations | `supabase/migrations/001…017`, in order |
| Table data | Only if you dump and restore it | Dev data: start clean, it is faster |
| `auth.users` (accounts + passwords) | **No, not practically** | Password hashes belong to the old project. Re-seed instead — this is the main reason to do this now, while there are no real users |
| Project URL, anon key, service-role key, JWT secret | **No** — all four change | New values, new env vars everywhere (§5) |
| Auth hook enablement | **No** — a dashboard toggle | Easy to forget, and the failure is silent. §4 |
| SMTP settings, email templates, redirect URLs, rate limits | **No** — dashboard config | §4 |
| R2, Google OAuth, Resend, cron-job.org | **Yes, untouched** | Not Supabase-side. Only `GOOGLE_REDIRECT_URI` matters, and only if the app URL changes |

---

## 1. Back up the old project first

Even in development, take the dump. It costs two minutes and it is the only
thing standing between a mistake and a rebuild from memory.

```bash
# Schema and data, from the OLD project. Connection string:
# Dashboard -> Project Settings -> Database -> Connection string -> URI
npx supabase db dump --db-url "<OLD_PROJECT_CONNECTION_STRING>" -f backup-schema.sql
npx supabase db dump --db-url "<OLD_PROJECT_CONNECTION_STRING>" --data-only -f backup-data.sql
```

Keep both files outside the repo — `backup-data.sql` contains real rows.

Also copy the old `.env` to `.env.old`. You will want the non-Supabase values in
§5, and it is a useful record of what the working configuration looked like.

---

## 2. Create the new project

1. [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.
2. **Region: East US (North Virginia).** This is the whole point of the exercise
   — get it right, because fixing it again means repeating this document.
3. Pick a strong database password and save it.
4. Wait for provisioning to finish.

---

## 3. Run the migrations

Dashboard → **SQL Editor** → paste and run each file **in numerical order**:

```
supabase/migrations/001_schema.sql
supabase/migrations/002_rls.sql
supabase/migrations/003_auth_hook_and_triggers.sql
supabase/migrations/004_cron.sql
supabase/migrations/005_seed.sql          <- read the note below FIRST
supabase/migrations/006_backfill_missing_profiles.sql
supabase/migrations/007_fix_employee_provisioning.sql
supabase/migrations/008_employee_onboarding.sql
supabase/migrations/009_performance.sql
supabase/migrations/010_projects_timesheets.sql
supabase/migrations/011_helpdesk.sql
supabase/migrations/012_profiles_and_letters.sql
supabase/migrations/013_domain_verification.sql
supabase/migrations/014_employee_self_onboarding.sql
supabase/migrations/015_jobs.sql
supabase/migrations/016_letters_recipient.sql
supabase/migrations/017_rls_hoist_refresh.sql
```

Order is not optional: 002 depends on 001, 009 rewrites the policies 002 created,
and 017 re-runs that rewrite over everything 010-016 added.

**Before running 005_seed.sql**, change the three `v_*_pw` placeholder passwords
inside it. It creates the platform super-admin, which is never created through a
signup form. For a clean install, also delete the `DEMO TENANTS` block at the
bottom — those two tenants exist only to demonstrate isolation.

**004 is expected to be a no-op** on a fresh database. It removes `pg_cron`
scheduling that older revisions installed; scheduling now lives at cron-job.org
(`SETUP.md` §10). A `pg_cron is not installed — nothing to unschedule` notice is
the correct result.

**017 should report a non-zero count** — `[017] hoisted session helpers in N RLS
policies`. That is it fixing the one policy in 014 that was written unhoisted.
`0` means 010-016 have not been applied yet; go back and check the order.

### Verify

```sql
-- Extensions the schema needs.
select extname from pg_extension
 where extname in ('pgcrypto', 'citext', 'pg_trgm');   -- expect all three

-- Every table should have RLS enabled. Expect zero rows.
select c.relname
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

-- Row counts sanity: the super admin from 005 exists.
select role, count(*) from public.profiles group by role;
```

To confirm the RLS hoisting actually landed, **run `017` a second time**. It is
idempotent and reports what it changed, so the second run is the check:

```
[017] hoisted session helpers in 0 RLS policies
```

`0` on the *second* run means every policy is already in the fast shape. (A
non-zero count on the second run would mean something is rewriting policies
between runs, which nothing in this repo does.)

---

## 4. Redo the dashboard configuration

None of this comes across with the migrations. The auth hook in particular fails
*silently* — the app keeps working while every policy check pays for an extra
query, which is exactly the cost this migration exists to remove.

1. **Authentication → Hooks → Customize Access Token (JWT) Claims** — enable,
   choose **Postgres**, select `public.custom_access_token_hook`, save.
   (`SETUP.md` §3)
2. **Authentication → Emails → SMTP Settings** — point at Resend. (`SETUP.md` §4b)
3. **Email templates** — `npm run email:templates`, then paste the output into
   the dashboard's confirm-signup and reset-password templates.
4. **Authentication → URL Configuration** — set Site URL and the redirect
   allowlist to your app URL(s). Sign-in links break without this.
5. **Authentication → Rate Limits** — raise the email rate limit; the default is
   low enough to bounce a burst of sign-ups.
6. **Send Email Hook**, if you use it — regenerate the secret into
   `SUPABASE_SEND_EMAIL_HOOK_SECRET`. It is per-project and does not carry over.

---

## 5. Rotate the environment variables

**Project Settings → API** on the new project. These four change:

```
NEXT_PUBLIC_SUPABASE_URL          # new project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY     # new anon/public key
SUPABASE_SERVICE_ROLE_KEY         # new service_role key
SUPABASE_JWT_SECRET               # Project Settings -> API -> JWT Settings
```

Plus `SUPABASE_SEND_EMAIL_HOOK_SECRET` if you configured §4.6.

These do **not** change: `APP_URL`, `RESEND_API_KEY`, `EMAIL_FROM`, `R2_*`,
`GOOGLE_*`, `CRON_SECRET`.

Update them in **both** places — local `.env` and **Vercel → Settings →
Environment Variables** — then **redeploy**. Vercel does not pick up changed env
vars without a new deployment.

> The `service_role` key bypasses RLS completely. It belongs in Vercel's
> server-side environment and nowhere near the browser. Never give it the
> `NEXT_PUBLIC_` prefix.

---

## 6. Verify before you trust it

The repo ships the checks; use them rather than clicking around.

```bash
npm run build                                          # type-checks and compiles
npm test                                               # 191 unit tests
npm run r2:doctor                                      # file storage reachable
npm run test:isolation                                 # tenant A cannot read tenant B
npm run auth:doctor -- https://your-app.vercel.app --hook   # auth email path + hook
```

Two things to know about those last two:

- **`test:isolation` needs the demo tenants from `005_seed.sql`.** It signs in as
  real users in two tenants and asserts each is blind to the other, so it cannot
  run if you deleted the `DEMO TENANTS` block in §3. If you want this proof — and
  after changing regions you do — seed the demo tenants, run the test, then
  delete those two tenants from `/super/organizations` once it passes.
- **`auth:doctor` checks a deployed URL**, not your schema. Run it after §5's
  redeploy, and pass the real deployment URL. Bare `npm run auth:doctor` checks
  `localhost:3000`.

Then, by hand:

1. Sign in as the super admin seeded in 005.
2. Decode the access token at [jwt.io](https://jwt.io) — the payload **must**
   contain `tenant_id`, `user_role` and `is_active`. If it does not, §4.1 did not
   take, and every RLS check is paying for a fallback query.
3. Create an org, add an employee, sign in as them, confirm they see only their
   own data.
4. Upload a file and read it back (exercises R2 + the presign route).

---

## 7. Confirm the latency is actually fixed

This is the reason for the whole exercise, so measure it rather than assuming.

On a deployed page, compare server response time before and after. The Vercel
function log for a page render should show total duration dominated by
application work, not by waiting on the database. A same-metro function/database
pair answers a simple authenticated page in tens of milliseconds; a
cross-continent pair cannot, no matter how good the queries are.

---

## 8. Only now: delete the old project

Once the new project has served real traffic and §6 is green:

1. Confirm `backup-schema.sql` and `backup-data.sql` from §1 exist and are
   non-empty.
2. Confirm nothing still points at the old project — search Vercel env vars,
   local `.env`, and any cron-job.org job URLs for the old project ref.
3. Old project → **Project Settings → General → Delete project**.

If you are not certain, pause the old project instead. A paused project keeps its
data and costs nothing, and it can be restored; a deleted one cannot.

---

## Rollback

Before §8, rollback is complete and takes minutes: restore the four environment
variables from `.env.old` in Vercel and redeploy. The old project is untouched
and still holds its data.

After §8 there is no rollback — only a rebuild from the §1 dumps into another new
project. This asymmetry is the entire reason §8 is last.
