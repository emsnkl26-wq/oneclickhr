import 'server-only'

/**
 * Transactional email via Resend.
 *
 * Two distinct paths, and it matters which is which:
 *   • AUTH email (confirm signup, password reset) is sent from here too, but
 *     triggered by Supabase's "Send Email" Auth Hook rather than a direct
 *     caller — see src/lib/auth-email.ts and
 *     src/app/api/auth/send-email-hook/route.ts. Supabase's own SMTP sender
 *     never fires once that hook is enabled (SETUP.md §4).
 *   • PRODUCT email (employee credentials, visa reminders) is sent from here
 *     directly, with the Resend API.
 *
 * Sending NEVER throws into a business flow. If an employee's credential email
 * bounces, the account still exists and the org still has the password on screen
 * to share by hand. Callers get `{ ok: false }` and decide what to tell the user.
 */
import { Resend } from 'resend'
import { appUrl } from '@/lib/env'
import { EMPLOYEE_LOGIN_PATH } from '@/lib/routes'

let client: Resend | null = null

function resend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null
  if (!client) client = new Resend(process.env.RESEND_API_KEY)
  return client
}

export function isEmailConfigured(): boolean {
  return !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM)
}

export interface SendResult {
  ok: boolean
  error?: string
}

interface SendArgs {
  to: string | string[]
  subject: string
  html: string
  text?: string
  replyTo?: string
}

/**
 * Transient failures worth one more try: a network blip, a Resend 5xx, or a
 * burst rate-limit. NONE of these mean an email was accepted, so a retry cannot
 * duplicate a message. A 4xx (unverified domain, malformed address) is a
 * permanent verdict and is returned immediately — retrying it only delays the
 * error the caller needs to see.
 */
function isRetryable(statusCode: number | undefined): boolean {
  if (statusCode === undefined) return true // threw before a response — network
  return statusCode === 429 || statusCode >= 500
}

const RETRY_DELAYS_MS = [250, 1000]

