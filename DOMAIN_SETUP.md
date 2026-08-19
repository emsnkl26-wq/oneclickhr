# Production URL — where it's configured

The app's production domain is:

```
https://app.oneclickhr.app
```

The apex `oneclickhr.app` (and `www.oneclickhr.app`) is reserved for a
separate marketing site — a different Vercel project, deployed and domain'd
independently. This app (the EMS product) lives entirely on the `app.`
subdomain. The two projects share nothing but the parent domain.

This value is **not read from one place** — it's copy-pasted into several
external dashboards and one env var. Nothing in the codebase hardcodes a
domain (checked — the only fallback is `localhost:3000` in
[src/lib/env.ts](src/lib/env.ts#L172), used only when `APP_URL` is unset), so
cutting over is purely a config/dashboard checklist, not a code change.

The old `https://nextkin-ems.vercel.app` deployment URL is retired. Go through
every row below and set the new value.

## Checklist

| # | Where | What to set | Value | Status |
|---|---|---|---|---|
| 1 | **Vercel** → this project (EMS) → Settings → Domains | Add domain | `app.oneclickhr.app`, set as Production | ⬜ |
| 2 | Same place | Remove `oneclickhr.app` and `www.oneclickhr.app` from this project | they belong to the marketing site, not the EMS app | ⬜ |
| 3 | **Vercel** → this project → Settings → Environment Variables (Production) | `APP_URL` | `https://app.oneclickhr.app` | ⬜ |
| 4 | Same as above | `GOOGLE_REDIRECT_URI` | `https://app.oneclickhr.app/api/integrations/google/callback` | ⬜ (only if Google Calendar integration is used) |
| 5 | **Supabase** → Authentication → URL Configuration | Site URL | `https://app.oneclickhr.app` | ⬜ |
| 6 | Same as above | Redirect URLs allowlist — add | `https://app.oneclickhr.app/**` | ⬜ |
| 7 | **Google Cloud Console** → APIs & Services → Credentials → your OAuth client | Authorized redirect URIs — add | `https://app.oneclickhr.app/api/integrations/google/callback` | ⬜ (only if Google Calendar integration is used) |
| 8 | Same client | Authorized JavaScript origins — add | `https://app.oneclickhr.app` | ⬜ |
| 9 | **Google Cloud Console** → OAuth consent screen | App name / Authorized domains | App name `Oneclickhr`; Authorized domains: `oneclickhr.app` (Google wants the apex registrable domain — covers every subdomain including `app.`) | ⬜ |
| 10 | **Cloudflare R2** → bucket (see note below) → Settings → CORS Policy | `AllowedOrigins` — add | `https://app.oneclickhr.app` | ⬜ **← every upload in production fails until this is done. Check with `R2_CORS_ORIGINS="https://app.oneclickhr.app" npm run r2:doctor`** |
| 11 | **cron-job.org** → both jobs (visa reminders, calendar sync) | Job URL | `https://app.oneclickhr.app/api/cron/visa-reminders` and `.../api/cron/calendar-sync` | ⬜ |
| 12 | **Resend** → Domains | Verified sending domain | `oneclickhr.app` (apex — SPF/DKIM/return-path DNS records; sender addresses don't use a subdomain) | ⬜ |
| 13 | **Resend** / Supabase SMTP settings | `EMAIL_FROM` / Sender email | `Oneclickhr <no-reply@oneclickhr.app>` | ⬜ |

Rows 5–6 control the link inside Supabase's own confirmation/reset-password
emails (`{{ .SiteURL }}` in the template — see SETUP.md §4c), so if Site URL is
wrong, signup confirmation links point at the wrong host regardless of what
`APP_URL` says.

`localhost:3000` entries (in Supabase's redirect allowlist, R2 CORS, Google's
redirect URIs) should stay in place alongside the production ones — you still
need them for local development. Don't remove them when adding the production
row.

**On row 2:** `oneclickhr.app` and `www.oneclickhr.app` are currently attached
to *this* Vercel project, left over from before the subdomain split. Detaching
them will make the bare domain 404/unassigned until the marketing project
exists and claims it — that's expected and fine; the EMS app doesn't need the
apex to resolve to anything. `app.oneclickhr.app` is a fully independent
subdomain, DNS-wise (its own `CNAME` pointing at Vercel), so removing the
apex/`www` from this project has no effect on it.

**Note on row 10 (R2 bucket):** the bucket is still named `nextkinlife-ems`
(set via `R2_BUCKET` in the environment). Cloudflare R2 bucket names cannot be
renamed in place — doing so would mean creating a new bucket and migrating
every stored file (photos, payslips, visa documents, org logos) across. The
bucket name is an internal storage identifier only; it is never shown to a
user, so it was left as-is. Only its CORS `AllowedOrigins` needs the new
domain.

## Cutover order

1. Add `app.oneclickhr.app` to this Vercel project and set it Production
   (row 1); add the DNS record your registrar needs (Vercel's Domains page
   shows the exact `CNAME` once you add it).
2. Remove `oneclickhr.app` and `www.oneclickhr.app` from this project (row 2).
3. Update env vars (rows 3–4) and redeploy — env var changes don't apply to
   already-running deployments.
4. Update Supabase Site URL + redirect allowlist (rows 5–6).
5. Update Google Cloud OAuth redirect URI, JS origin, and consent screen
   branding (rows 7–9) if Google Calendar is used.
6. Update R2 CORS (row 10) — verify with `npm run r2:doctor`.
7. Update the two cron-job.org job URLs (row 11) — nothing errors loudly if
   you forget this; visa reminders just silently stop running against the old
   host.
8. Verify Resend's domain (row 12) and set the sender identity (row 13).
9. Re-run the cross-device email confirmation check from SETUP.md §11 against
   `https://app.oneclickhr.app` before considering the cutover done.

## When the marketing site project is ready

1. In the marketing site's Vercel project, add `oneclickhr.app` and
   `www.oneclickhr.app` as its domains.
2. If they're still attached to the EMS project (per row 2), remove them
   there first — a domain can only be attached to one Vercel project at a
   time.
3. Nothing in *this* app needs to change — `app.oneclickhr.app` is unaffected
   by whatever the apex points to.
