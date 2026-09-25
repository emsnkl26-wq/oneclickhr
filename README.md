# OneclickHR

A multi-tenant Employee Management System, built as SaaS. Each customer
organization gets an isolated workspace for attendance, leave, payroll,
invoicing, H-1B work authorization tracking, meetings and tasks.

**Setup lives in [SETUP.md](./SETUP.md).** This file is the map.

---

## The three roles

| Role | Created how | Sees |
|---|---|---|
| **Super admin** | Seeded directly in Supabase (§5 of SETUP) | Every organization — metrics, account state, audit log. Read-only across tenants. |
| **Organization** | Self-signup with email confirmation | Its own workspace, entirely |
| **Employee** | Created by an organization — **no self-signup** | Only their own attendance, leave, payslips, and assigned tasks |

All three are real Supabase Auth users. There are no hand-rolled sessions.

---

## Tenancy, in one paragraph

One database, one shared schema. Every tenant-scoped table carries a
`tenant_id NOT NULL` with an index, and RLS is enabled on every table without
exception. A user's tenant and role are injected into their JWT by a custom
access-token hook, so policies answer from a claim rather than a per-request
lookup. Isolation is enforced by Postgres, not by remembering to write a filter
— which is why the tenant boundary holds even for a query nobody thought about.

Two things that follow from that, and are easy to get wrong:

- **Membership checks are `SECURITY DEFINER` functions.** A policy on `profiles`
  that sub-selects `profiles` recurses infinitely. Every such check lives in the
  `app` schema and runs as its owner. Never inline a sub-select against a table
  into that table's own policy.
- **`is_active` is read from the table on every check, not from the JWT.** A
  token is valid for an hour; deactivation has to bite on the next request.

---

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind + Radix · Supabase (Postgres,
Auth, RLS, Realtime) · Cloudflare R2 · Resend · Google Calendar API · dnd-kit ·
Zod · Vitest

---

## Layout

```
src/
  app/
    (auth)/            login, signup, forgot-password, reset-password
    auth/confirm/      device-independent email confirmation (token_hash)
    org/               the customer portal — 12 screens
    employee/          the teammate portal
    super/             the platform console
    api/               all mutations, Zod-validated and audited
  components/
    ui/                button, input, card, primitives, patterns, form-field
    shell/             sidebar, app shell, per-org theming
    board/             Kanban with dnd-kit + Realtime
  lib/
    supabase/          the three clients — browser, server-user, admin
    auth/              context + gate helpers
    ...                crypto, upload, r2, email, time, invoice, calendar-sync
supabase/migrations/   001 schema · 002 RLS · 003 hook+triggers · 004 cron teardown · 005 seed
scripts/               tenant-isolation-test.ts
```

### The three Supabase clients

The separation is load-bearing, so it is worth stating plainly:

| Client | Key | Use |
|---|---|---|
| `lib/supabase/client.ts` | anon | Browser reads and Realtime. RLS-scoped. |
| `lib/supabase/server.ts` | anon, cookie-bound | **Default for everything.** Runs as the real user, so RLS `WITH CHECK` and validation triggers actually fire. |
| `lib/supabase/admin.ts` | service_role | Creating auth users, super-admin reads, cron. **Bypasses RLS entirely** — every query must re-filter `tenant_id` from the session. |

---

## Things built a particular way, and why

**Email confirmation uses `token_hash`, not the default `?code=` link.** The
PKCE code flow needs a `code_verifier` from the browser that started the signup.
Sign up on a laptop, open the email on a phone, and it fails. `/auth/confirm`
verifies server-side with no browser state, so the link works from anywhere.

**Employee creation rolls back.** Creating a teammate is two writes across two
systems. If the profile write fails after the auth user exists, the auth user is
deleted — otherwise you get an account that can sign in, has no tenant, matches
no policy, and permanently blocks that email address.

**The visa engine claims before it sends.** The ledger row is INSERTed first and
the email only goes out if that insert won. `UNIQUE(work_auth_id, milestone)` is
what makes it idempotent — not a check-then-send, which two overlapping cron runs
would both pass.

**Uploads are validated after they land.** The browser PUTs directly to R2, then
`/api/files/finalize` reads the stored bytes back and runs the full pipeline —
size cap, SVG sanitization, magic-byte sniff, MIME denylist, image-spoof check —
before writing any row. A file that fails is deleted.

**The token encryption key fails closed.** A malformed
`GOOGLE_TOKEN_ENCRYPTION_KEY` throws instead of being hashed into 32 bytes.
Silently downgrading AES-256 to the entropy of whatever someone typed is worse
than refusing to start.

**Cron failures are loud.** Both jobs are driven by [cron-job.org](https://cron-job.org)
— the one supported scheduler (SETUP.md §10) — over HTTP with an
`x-cron-secret` header. Every run records its outcome in `cron_runs` (visible at
`/super/system`) and answers 500 on a fatal error, so the scheduler marks the
run failed and notifies instead of showing a green tick. A cron job that fails
silently is worse than no cron job.

**Calendar days are computed in the org's timezone.** Attendance days,
late-login checks and visa day-diffs all go through `src/lib/time.ts`, which
takes a timezone explicitly. A lambda runs in UTC; a 9am IST clock-in filed
under the previous day is wrong in a way nothing reports.

**The brand has one source of truth.** Name, tagline, palette and asset sizes
live in `src/lib/brand.ts`; the same palette is mirrored as CSS variables in
`src/app/globals.css` (a test fails if the two drift). Draw the logo with
`<BrandLogo>` (`src/components/brand/logo.tsx`), which swaps the light and dark
artwork with CSS. Orange **fills and icons** use `bg-brand-600` / `text-brand-600`;
orange **text** uses `text-brand-ink`, because #FF6A00 on white is only 2.9:1.
Errors are `danger` (a real red) — never brand-coloured, since a workspace can
re-brand itself to any colour.

Every image under `public/brand/`, `public/icons/` and `public/favicon.ico` is
**generated** from the two source logos, `public/logo.png` (the mark) and
`public/long logo.png` (the lockup): `npm run brand:assets`. Change the logo by
replacing those two files and re-running it — do not hand-edit the outputs.

---

## Commands

```bash
npm run dev             # development server
npm run build           # production build
npm run type-check      # TypeScript
npm run brand:assets    # regenerate logos, favicons, app icons and social cards
npm test                # unit tests — timezone, crypto, upload, money
npm run test:isolation  # cross-tenant isolation, against a real database
```

`npm run test:isolation` signs in as real seeded users with the anon key, so
every assertion is evaluated by RLS — the same path a browser takes. It checks
reads and writes in both directions, direct-id access with no tenant filter,
employee-to-employee isolation, immediate deactivation, tenant suspension, and
the audit trail's immutability.

---

## Not built, deliberately

No billing, subscriptions or plan tiers. No hand-rolled portal sessions or
magic-link auth. No I-9 workflow — the visa module is H-1B expiry reminders
only. No marketing site; the root redirects to login or the role's dashboard.