export async function sendEmail({ to, subject, html, text, replyTo }: SendArgs): Promise<SendResult> {
  const api = resend()
  const from = process.env.EMAIL_FROM

  if (!api || !from) {
    console.error('[email] not configured — skipping send', {
      subject,
      RESEND_API_KEY: process.env.RESEND_API_KEY ? 'set' : 'MISSING',
      EMAIL_FROM: process.env.EMAIL_FROM ? 'set' : 'MISSING',
    })
    return { ok: false, error: 'Email is not configured' }
  }

  const recipients = Array.isArray(to) ? to : [to]

  for (let attempt = 0; ; attempt++) {
    try {
      const { error } = await api.emails.send({
        from,
        to: recipients,
        subject,
        html,
        text: text || stripHtml(html),
        ...(replyTo ? { replyTo } : {}),
      })

      if (!error) return { ok: true }

      // Resend's error carries a machine-readable `name` ("validation_error",
      // "restricted_api_key", …) and a human `message` that names the actual
      // problem. Both are about OUR configuration, never about the recipient,
      // so both are safe to log and to hand back to the caller.
      const statusCode = (error as { statusCode?: number }).statusCode
      const detail = `${error.name || 'send_error'}: ${error.message || 'unknown'}`

      if (isRetryable(statusCode) && attempt < RETRY_DELAYS_MS.length) {
        console.warn(`[email] send failed (attempt ${attempt + 1}), retrying —`, {
          subject,
          statusCode,
          detail,
        })
        await sleep(RETRY_DELAYS_MS[attempt])
        continue
      }

      console.error('[email] send failed', { subject, statusCode, detail })
      return { ok: false, error: detail }
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Email delivery failed'
      if (attempt < RETRY_DELAYS_MS.length) {
        console.warn(`[email] send threw (attempt ${attempt + 1}), retrying —`, {
          subject,
          detail,
        })
        await sleep(RETRY_DELAYS_MS[attempt])
        continue
      }
      console.error('[email] send threw', { subject, detail })
      return { ok: false, error: `Email delivery failed: ${detail}` }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Branded layout
// ---------------------------------------------------------------------------

export function esc(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export interface LayoutOptions {
  brandName?: string
  brandColor?: string
  preheader?: string
}

/**
 * Table-based layout with inline styles — the only thing that renders reliably
 * across Outlook, Gmail and Apple Mail. `brandColor` lets an org's email carry
 * its own colour, defaulting to Oneclickhr crimson.
 */
export function layout(bodyHtml: string, opts: LayoutOptions = {}): string {
  const brandName = esc(opts.brandName || 'Oneclickhr')
  const brand = /^#[0-9a-fA-F]{6}$/.test(opts.brandColor || '') ? opts.brandColor! : '#C41E33'
  const preheader = opts.preheader ? esc(opts.preheader) : ''

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${brandName}</title>
</head>
<body style="margin:0;padding:0;background:#F6F7F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,Helvetica,Arial,sans-serif;color:#1A1C23;">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F7F9;padding:32px 12px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid #E7E9EE;border-radius:14px;overflow:hidden;">
      <tr>
        <td style="background:#16181F;padding:22px 28px;">
          <span style="color:#FFFFFF;font-size:17px;font-weight:700;letter-spacing:-0.2px;">
            ${brandName}
          </span>
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${brand};margin-left:8px;vertical-align:middle;"></span>
        </td>
      </tr>
      <tr><td style="padding:32px 28px;font-size:15px;line-height:1.65;color:#1A1C23;">
        ${bodyHtml}
      </td></tr>
      <tr>
        <td style="padding:18px 28px;background:#FAFBFC;border-top:1px solid #E7E9EE;font-size:12px;line-height:1.6;color:#6B7280;">
          This is an automated message from ${brandName}. If it looks unexpected, you can ignore it.
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`
}

export function button(href: string, label: string, brand = '#C41E33'): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
  <tr><td style="border-radius:10px;background:${brand};">
    <a href="${esc(href)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:10px;">${esc(label)}</a>
  </td></tr>
</table>`
}

// ---------------------------------------------------------------------------
// Product emails
// ---------------------------------------------------------------------------

export interface CredentialEmailArgs {
  to: string
  fullName: string
  tempPassword: string
  orgName: string
  brandColor?: string
}

/**
 * The one time a temporary password is ever transmitted. It is not stored
 * anywhere, is single-use in practice (`must_change_password` forces a reset at
 * first login), and the copy says so plainly.
 */
export async function sendEmployeeCredentials(args: CredentialEmailArgs): Promise<SendResult> {
  // The EMPLOYEE door. /login is the admin one and would refuse these
  // credentials outright — with the same message a wrong password gets, which
  // for a new starter reads as "they sent me a broken password".
  const loginUrl = `${appUrl()}${EMPLOYEE_LOGIN_PATH}`
  const brand = args.brandColor || '#C41E33'

  const html = layout(
    `
    <h1 style="margin:0 0 14px;font-size:21px;font-weight:700;letter-spacing:-0.3px;">Your ${esc(
      args.orgName
    )} account is ready</h1>
    <p style="margin:0 0 18px;">Hi ${esc(args.fullName || 'there')}, an account has been created for you on ${esc(
      args.orgName
    )}'s employee portal. Sign in at <a href="${loginUrl}" style="color:${brand};font-weight:600;">${esc(
      loginUrl
    )}</a> with the details below.</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F7F9;border:1px solid #E7E9EE;border-radius:12px;margin:0 0 8px;">
      <tr><td style="padding:16px 18px;">
        <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.6px;color:#6B7280;margin-bottom:4px;">Email</div>
        <div style="font-size:15px;font-weight:600;margin-bottom:14px;">${esc(args.to)}</div>
        <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.6px;color:#6B7280;margin-bottom:4px;">Temporary password</div>
        <div style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:17px;font-weight:700;letter-spacing:0.5px;">${esc(
          args.tempPassword
        )}</div>
      </td></tr>
    </table>

    ${button(loginUrl, 'Sign in', brand)}

    <p style="margin:0;font-size:13px;color:#6B7280;">
      You will be asked to choose your own password the first time you sign in — this
      temporary one stops working at that point. If you did not expect this email,
      please contact your manager.
    </p>
  `,
    { brandName: args.orgName, brandColor: brand, preheader: 'Your employee portal sign-in details' }
  )

  return sendEmail({ to: args.to, subject: `Your ${args.orgName} portal account`, html })
}

export interface VisaReminderArgs {
  to: string | string[]
  employeeName: string
  visaType: string
  expiryDate: string
  daysRemaining: number
  orgName: string
  brandColor?: string
}

export async function sendVisaReminder(args: VisaReminderArgs): Promise<SendResult> {
  const urgent = args.daysRemaining <= 7
  const headline =
    args.daysRemaining === 0
      ? `${args.employeeName}'s ${args.visaType} expires today`
      : `${args.employeeName}'s ${args.visaType} expires in ${args.daysRemaining} day${
          args.daysRemaining === 1 ? '' : 's'
        }`

  const html = layout(
    `
    <div style="display:inline-block;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:600;background:${
      urgent ? '#FCEBEE' : '#FEF3C7'
    };color:${urgent ? '#A5182A' : '#92400E'};margin-bottom:14px;">
      ${urgent ? 'Action needed' : 'Upcoming expiry'}
    </div>
    <h1 style="margin:0 0 14px;font-size:21px;font-weight:700;letter-spacing:-0.3px;">${esc(headline)}</h1>
    <p style="margin:0 0 18px;">A work authorization on your ${esc(args.orgName)} workspace is approaching its expiry date.</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F7F9;border:1px solid #E7E9EE;border-radius:12px;">
      <tr><td style="padding:16px 18px;font-size:14px;">
        <strong>Employee</strong><br>${esc(args.employeeName)}<br><br>
        <strong>Visa type</strong><br>${esc(args.visaType)}<br><br>
        <strong>Expiry date</strong><br>${esc(args.expiryDate)}
      </td></tr>
    </table>

    ${button(`${appUrl()}/org/visa`, 'Review work authorizations', args.brandColor || '#C41E33')}
  `,
    {
      brandName: args.orgName,
      brandColor: args.brandColor,
      preheader: headline,
    }
  )

  return sendEmail({ to: args.to, subject: headline, html })
}

export interface LeaveDecisionArgs {
  to: string
  employeeName: string
  status: 'approved' | 'rejected'
  startDate: string
  endDate: string
  note?: string | null
  orgName: string
  brandColor?: string
}

export async function sendLeaveDecision(args: LeaveDecisionArgs): Promise<SendResult> {
  const approved = args.status === 'approved'
  const subject = `Your leave request was ${args.status}`

  const html = layout(
    `
    <div style="display:inline-block;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:600;background:${
      approved ? '#DCFCE7' : '#FCEBEE'
    };color:${approved ? '#15803D' : '#A5182A'};margin-bottom:14px;">
      ${approved ? 'Approved' : 'Rejected'}
    </div>
    <h1 style="margin:0 0 14px;font-size:21px;font-weight:700;letter-spacing:-0.3px;">${esc(subject)}</h1>
    <p style="margin:0 0 8px;">Hi ${esc(args.employeeName || 'there')},</p>
    <p style="margin:0 0 18px;">Your leave from <strong>${esc(args.startDate)}</strong> to <strong>${esc(
      args.endDate
    )}</strong> has been ${esc(args.status)}.</p>
    ${
      args.note
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F7F9;border:1px solid #E7E9EE;border-radius:12px;"><tr><td style="padding:14px 16px;font-size:14px;"><strong>Note from your manager</strong><br>${esc(
            args.note
          )}</td></tr></table>`
        : ''
    }
    ${button(`${appUrl()}/employee/leaves`, 'View my leave', args.brandColor || '#C41E33')}
  `,
    { brandName: args.orgName, brandColor: args.brandColor, preheader: subject }
  )

  return sendEmail({ to: args.to, subject, html })
}

export interface AnnouncementArgs {
  to: string | string[]
  title: string
  description?: string | null
  orgName: string
  brandColor?: string
}

export async function sendAnnouncement(args: AnnouncementArgs): Promise<SendResult> {
  const html = layout(
    `
    <h1 style="margin:0 0 14px;font-size:21px;font-weight:700;letter-spacing:-0.3px;">${esc(args.title)}</h1>
    ${args.description ? `<p style="margin:0 0 18px;white-space:pre-line;">${esc(args.description)}</p>` : ''}
    ${button(`${appUrl()}/employee/notifications`, 'Open the portal', args.brandColor || '#C41E33')}
  `,
    { brandName: args.orgName, brandColor: args.brandColor, preheader: args.title }
  )

  return sendEmail({ to: args.to, subject: `${args.orgName}: ${args.title}`, html })
}
