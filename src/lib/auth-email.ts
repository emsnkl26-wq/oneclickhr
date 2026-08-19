import 'server-only'

/**
 * Auth emails (confirm signup, reset password), sent through Resend instead of
 * Supabase's built-in SMTP sender. Triggered by Supabase's "Send Email" Auth
 * Hook — see src/app/api/auth/send-email-hook/route.ts — which hands us a
 * ready-made `token_hash` and we build the same device-independent
 * `/auth/confirm` link the app has always used (see that route's header
 * comment for why it isn't the default `?code=` link).
 */
import { sendEmail, layout, button, esc, type SendResult } from '@/lib/email'

export interface SignupConfirmationArgs {
  to: string
  confirmUrl: string
  orgName?: string
}

export async function sendSignupConfirmationEmail(args: SignupConfirmationArgs): Promise<SendResult> {
  const org = args.orgName?.trim()

  const html = layout(
    `
    <h1 style="margin:0 0 14px;font-size:21px;font-weight:700;letter-spacing:-0.3px;">Confirm your ${
      org ? esc(org) + ' ' : ''
    }workspace</h1>
    <p style="margin:0 0 18px;">
      Thanks for signing up. Click below to confirm your email address and activate
      your organization's workspace.
    </p>

    ${button(args.confirmUrl, 'Confirm my email')}

    <p style="margin:18px 0 0;font-size:13px;color:#6B7280;">
      This link works on any device — open it on your phone if that's where you're
      reading this. It expires in 24 hours. If you did not create this account, you
      can safely ignore this email.
    </p>

    <p style="margin:18px 0 0;font-size:12px;color:#9CA3AF;word-break:break-all;">
      Button not working? Paste this into your browser:<br>${esc(args.confirmUrl)}
    </p>
  `,
    { brandName: org || 'Oneclickhr', preheader: 'Confirm your email to activate your workspace' }
  )

  return sendEmail({ to: args.to, subject: 'Confirm your email address', html })
}

export interface PasswordResetArgs {
  to: string
  resetUrl: string
}

export async function sendPasswordResetEmail(args: PasswordResetArgs): Promise<SendResult> {
  const html = layout(
    `
    <h1 style="margin:0 0 14px;font-size:21px;font-weight:700;letter-spacing:-0.3px;">Reset your password</h1>
    <p style="margin:0 0 18px;">
      We received a request to reset the password on your account. Click below to
      choose a new one.
    </p>

    ${button(args.resetUrl, 'Choose a new password')}

    <p style="margin:18px 0 0;font-size:13px;color:#6B7280;">
      This link works on any device and expires in 1 hour. If you did not request
      this, you can ignore this email — your password will not change.
    </p>

    <p style="margin:18px 0 0;font-size:12px;color:#9CA3AF;word-break:break-all;">
      Button not working? Paste this into your browser:<br>${esc(args.resetUrl)}
    </p>
  `,
    { brandName: 'Oneclickhr', preheader: 'Reset your Oneclickhr password' }
  )

  return sendEmail({ to: args.to, subject: 'Reset your password', html })
}
