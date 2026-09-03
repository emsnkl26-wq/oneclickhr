# Oneclickhr — Setup Guide

Everything needed to take this repository from nothing to a running,
multi-tenant production deployment. Follow the sections in order; each one ends
in a state you can verify before moving on.

**Time required:** about 45 minutes, most of it waiting for Supabase and Vercel.

---

## Contents

1. [Create the Supabase project](#1-create-the-supabase-project)
2. [Run the SQL migrations](#2-run-the-sql-migrations)
3. [Enable the auth token hook](#3-enable-the-auth-token-hook)
4. [Configure email — Resend](#4-configure-email--resend)
5. [Seed the super admin](#5-seed-the-super-admin)
6. [Cloudflare R2](#6-cloudflare-r2)
7. [Google Cloud OAuth for Calendar](#7-google-cloud-oauth-for-calendar)
8. [Run locally](#8-run-locally)
9. [Deploy to Vercel](#9-deploy-to-vercel)
10. [Schedule the background jobs](#10-schedule-the-background-jobs)
11. [Verification checklist](#11-verification-checklist)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Create the Supabase project

1. At [supabase.com/dashboard](https://supabase.com/dashboard) create a new
   project. Choose a region close to your users — every query in the app is a
   round trip to it.
2. Save the database password somewhere safe; you will not be shown it again.
3. Once provisioning finishes, go to **Project Settings → API** and copy:

   | Value | Goes into |
   |---|---|
   | Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
   | `anon` `public` key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
   | `service_role` `secret` key | `SUPABASE_SERVICE_ROLE_KEY` |

> **The `service_role` key bypasses Row Level Security completely.** It belongs
> only in server-side environment variables. It must never appear in a
> `NEXT_PUBLIC_` variable, in client code, or in a commit.

---

## 2. Run the SQL migrations

Open **SQL Editor** in the Supabase dashboard and run each file from
`supabase/migrations/` **top to bottom, in order**. Paste the whole file, press
Run, confirm it succeeds, then move to the next.

| # | File | What it does |
|---|---|---|
| 1 | `001_schema.sql` | Tables, enums, indexes, the rate-limit and cron-run ledgers |
| 2 | `002_rls.sql` | Enables RLS on every table, creates the `SECURITY DEFINER` helpers and all policies |
| 3 | `003_auth_hook_and_triggers.sql` | The access-token hook and the two provisioning triggers |
| 4 | `004_cron.sql` | Removes the old in-database pg_cron schedules. Scheduling is external now — cron-job.org only (§10). No-op on a fresh database |
| 5 | `005_seed.sql` | Super admin + two demo tenants for the isolation test |
| 6 | `006_backfill_missing_profiles.sql` | Repairs accounts that signed up before `003` was applied |
| 7 | `007_fix_employee_provisioning.sql` | **Required.** Closes the escalation described below and repairs accounts it already affected |
| 8 | `008_employee_onboarding.sql` | The onboarding wizard: the `employee_onboarding` draft table and the profile columns it fills in |
| 9 | `009_performance.sql` | **Required.** Hoists the RLS session helpers out of the per-row loop, adds the missing indexes, and creates the two functions the app now calls |
| 10 | `010_projects_timesheets.sql` | Projects, timesheets and the timesheet column guard |
| 11 | `011_helpdesk.sql` | Tickets and ticket messages |
| 12 | `012_profiles_and_letters.sql` | Employee work history/education/skills, the company letterhead fields on `tenants`, and `generated_documents` |
| 13 | `013_domain_verification.sql` | **Required.** One company website, one workspace: the `domain` claim, the partial unique index over *verified* domains, the tenants column guard, and the two fields `current_profile()` now returns |

`009` is not optional either — `/org/documents` and `/super/organizations` call
`search_documents()` and `platform_tenant_stats()`, and both pages error without
them. It changes no permissions: the policies keep the predicates `002` wrote,
rewritten as `(select app.is_org())` so Postgres evaluates them once per
statement instead of once per row. It is idempotent, so re-running it is safe.

`013` is what stops two people from the same company each creating their own
workspace. It is safe on a live database — every column is additive and nothing
it adds gates access. Two parts are worth knowing before you touch it:

- Uniqueness is **partial**: `tenants_verified_domain_uq` covers only rows with
  `domain_verified_at is not null`. Unverified claims may collide on purpose —
  a unique constraint on the *claim* would let the first stranger to type
  `acme.com` lock the real Acme out of the product permanently.
- **The five domain columns are server-owned, and two independent mechanisms say
  so.** RLS already lets an org update its own tenant row and cannot express
  *which column*, so an org admin could otherwise `PATCH domain_verified_at`
  straight through PostgREST and skip verification entirely.
  1. `revoke update on public.tenants from authenticated` followed by a
     `grant update (...)` naming only the columns `/api/org/settings` edits.
     Postgres checks column privileges before it reaches a policy or a trigger,
     so those columns are not "guarded" — they are unreachable for that role.
     Revoking one column does **not** subtract from a table-level grant; the
     revoke-then-re-grant is the only way to express the restriction.
  2. `tg_tenants_guard`, the tenants twin of `tg_profiles_guard`, as a second
     layer that survives someone re-granting the table later. It also closes the
     same hole on `status` (self-unsuspend) and `slug`.
  Service-role writes (`auth.uid() is null`) pass through both — that is how the
  verification endpoint records a result.
- `domain_token` is **not readable** by `authenticated` either. It is the secret
  the org publishes, every member of a workspace can read their tenant row, and
  the one screen that displays it reads it server-side. **If you add a column to
  `tenants`, add it to the `grant select` list too** or client queries selecting
  it will 403.
- `domain_verify_due_at` is a **deadline for the banner's tone, not a kill
  switch**. Nothing is gated before or after it. It defaults to `now() + 14 days`
  so existing workspaces get a fair window starting the day you apply this,
  rather than being overdue the moment it lands.

It also **drops and recreates `current_profile()`**, because `create or replace`
cannot change a function's return type. Re-running the whole file is safe.

Verify the privileges took:

```sql
-- Should list ONLY the editable columns, and no domain_* column at all.
select column_name, privilege_type
  from information_schema.column_privileges
 where table_name = 'tenants' and grantee = 'authenticated'
   and privilege_type = 'UPDATE'
 order by column_name;

-- Should be false — the token must never reach a browser.
select has_column_privilege('authenticated', 'public.tenants', 'domain_token', 'SELECT');
```

`007` is not optional. `admin.createUser({ app_metadata })` writes the auth row
*first* and the metadata *second*, so the `AFTER INSERT` trigger from `003` ran
before `app_role` existed, defaulted every admin-created employee to `org`, and
provisioned each of them a workspace of their own. `007` makes provisioning
require positive evidence of a self-signup, adds an `AFTER UPDATE` trigger that
adopts the role whenever the metadata lands, and puts the affected employees back
in the tenant that hired them.

**Do not reorder them.** `002` creates helper functions that `003`'s policies
rely on, and `005` depends on the provisioning trigger from `003` existing —
it raises a clear error rather than silently creating broken data if you skip
ahead.

### Why the migrations are shaped this way

Two decisions are worth understanding before you change anything:

**RLS helpers are `SECURITY DEFINER`.** A policy on `profiles` that sub-selects
from `profiles` re-enters itself and Postgres raises *"infinite recursion
detected in policy for relation profiles"*. Every membership and role question
in `002_rls.sql` is answered by a function that runs as its owner, so the
recursion can never start. If you add a table, follow the same pattern — never
inline a sub-select against a table into that table's own policy.

**`is_active` is read live, from the table, on every check.** `tenant_id` and
the role come from a JWT claim (one fewer query per check, and neither changes
during a session), but a token is valid for an hour. Reading `is_active` from a
claim would leave a deactivated employee with up to an hour of access.
Deactivation has to bite immediately, so `app.is_active_member()` queries the
table every time.

### Verify

```sql
-- Every table should report rowsecurity = true.
select tablename, rowsecurity
  from pg_tables
 where schemaname = 'public'
 order by tablename;

-- The helper functions should all exist.
select routine_name from information_schema.routines
 where routine_schema = 'app' order by routine_name;
```

---

## 3. Enable the auth token hook

This is what puts `tenant_id` and `user_role` into every access token, so the
RLS policies answer from a claim instead of a lookup.

1. Go to **Authentication → Hooks** (under *Configuration*).
2. Find **Customize Access Token (JWT) Claims**.
3. Enable it, choose **Postgres**, and select `public.custom_access_token_hook`.
4. Save.

> **The custom claim is named `user_role`, not `role`.** `role` is reserved in a
> Supabase JWT — PostgREST runs `SET ROLE <that claim>` on every request, so
> writing `org` into it makes *every* query fail with `role "org" does not
> exist`. If you extend the hook, never shadow a reserved claim.

### Verify

Sign in as any user after §5, then decode the access token at
[jwt.io](https://jwt.io). The payload should contain `tenant_id`, `user_role`
and `is_active` alongside the standard claims.

If the hook is not enabled, the app still works — the helper functions fall back
to a table lookup — but every policy check costs an extra query.

---

## 4. Configure email — Resend

Transactional email travels two independent paths, and knowing which is which is
the difference between a five-minute fix and a lost evening:

| Path | Sent by | Template lives in |
|---|---|---|
| Confirm signup, password reset | **Supabase**, over custom SMTP (Resend) | The Supabase dashboard — generated by `npm run email:templates` |
| Employee credentials, visa reminders, announcements | **The app** (`src/lib/email.ts`), via the Resend API | Code |

Auth email deliberately does **not** pass through the app. Anything the app does
during a sign-up is something that can fail a sign-up, and Supabase aborts the
whole auth action when the send fails — so the shortest path is the safest one.
The app-side alternative exists (§4e) but is off by default.

### 4a. Resend account

1. Sign up at [resend.com](https://resend.com).
2. **Domains → Add Domain**, add your sending domain, and create the DNS records
   it gives you (SPF, DKIM, and a return-path record). Wait for verification.
3. **API Keys → Create API Key** with *Sending access*. Copy it into
   `RESEND_API_KEY`.
4. Set `EMAIL_FROM` to a verified address, e.g.
   `Oneclickhr <no-reply@oneclickhr.app>`.

### 4b. Point Supabase's SMTP at Resend

Easiest via Resend's own integration (**Resend → Settings → Supabase**), which
fills these in for you. By hand it is **Authentication → Emails → SMTP
Settings**:

| Field | Value |
|---|---|
| Enable custom SMTP | on |
| Sender email | an address on your verified domain, e.g. `team@oneclickhr.app` |
| Sender name | your product name |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | a Resend API key with *Sending access* |

Then raise **Authentication → Rate Limits → Rate limit for sending emails** to
something appropriate for launch. The default is low enough that a demo day or a
burst of sign-ups will start bouncing users off it, and the error they see is
indistinguishable from a broken sign-up.

### 4c. Paste the email templates — do not skip this

```bash
npm run email:templates      # writes supabase/templates/*.html
```

Then **Authentication → Emails → Templates**, and paste:

| Template | File |
|---|---|
| Confirm signup | `supabase/templates/confirm-signup.html` |
| Reset password | `supabase/templates/reset-password.html` |

> #### Why the stock template breaks on a phone
>
> Supabase's default link is `{{ .ConfirmationURL }}` — a PKCE `?code=` url.
> Exchanging that code requires a `code_verifier` generated in the browser that
> *started* the signup and held in its localStorage. Sign up on a laptop, open
> the email on your phone — different browser, no verifier, and the link fails
> with *"invalid request: both auth code and code verifier should be
> non-empty"*.
>
> People check email on their phones. This is not an edge case; it is most of
> them, and it fails **after** the account exists, so it looks like your product
> is broken rather than misconfigured.
>
> The generated templates link to `{{ .SiteURL }}/auth/confirm?token_hash={{
> .TokenHash }}&type=…` instead. `/auth/confirm` verifies that server-side with
> no browser state at all, so the link works from any device, any browser, even a
> webmail preview fetch. They also carry the app's own branding, so the
> confirmation email matches every other email the product sends. Re-run the
> command and re-paste whenever the layout changes.

### 4d. URL configuration

**Authentication → URL Configuration:**

- **Site URL** — `http://localhost:3000` for development, your real domain in
  production. This is what `{{ .SiteURL }}` expands to in the templates above,
  so a wrong value here sends every confirmation link to the wrong host.
- **Redirect URLs** — add both:
  - `http://localhost:3000/**`
  - `https://your-domain.com/**`

### 4e. The Send Email Auth Hook — optional, off by default

`/api/auth/send-email-hook` lets the **app** send auth email through the Resend
API instead of Supabase sending it over SMTP. The only reason to want that is
Supabase's SMTP send-rate limit.

It is off unless you enable it, and the tradeoff is sharp: **a hook that answers
non-2xx aborts every sign-up and every password reset.** A secret that does not
match, a URL with a trailing slash, or a path missing from `MACHINE_PATHS` in
`src/lib/auth/public-paths.ts` all produce exactly that, and the user sees only a
generic error.

If you do enable it (**Authentication → Hooks → Send Email**, type *HTTPS*, URL
`https://your-domain.com/api/auth/send-email-hook`), the generated secret must be
identical in **three** places — the dashboard, `.env.local`, and your hosting
provider's environment for Production *and* Preview — and a Vercel env change
needs a redeploy to take effect. Verify immediately:

```bash
npm run auth:doctor -- https://your-domain.com --hook
```

### 4f. Verify it before you trust it

```bash
npm run auth:doctor                                        # localhost:3000
npm run auth:doctor -- https://your-domain.com             # a deployment
npm run auth:doctor -- https://your-domain.com --send you@work.com
npm run auth:doctor -- https://your-domain.com --signup you@work.com
```

It checks the things that fail silently: sign-ups are enabled, email confirmation
is required, `/auth/confirm` is live and refuses a bad token cleanly, and Resend
accepts your `EMAIL_FROM`. `--signup` goes all the way — it creates a real
account through the app's own endpoint, which is the only way to exercise
Supabase's SMTP send.

**Then open that confirmation email on a different device than the one you
signed up on.** That single step is what catches a stock PKCE template, and no
automated check can do it for you.

If something fails, the app names the cause in its logs rather than making you
guess:

| Log line | Cause | Fix |
|---|---|---|
| `[signup] failed { status: 500 … }` | Supabase could not send the confirmation email | SMTP settings (§4b) — check the sender domain is verified and the rate limit is not exhausted |
| `[signup] failed { status: 429 … }` | Supabase's email rate limit | Raise it in Authentication → Rate Limits |
| `[email] send failed { statusCode, detail }` | Resend refused a **product** email | The reason is Resend's own words — usually an unverified domain |
| `[send-email-hook] signature rejected — signature-mismatch (fingerprint: …)` | The hook is enabled and its secret does not match (§4e) | Align the three copies and redeploy, or disable the hook |
| `[send-email-hook] received a GET` | The hook URL redirected and the sender followed it as a GET | Check the URL for a trailing slash or an apex→www hop |

---

## 5. Seed the super admin

The super admin is the **platform owner** — you. It is never created through a
signup form; it is seeded directly, with `role = 'super_admin'` and
`tenant_id = NULL`.

1. Open `supabase/migrations/005_seed.sql`.
2. **Change the placeholder passwords.** There are four, each marked
   `<<< CHANGE ME`. Also change `superadmin@nextkinlife.com` to your real
   address.
3. For a **production** install, delete the `DEMO TENANTS` block at the bottom
   before running — it creates two fake organizations that exist purely for the
   isolation test.
4. Run the file in the SQL Editor.

### Verify

```sql
select p.email, p.role, p.tenant_id, p.is_active
  from public.profiles p
 where p.role = 'super_admin';
```

You should see exactly one row, with `tenant_id` NULL. Sign in at `/login` — you
should land on `/super`.

---

## 6. Cloudflare R2

One **private** bucket holds every file: employee photos, payslips, visa
documents, org logos.

1. In the Cloudflare dashboard go to **R2 → Create bucket**. Name it
   `nextkinlife-ems`. Location: automatic.
2. **Leave public access disabled.** Nothing in this bucket is meant to be
   reachable by URL. Every read goes through `/api/files/view`, which verifies
   the caller, proves the object belongs to their tenant, checks the row-level
   rule for that kind of file, and only then mints a signed URL that expires in
   15 minutes.
3. **R2 → Manage R2 API Tokens → Create API Token**:
   - Permission: **Object Read & Write**
   - Scope: the bucket you just created
4. Copy into your environment:

   | Cloudflare shows | Variable |
   |---|---|
   | Access Key ID | `R2_ACCESS_KEY_ID` |
   | Secret Access Key | `R2_SECRET_ACCESS_KEY` |
   | Account ID (top right of the R2 page) | `R2_ACCOUNT_ID` |
   | Bucket name | `R2_BUCKET` |

5. **CORS** — the browser uploads bytes directly to R2 with a presigned PUT, so
   the bucket must allow it. Under **Settings → CORS Policy**:

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000", "https://your-domain.com"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["content-type", "content-length"],
    "ExposeHeaders": ["etag"],
    "MaxAgeSeconds": 3600
  }
]
```

   **`AllowedOrigins` must list every origin the app is served from — each
   preview domain, the Vercel domain and the custom domain.** An origin missing
   here fails only in a browser, never on the server: R2 refuses the preflight
   with a 403 and the page sees an opaque network error. Nothing appears in the
   application logs, because the request never reached the application.

6. **Verify it.** `npm run r2:doctor` sends the exact preflight a browser sends,
   for every origin, then does a real presigned PUT → HEAD → GET → DELETE round
   trip against the bucket:

```bash
npm run r2:doctor
R2_CORS_ORIGINS="https://your-domain.com,http://localhost:3000" npm run r2:doctor
npm run r2:doctor -- --fix   # writes the policy; needs an Admin Read & Write token
```

   Without `R2_CORS_ORIGINS` it checks `APP_URL` and `http://localhost:3000`.
   `--fix` fails with `AccessDenied` on the app's own Object Read & Write token —
   deliberately, since the credentials the app runs on should not be able to
   rewrite the bucket's configuration. Paste the policy it prints into the
   dashboard instead.

> **Why uploads go browser → R2 directly.** A 25MB visa document routed through
> a serverless function would be buffered in a lambda that bills by the
> millisecond and caps request bodies well below that. Instead the server issues
> a short-lived presigned PUT, the browser uploads, and then `/api/files/finalize`
> reads the **stored bytes back** and runs the full security pipeline on them —
> size cap, SVG sanitization, magic-byte sniff, dangerous-MIME denylist,
> image-spoof check — before any database row is written. An object that fails is
> deleted. The browser never skips the checks; it just does not carry the bytes
> through our compute.

---

## 7. Google Cloud OAuth for Calendar

Optional. Skip it and the app runs fine — the integrations page will simply say
Calendar is not configured.

1. At [console.cloud.google.com](https://console.cloud.google.com) create a
   project (or pick one).
2. **APIs & Services → Library** → enable **Google Calendar API**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External** (or Internal for a Workspace-only deployment)
   - Fill in app name, support email, developer email
   - **Scopes** — add exactly these three:
     - `https://www.googleapis.com/auth/calendar.events`
     - `openid`
     - `email`

   > Ask for `calendar.events`, not `calendar`. The narrow scope grants
   > read/write on *events* and nothing else — not calendar creation, not
   > sharing, not the ACL. There is no reason for an EMS to hold the ability to
   > delete a customer's calendars, and no reason to be responsible for it.

   - While in Testing, add your own account under **Test users**. Submit for
     verification before onboarding real customers.

4. **Credentials → Create Credentials → OAuth client ID**:
   - Type: **Web application**
   - Authorized redirect URIs — add both, exactly:
     - `http://localhost:3000/api/integrations/google/callback`
     - `https://your-domain.com/api/integrations/google/callback`

5. Copy the client ID and secret into `GOOGLE_CLIENT_ID` /
   `GOOGLE_CLIENT_SECRET`, and set `GOOGLE_REDIRECT_URI` to match the
   environment you are configuring.

6. **Generate the token encryption key:**

```bash
openssl rand -base64 32
```

   Put it in `GOOGLE_TOKEN_ENCRYPTION_KEY`.

> **This key fails closed.** It must be 64 hex characters or base64 decoding to
> exactly 32 bytes. Anything else is **refused** — connecting a calendar throws
> a clear error rather than silently deriving a weaker key from whatever string
> was configured. A system that reports healthy while protecting OAuth tokens
> with the entropy of `changeme` is worse than one that refuses to start.

### A note on webhooks in development

Google push notifications need a publicly reachable HTTPS address. On
`localhost` the watch subscription is simply skipped and the connection falls
back to the 15-minute incremental sync — which is exactly the fallback that
keeps production reliable when a channel expires. To test push locally, tunnel
with `ngrok http 3000` and set `APP_URL` to the tunnel address.

---

## 8. Run locally

```bash
git clone <your-repo-url> oneclickhr-ems
cd oneclickhr-ems
npm install

cp .env.example .env.local
# fill in .env.local with everything from §1, §4, §6, §7
# and generate a cron secret:  openssl rand -hex 32

npm run dev
```

Open <http://localhost:3000>. The root redirects to `/login`.

Useful commands:

```bash
npm run type-check      # TypeScript, no emit
npm run lint            # ESLint
npm test                # unit tests (timezone, crypto, upload, money)
npm run test:isolation  # cross-tenant isolation, against a real database
npm run build           # production build
```

---

## 9. Deploy to Vercel

1. Push to GitHub, then **Add New → Project** in Vercel and import the repo.
   Framework preset: **Next.js** (detected automatically).
2. **Environment Variables** — add every variable from `.env.example`, for
   Production and Preview. Two of them must differ from your local values:

   | Variable | Production value |
   |---|---|
   | `APP_URL` | `https://your-domain.com` |
   | `GOOGLE_REDIRECT_URI` | `https://your-domain.com/api/integrations/google/callback` |

3. Deploy.
4. Go back and update, now that you know the domain:
   - **Supabase → Authentication → URL Configuration** — Site URL and redirect
     allowlist
   - **Supabase → Authentication → Emails → Templates** — re-paste
     `supabase/templates/*.html` if you generated them against a different Site
     URL (§4c)
   - **Google Cloud → Credentials** — authorized redirect URI
   - **Cloudflare R2 → CORS** — `AllowedOrigins`
5. Prove the auth email path works on the deployment **before** announcing it:

   ```bash
   npm run auth:doctor -- https://your-domain.com
   ```

   Every env-var change needs a redeploy before it takes effect, so run this
   after the redeploy, not before.

---

## 10. Schedule the background jobs

Scheduling is external and there is exactly one supported scheduler:
**cron-job.org**. Vercel Cron and pg_cron are deliberately not used — Vercel's
Hobby plan only allows one run per day (too infrequent for the calendar
fallback), and pg_net is fire-and-forget, so a 500 from the app would show up as
a green run.

Sign up at [cron-job.org](https://cron-job.org), then create **three** jobs. All
use the same settings apart from the URL and the schedule:

| Setting | Visa reminders | Calendar sync fallback | Résumé sweep |
| --- | --- | --- | --- |
| URL | `https://your-domain.com/api/cron/visa-reminders` | `https://your-domain.com/api/cron/calendar-sync` | `https://your-domain.com/api/cron/jobs-gc` |
| Schedule | Daily at **03:30 UTC** | Every **15 minutes** | Daily at **04:00 UTC** |
| Request method | `POST` | `POST` | `POST` |
| Header | `x-cron-secret: <your CRON_SECRET>` | `x-cron-secret: <your CRON_SECRET>` | `x-cron-secret: <your CRON_SECRET>` |
| Save responses | on | on | on |

> **The résumé sweep is not optional if you run the job portal.**
> `/api/jobs/resume-presign` is the one write an unauthenticated visitor can
> cause, so a CV attached by someone who then closed the tab leaves an object no
> row will ever reference. Without this job those accumulate indefinitely — other
> people's personal data, stored forever, for no reason. It only deletes objects
> older than 24 hours that no application points at.

For each job:

1. **Common → Title** — name it, e.g. `EMS visa reminders`.
2. **Common → Execution schedule** — pick the schedule above. cron-job.org
   schedules in the timezone selected on the job, so either set the job's
   timezone to UTC and use `03:30`, or leave it in your own timezone and convert.
   The endpoint recomputes the day difference in **each tenant's** timezone, so
   one daily run serves every timezone — you do not need a job per tenant.
3. **Advanced → Request method** — `POST`.
4. **Advanced → Headers** — add `x-cron-secret` with your `CRON_SECRET` value
   (the same one set in Vercel). This is the only thing authenticating the job;
   without it the endpoint answers 401.
5. **Advanced → Save responses in job history** — enable it, so a failed run
   shows you the actual error body.
6. **Notifications** — enable *failure* notifications for both jobs.

> **Why the notifications and the response history matter.** These endpoints
> answer **500 on a fatal failure** on purpose, so a scheduler treats it as a
> real failure instead of showing a green tick. cron-job.org only turns a run red
> if you let it see the status — leave failure notifications on, or the visa
> engine can stop working for a month while the job list looks healthy. A cron
> job that fails silently is worse than no cron job, because you believe it is
> working.
>
> A run can also answer **200 with a non-empty `errors` array**: the run worked,
> but some tenants failed. That is deliberate — one bad tenant should not cause a
> retry of everything — and it is why saved responses are worth the setting.
> `/super/system` records every run either way.

Free-tier note: cron-job.org waits up to 30 seconds for a response and aborts
after that. Both handlers set `maxDuration = 60`, so a slow run may be marked
failed on the scheduler side even though it completed server-side. Check
`/super/system` before trusting a timeout, and enable the paid longer timeout if
your tenant count grows.

### Upgrading from an earlier setup

If you previously scheduled these jobs with Vercel Cron or pg_cron, both are
gone: `vercel.json` no longer declares any `crons`, and running the current
`004_cron.sql` unschedules `ems-visa-reminders`, `ems-calendar-sync` and
`ems-cron-monitor` and drops their helper functions. Redeploy and run `004`
once, or the jobs double-fire.

### Verify

Sign in as the super admin and open **/super/system**. Every run — success or
failure — is recorded there, so "the visa engine has not run in six days" is
something you can *see* rather than discover when a reminder does not arrive.

Trigger one by hand:

```bash
curl -fsS -X POST \
  -H "x-cron-secret: $CRON_SECRET" \
  https://your-domain.com/api/cron/visa-reminders
```

---

## 11. Verification checklist

Work through this against a real deployment. Each item corresponds to something
the system is supposed to guarantee.

### Cross-device email confirmation

- [ ] Sign up for a new organization **on a desktop browser**.
- [ ] Open the confirmation email **on your phone** and tap the link.
- [ ] It confirms and redirects to the login page — no `code_verifier` error.
- [ ] Return to the desktop and sign in. You land on `/onboarding`, then `/org`.

*If this fails, the email templates in Supabase are still the stock ones —
Supabase is sending its own `?code=` link, which cannot work on a second
device. Run `npm run email:templates` and paste both files. See §4c.*

### Cross-tenant isolation

- [ ] `npm run test:isolation` reports **ALL CHECKS PASSED**.

The script signs in as real users with the anon key, so every assertion is
evaluated by RLS — exactly the path a browser takes. It covers reads and writes
in both directions, direct-id access with no tenant filter, employee-to-employee
isolation inside one tenant, and the audit trail's immutability.

Manually, for confidence:

- [ ] Sign in as Org A, note an employee's URL, e.g. `/org/employees/<uuid>`.
- [ ] Sign in as Org B and paste that exact URL. You get **404**, not the record.

### Deactivation is immediate

- [ ] Sign in as an employee in one browser and leave the dashboard open.
- [ ] In another browser, as their org, deactivate them.
- [ ] Back in the first browser, navigate anywhere. You are redirected to
      *Your account is deactivated* — **without waiting for the session to
      expire**.

*This is the property `app.is_active_member()` exists for. If it took an hour,
the check would be reading a JWT claim instead of the table.*

### Tenant suspension

- [ ] As super admin, suspend an organization from `/super/organizations`.
- [ ] Every user of that workspace immediately sees *This workspace is
      suspended*.
- [ ] Reactivate. Access returns on the next request.

### Visa reminders fire once per milestone

- [ ] Add a work authorization expiring in exactly 90 days.
- [ ] Trigger the cron by hand (command in §10). The response reports `sent: 1`.
- [ ] Trigger it **again immediately**. The response reports `alreadyLogged: 1`
      and `sent: 0` — no second email.
- [ ] Confirm the ledger:

```sql
select work_auth_id, milestone, sent_at from public.visa_reminder_logs;
```

*The guarantee is not a check-then-send — that is a race two overlapping runs
would both pass. It is `UNIQUE(work_auth_id, milestone)`: the ledger row is
INSERTED FIRST and the email only sends if that insert won. The database, not
the application, is what makes this idempotent, and it holds across restarts,
retries and double-scheduling.*

- [ ] Edit the record's expiry date. The reminder history clears, so the
      milestones fire again for the new date. (A renewed visa that could never
      remind again would be the worse bug.)

### Google Calendar syncs both ways

- [ ] Connect from `/org/settings/integrations`. It refuses if Google returned
      no refresh token, rather than storing a connection that dies in an hour.
- [ ] **App → Google**: create a meeting in `/org/meetings`. It appears in
      Google Calendar within seconds.
- [ ] **Google → App**: create an event directly in Google Calendar. It appears
      in `/org/meetings` marked *From Google* and *Read only*.
- [ ] Edit the Google-created event in Google. The change flows back.
- [ ] Delete an app-created meeting. It disappears from Google too.

### Uploads reject spoofed and dangerous files

- [ ] Rename any `.exe` (or any binary) to `payslip.pdf` and upload it as a
      payslip. **Rejected** — the magic bytes are checked, not the extension.
- [ ] Try uploading a `.txt` renamed to `photo.png` as an employee photo.
      **Rejected** as not a valid image.
- [ ] Upload an SVG logo containing `<script>alert(1)</script>`. It is
      **accepted**, but download it back — the script is gone. The sanitized
      bytes replaced the original in storage; the original was never reachable.
- [ ] Confirm no orphan was left behind: a rejected upload deletes its object.

### Files are private

- [ ] Copy a signed download URL and wait 15 minutes. It stops working.
- [ ] Sign in as an employee and try another employee's payslip key at
      `/api/files/view?key=<their-key>`. **404**.
- [ ] Confirm the R2 bucket has no public access enabled.
- [ ] As super admin, try a customer's file key. **404** — platform oversight
      covers account state and usage, not reading customers' documents.

### Auth hardening

- [ ] Fail a login 11 times with the same email. The 11th is refused with a
      lockout message.
- [ ] Do the same with an email that **does not exist**. Identical behaviour —
      the lockout is not an account-existence oracle.
- [ ] Sign up with an email that already exists. The response is the same
      success message as a new signup.
- [ ] Request a password reset for a non-existent address. Same "if that address
      has an account" response.

### Employee scope

- [ ] Sign in as an employee. There is no Invoices, Payroll or Employees nav.
- [ ] `/org` redirects to `/employee`.
- [ ] They see only their own attendance, leaves and payslips.
- [ ] On the task board they can drag only cards assigned to them.

### Forced password change

- [ ] Create an employee. Sign in with the temporary password.
- [ ] Every route redirects to `/change-password` until a new password is set.
- [ ] After setting it, the temporary password no longer works.

---

## 12. Troubleshooting

**`infinite recursion detected in policy for relation "profiles"`**
A policy is sub-selecting the table it protects. Every membership check must go
through a `SECURITY DEFINER` helper in the `app` schema — see the note at the
top of `002_rls.sql`.

**Every query fails with `role "org" does not exist`**
The access-token hook is writing to the reserved `role` claim. It must write
`user_role`. Re-apply `003_auth_hook_and_triggers.sql`.

**`Could not find the function public.current_profile ... in the schema cache`**
The migrations in §2 have not been applied to the project this deployment points
at. Sign-in itself succeeds — Supabase Auth is a separate schema — and then every
page refuses the caller because no profile exists, which is why it surfaces as a
sign-in that lands on an "account not set up" page rather than as a database
error. Run `001`–`003`, then `006_backfill_missing_profiles.sql` to give the
accounts that signed up in the meantime their profile and workspace.

**Someone signed up while the triggers were missing and is now locked out**
Their `auth.users` row exists and their profile never will — `on_auth_user_created`
fires on INSERT only. Run `006_backfill_missing_profiles.sql`; it is idempotent
and lists anything it could not repair.

**Signup succeeds but the user has no tenant**
The provisioning trigger did not run. Confirm
`on_profile_created_provision_tenant` exists on `public.profiles`, then check
the Postgres logs for the trigger's exception.

**Employees are each getting their own tenant**
`007` has not been applied. The guard in `003` returns early unless
`new.role = 'org' AND new.tenant_id IS NULL`, which looks sufficient but is not:
at `AFTER INSERT` time an admin-created employee still reads as `role = 'org'`
with no tenant, because GoTrue applies `app_metadata` in a second write. Apply
`007_fix_employee_provisioning.sql` — it also repairs the existing rows.

**An employee's credentials are refused on the sign-in page**
There are two doors. Employees sign in at `/employee-login`; `/login` is for
organization owners and platform admins, and refuses an employee with the same
message a wrong password gets (telling them apart would leak which addresses are
registered and what kind of account they are). The credentials email and the
"employee created" screen both quote `/employee-login`.

**Confirmation link fails with a `code_verifier` error**
The Supabase email template is still the stock `{{ .ConfirmationURL }}` one, so
the link is a PKCE `?code=` url that only works in the browser that started the
sign-up. Paste the generated templates (`npm run email:templates`), which link to
`/auth/confirm?token_hash=…` instead. See §4c.

**Sign-up fails with "we could not send the confirmation email"**
Supabase could not hand the message to SMTP. Check §4b (custom SMTP on, sender
domain verified in Resend) and the email rate limit under Authentication → Rate
Limits. The app log carries the GoTrue status on the `[signup] failed` line. If
you have enabled the optional Send Email hook, check §4e — a hook answering
non-2xx aborts every sign-up.

**Uploads fail — "Could not reach file storage", or nothing but a network error
in the console**
The R2 bucket CORS policy does not include your origin, or omits `PUT` /
`content-type`. This is the usual cause of an upload that works locally and
fails in production: `localhost:3000` was allowed, the deployed domain never
was. Run `R2_CORS_ORIGINS="https://your-domain.com" npm run r2:doctor` — a
`preflight → 403` line names it exactly. See §6 steps 5–6.

**An upload route answers 500 with a body that is not JSON**
Every handler is wrapped in `withErrorHandler`, so a 500 carrying no `error` key
did not come from application code — the function failed to BOOT, before any
handler existed. The cause is a module-load failure in something the route
imports. `/api/files/presign` used to import `@/lib/upload`, which statically
required DOMPurify → jsdom (799 files traced into that function) for a route
that never touches an SVG. It now imports `@/lib/upload-policy`, which has no
optional dependencies at all — 150 files traced, jsdom nowhere in them. If you
add an import to an upload route, keep the heavy ones behind `await import()`
the way `file-type`, `unpdf` and DOMPurify are.

**`/api/files/presign` answers 500 and the page just says "Something went wrong"**
An R2 variable is malformed rather than missing. The usual cause is pasting a
value into a dashboard **with the quotes**: `R2_ENDPOINT="https://…"` stores the
quote characters, `new URL()` throws `TypeError: Invalid URL` inside the SDK, and
the failure surfaces as an unexplained 500. Quotes and stray whitespace are now
stripped on read, and anything still unusable answers **503 naming the variable**
(never its value). Also check `R2_ENDPOINT` is the bare host — Cloudflare's
bucket page shows it with the bucket appended, which belongs in `R2_BUCKET`.

**Uploads fail with a checksum mismatch**
The S3 client is computing a CRC32 that ends up in the presigned url as
`x-amz-checksum-crc32` — the checksum of an empty body, since there is no body
at signing time. `src/lib/r2.ts` sets `requestChecksumCalculation:
'WHEN_REQUIRED'` to prevent it; `npm run r2:doctor` asserts the signed url stays
clean.

**Google Calendar: "Google did not return a refresh token"**
Google only issues one on first consent. The user must remove the app at
[myaccount.google.com/permissions](https://myaccount.google.com/permissions) and
connect again. (The authorize URL already sends `prompt=consent`, which normally
prevents this.)

**Calendar connection shows `needs_reauth`**
Either the org revoked access in their Google account, or
`GOOGLE_TOKEN_ENCRYPTION_KEY` changed. Tokens encrypted under the old key cannot
be decrypted — rotating that key requires reconnecting every calendar.

**Cron endpoints answer 503**
`CRON_SECRET` is unset or shorter than 16 characters. It is a 503 rather than a
401 on purpose: the job is not misauthenticated, the *server* is misconfigured,
and an external scheduler surfaces that as a failed run rather than a silent no-op.

**Visa reminders never send**
Check `/super/system` first — it shows whether the job ran at all. If it ran but
sent nothing, confirm `RESEND_API_KEY` and `EMAIL_FROM` are set and that the
expiry dates are exactly 90, 30, 7 or 0 days out **in the org's timezone**.

**Times or dates look shifted by a day**
Something is computing a calendar day in UTC instead of the org's timezone.
Attendance days, late-login checks and visa day-diffs must all go through the
helpers in `src/lib/time.ts`, which take the timezone explicitly.

---

## Reference

| Topic | Where |
|---|---|
| Tenant isolation model | `supabase/migrations/002_rls.sql` |
| Trust boundary at signup | `supabase/migrations/003_auth_hook_and_triggers.sql` |
| The three Supabase clients | `src/lib/supabase/` |
| Server authorization gates | `src/lib/auth/guards.ts` |
| Upload security pipeline | `src/lib/upload.ts` |
| Fail-closed encryption | `src/lib/crypto.ts` |
| Timezone rules | `src/lib/time.ts` |
| Idempotent visa engine | `src/app/api/cron/visa-reminders/route.ts` |
| Two-way calendar sync | `src/lib/calendar-sync.ts` |
| Isolation proof | `scripts/tenant-isolation-test.ts` |
