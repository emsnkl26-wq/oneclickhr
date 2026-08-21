/**
 * Renders the Supabase Auth email templates from this app's own branded layout.
 *
 *   npm run email:templates      writes supabase/templates/*.html
 *
 * WHY THIS EXISTS
 *
 * Auth email is sent by Supabase's SMTP sender (Resend), not by this app, so the
 * template lives in the Supabase dashboard rather than in code. Two things would
 * otherwise go wrong, and both are silent:
 *
 *  1. BRANDING. Supabase's stock template is unstyled text. Rendering from
 *     src/lib/email-layout.ts instead means the confirmation email looks like
 *     every other email the product sends, and stays that way when the layout
 *     changes — re-run this script and re-paste.
 *
 *  2. THE LINK. This is the one that breaks people. Supabase's default
 *     `{{ .ConfirmationURL }}` is a PKCE `?code=` link, and exchanging that code
 *     needs a `code_verifier` held in the localStorage of the browser that
 *     STARTED the signup. Sign up on a laptop, open the email on your phone, and
 *     it fails with "both auth code and code verifier should be non-empty".
 *     People read email on their phones, so that is most sign-ups, not an edge
 *     case.
 *
 *     These templates use `{{ .TokenHash }}` against this app's /auth/confirm
 *     route, which verifies server-side with no browser state at all — the same
 *     device-independent flow the app has always relied on. See the header
 *     comment in src/app/auth/confirm/route.ts.
 *
 * The output is paste-ready: Supabase Dashboard → Authentication → Emails →
 * (Confirm signup | Reset password) → paste the file's contents → Save.
 */
import fs from 'fs'
import path from 'path'
import { layout, button, esc } from '../src/lib/email-layout'

/**
 * `{{ .SiteURL }}` must be the app origin (Authentication → URL Configuration).
 * `type` tells /auth/confirm which verifyOtp flow to run, and it must match the
 * template it appears in — a signup token verified as `recovery` is rejected.
 */
const confirmLink = (type: 'signup' | 'recovery') =>
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=${type}`

const FOOT_NOTE = (extra: string) =>
  `<p style="margin:18px 0 0;font-size:13px;color:#6B7280;">${extra}</p>`

const fallbackLine = (link: string) =>
  `<p style="margin:18px 0 0;font-size:12px;color:#9CA3AF;word-break:break-all;">
      Button not working? Paste this into your browser:<br>${link}
    </p>`

const templates: Record<string, string> = {
  'confirm-signup.html': layout(
    `
    <h1 style="margin:0 0 14px;font-size:21px;font-weight:700;letter-spacing:-0.3px;">Confirm your workspace</h1>
    <p style="margin:0 0 18px;">
      Thanks for signing up. Click below to confirm your email address and activate
      your organization's workspace.
    </p>

    ${button(confirmLink('signup'), 'Confirm my email')}

    ${FOOT_NOTE(
      `This link works on any device — open it on your phone if that's where you're
      reading this. It expires in 24 hours. If you did not create this account, you
      can safely ignore this email.`
    )}

    ${fallbackLine(confirmLink('signup'))}
  `,
    { brandName: 'Oneclickhr', preheader: 'Confirm your email to activate your workspace' }
  ),

  'reset-password.html': layout(
    `
    <h1 style="margin:0 0 14px;font-size:21px;font-weight:700;letter-spacing:-0.3px;">Reset your password</h1>
    <p style="margin:0 0 18px;">
      We received a request to reset the password on your account. Click below to
      choose a new one.
    </p>

    ${button(confirmLink('recovery'), 'Choose a new password')}

    ${FOOT_NOTE(
      `This link works on any device and expires in 1 hour. If you did not request
      this, you can ignore this email — your password will not change.`
    )}

    ${fallbackLine(confirmLink('recovery'))}
  `,
    { brandName: 'Oneclickhr', preheader: 'Reset your Oneclickhr password' }
  ),
}

const outDir = path.join(process.cwd(), 'supabase', 'templates')
fs.mkdirSync(outDir, { recursive: true })

let problems = 0
for (const [name, html] of Object.entries(templates)) {
  // esc() turns `&` into `&amp;`, which is correct inside an href and renders
  // back to `&` — but a mangled Supabase variable would be silent breakage, so
  // assert the two that matter survived intact.
  for (const needle of ['{{ .SiteURL }}', '{{ .TokenHash }}']) {
    if (!html.includes(needle)) {
      console.error(`  ✗ ${name}: ${needle} did not survive rendering`)
      problems++
    }
  }
  if (html.includes('{{ .ConfirmationURL }}')) {
    console.error(`  ✗ ${name}: still uses the PKCE ConfirmationURL — cross-device links will fail`)
    problems++
  }
  fs.writeFileSync(path.join(outDir, name), html)
  console.log(`  ✓ supabase/templates/${name}`)
}

console.log(
  problems === 0
    ? '\nPaste each file into Supabase → Authentication → Emails, then Save.\n'
    : `\n${problems} problem(s) — do not paste these.\n`
)
process.exit(problems === 0 ? 0 : 1)

/** Keeps `esc` imported for future template work without tripping noUnusedLocals. */
void esc
