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
