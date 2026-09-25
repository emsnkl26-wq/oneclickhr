import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { KeyRound } from 'lucide-react'
import { resolveContext } from '@/lib/auth/context'
import { ChangePasswordForm } from './change-password-form'

export const metadata: Metadata = { title: 'Change password' }
export const dynamic = 'force-dynamic'

/**
 * Reached two ways:
 *   • a teammate's FIRST sign-in, where `must_change_password` is set and every
 *     page guard funnels them here until the system-issued password is gone;
 *   • anyone choosing to change their password from the account menu.
 *
 * Note it does NOT call `requireUser()` — that guard redirects here when the
 * flag is set, which would loop. It resolves the context directly instead.
 */
export default async function ChangePasswordPage() {
  const result = await resolveContext()
  if (result.status === 'anonymous') redirect('/login')
  if (result.status === 'orphaned') redirect('/session-invalid')
  const ctx = result.ctx
  if (!ctx.isActive) redirect('/account-inactive')

  const forced = ctx.mustChangePassword

  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="card-surface p-7">
          <span className="mb-5 grid size-12 place-items-center rounded-2xl bg-brand-50 text-brand-600">
            <KeyRound className="size-5" aria-hidden />
          </span>

          <h1 className="text-[22px] font-bold tracking-[-0.02em]">
            {forced ? 'Set your own password' : 'Change your password'}
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
            {forced
              ? 'You are signed in with a temporary password. Choose your own to continue — the temporary one stops working straight away.'
              : 'Enter your current password, then choose a new one.'}
          </p>

          <ChangePasswordForm forced={forced} />
        </div>

        {!forced ? (
          <p className="mt-4 text-center text-sm">
            <a href="/" className="font-medium text-brand-ink hover:underline">
              Back to the app
            </a>
          </p>
        ) : null}
      </div>
    </div>
  )
}
