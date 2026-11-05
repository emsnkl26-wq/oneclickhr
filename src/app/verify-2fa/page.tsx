import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { ShieldCheck } from 'lucide-react'
import { resolveContext, homeFor } from '@/lib/auth/context'
import { hasValidProof } from '@/lib/auth/two-factor'
import { Verify2faForm } from './verify-2fa-form'

export const metadata: Metadata = { title: 'Two-step verification' }
export const dynamic = 'force-dynamic'

/** Only ever send somebody back to an in-app path, never an absolute URL. */
function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/org'
  return next
}

/**
 * Where an org admin with 2FA enabled enters a current code once their window
 * has lapsed (064). Top-level, like /change-password, so the org layout guard
 * never loops on it.
 *
 * Resolves the context directly rather than through `requireOrg()` — that guard
 * is the one that redirects here, and calling it would loop.
 */
export default async function Verify2faPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const result = await resolveContext()
  if (result.status === 'anonymous') redirect('/login')
  if (result.status === 'orphaned') redirect('/session-invalid')
  const ctx = result.ctx
  if (!ctx.isActive) redirect('/account-inactive')
  // 2FA is an org-admin control; nobody else belongs on this screen.
  if (ctx.role !== 'org') redirect(homeFor(ctx.role))

  const next = safeNext((await searchParams)?.next)

  // Not enrolled, or already verified within the window — nothing to do here.
  if (!ctx.twoFactorEnabled || (await hasValidProof(ctx.userId))) redirect(next)

  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="card-surface p-7">
          <span className="mb-5 grid size-12 place-items-center rounded-2xl bg-brand-50 text-brand-600">
            <ShieldCheck className="size-5" aria-hidden />
          </span>

          <h1 className="text-[22px] font-bold tracking-[-0.02em]">Two-step verification</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
            Enter the 6-digit code from your authenticator app to continue.
          </p>

          <Verify2faForm next={next} />
        </div>

        <form action="/api/auth/signout" method="post" className="mt-4 text-center">
          <button type="submit" className="text-sm font-medium text-ink-muted hover:underline">
            Sign out instead
          </button>
        </form>
      </div>
    </div>
  )
}
