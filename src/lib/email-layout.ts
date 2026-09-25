/**
 * Branded email chrome, shared by every message this product sends.
 *
 * Deliberately NOT `server-only`: the same layout has to render outside a
 * request too. scripts/render-supabase-templates.ts uses it to produce the
 * Supabase Auth email templates, so an auth email sent by Supabase's own SMTP
 * sender looks identical to one sent by the app. A `server-only` import would
 * throw the moment a plain Node script touched it.
 *
 * Pure string building — no secrets, no I/O, no environment.
 */

import { BRAND, BRAND_ASSETS, DEFAULT_PRIMARY_COLOR, brandColorOrDefault } from './brand'

export function esc(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function stripHtml(html: string): string {
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
  /**
   * Absolute origin the brand images are served from, e.g. `https://app.example`
   * (or Supabase's `{{ .SiteURL }}` in a dashboard template). An email cannot use
   * a relative URL, and this file must not read the environment, so the caller
   * says. Without it the header falls back to the name in text, which is also
   * what a mail client that blocks images shows.
   */
  origin?: string
}

/**
 * Table-based layout with inline styles — the only thing that renders reliably
 * across Outlook, Gmail and Apple Mail. `brandColor` lets an org's email carry
 * its own colour, defaulting to OneclickHR orange.
 *
 * TWO HEADERS. A message sent ON BEHALF OF a workspace shows that workspace's
 * name and colour. A message from the platform itself (sign-up confirmation,
 * password reset) shows the OneclickHR logo.
 */
export function layout(bodyHtml: string, opts: LayoutOptions = {}): string {
  const brandName = esc(opts.brandName || BRAND.name)
  const brand = brandColorOrDefault(opts.brandColor)
  const preheader = opts.preheader ? esc(opts.preheader) : ''
  const fromPlatform =
    !opts.brandName || opts.brandName === BRAND.name || opts.brandName === BRAND.jobsName

  const header =
    fromPlatform && opts.origin
      ? `<img src="${esc(opts.origin.replace(/\/+$/, ''))}${BRAND_ASSETS.email.src}" width="${Math.round(
          (32 * BRAND_ASSETS.email.width) / BRAND_ASSETS.email.height
        )}" height="32" alt="${brandName}" style="display:inline-block;height:32px;width:auto;border:0;vertical-align:middle;">${
          opts.brandName === BRAND.jobsName
            ? `<span style="color:#94A3B8;font-size:15px;font-weight:600;margin-left:8px;vertical-align:middle;">Jobs</span>`
            : ''
        }`
      : `<span style="color:#FFFFFF;font-size:17px;font-weight:700;letter-spacing:-0.2px;">
            ${brandName}
          </span>
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${brand};margin-left:8px;vertical-align:middle;"></span>`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${brandName}</title>
</head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,Helvetica,Arial,sans-serif;color:#0F172A;">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:32px 12px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:14px;overflow:hidden;">
      <tr>
        <td style="background:${BRAND.colors.charcoal};border-top:3px solid ${brand};padding:20px 28px;">
          ${header}
        </td>
      </tr>
      <tr><td style="padding:32px 28px;font-size:15px;line-height:1.65;color:#0F172A;">
        ${bodyHtml}
      </td></tr>
      <tr>
        <td style="padding:18px 28px;background:#F8FAFC;border-top:1px solid #E2E8F0;font-size:12px;line-height:1.6;color:#64748B;">
          This is an automated message from ${brandName}. If it looks unexpected, you can ignore it.
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`
}

export function button(href: string, label: string, brand: string = DEFAULT_PRIMARY_COLOR): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
  <tr><td style="border-radius:10px;background:${brandColorOrDefault(brand)};">
    <a href="${esc(href)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:10px;">${esc(label)}</a>
  </td></tr>
</table>`
}
