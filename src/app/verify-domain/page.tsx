import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { PauseOctagon, ShieldAlert } from 'lucide-react'
import { resolveContext, homeFor } from '@/lib/auth/context'
import { createAdminClient } from '@/lib/supabase/admin'
import { isDomainLockEnforced } from '@/lib/auth/guards'
import { domainLockState } from '@/lib/domain-lock'
import { deadlineLabel } from '@/lib/domain'
import { Button } from '@/components/ui/button'
import { DomainVerification } from '@/app/org/settings/domain/domain-verification'

export const metadata: Metadata = { title: 'Verify your website' }
export const dynamic = 'force-dynamic'

interface TenantDomainRow {
  domain: string | null
  domain_token: string | null
  domain_verified_at: string | null
  domain_verification_method: string | null
}

/**
 * Where a PAUSED workspace lands (061): unverified, and out of its three days.
 *
 * The same shape as /change-password — one unmet condition, one screen, and
 * `requireUser()` funnels every other route here until it is met. Like that
 * page it must NOT call `requireUser()` itself, which redirects here and would
 * loop; it resolves the context directly and re-checks the one condition.
 *
 * ADMINISTRATORS GET THE FIX, NOT A NOTICE. This is deliberately not a dead
 * end like /workspace-suspended: the person who can clear the pause is usually
 * the person staring at it, so the real verification screen is rendered right
 * here rather than linked to from behind a guard they can no longer pass.
 * Employees get the notice, because there is nothing for them to do.
 */
export default async function VerifyDomainPage() {
  const result = await resolveContext()
  if (result.status === 'anonymous') redirect('/login')
  if (result.status === 'orphaned') redirect('/session-invalid')
  const ctx = result.ctx
  if (!ctx.isActive) redirect('/account-inactive')

  // Verified in the meantime, or never locked: nobody is held on this screen a
  // moment longer than the rule holds them. The enforcement flag is read for
  // the same reason — with the lockout switched off nothing is paused, so
  // holding somebody here would be a pause screen for a pause that is not
  // happening. See `isDomainLockEnforced`.
  const lock = domainLockState(ctx.tenant)
  if (
    !isDomainLockEnforced() ||
    !lock.locked ||
    ctx.role === 'super_admin' ||
    ctx.role === 'candidate'
  ) {
    redirect(homeFor(ctx.role))
  }

  const overdue = lock.daysLeft === null ? '' : deadlineLabel(lock.daysLeft)

  if (ctx.role !== 'org') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-page px-4">
        <div className="card-surface w-full max-w-md p-8 text-center">
          <span className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-amber-50 text-amber-600">
            <PauseOctagon className="size-6" aria-hidden />
          </span>
          <h1 className="text-[22px] font-bold tracking-[-0.02em]">
            {ctx.tenant?.name ?? 'This workspace'} is paused
          </h1>
          <p className="mt-2.5 text-sm leading-relaxed text-ink-muted">
            Your organization has not yet confirmed its company website, so the workspace is paused
            for everyone in it. Your administrator can clear this in a couple of minutes — nothing
            has been lost, and everything comes straight back once they do.
          </p>
          <form action="/api/auth/signout" method="post" className="mt-6">
            <Button type="submit" variant="secondary" className="w-full">
              Sign out
            </Button>
          </form>
        </div>
      </div>
    )
  }

  /*
   * The token is read with the ADMIN client for the same reason /org/settings/
   * domain reads it that way: it is deliberately absent from `current_profile()`
   * so it never rides along in the context every page render carries. The read
   * is scoped by the tenant id from the verified session.
   *
   * WRAPPED, BECAUSE THIS IS THE LAST SCREEN A PAUSED WORKSPACE CAN REACH.
   * `createAdminClient()` throws outright when SUPABASE_SERVICE_ROLE_KEY is
   * absent, and a throw in a server component renders the root error boundary —
   * so a misconfigured environment turned the one page that FIXES a lockout
   * into "Something went wrong", with no way forward for anybody. A missing
   * token degrades to the form below asking for the domain again, which is
   * recoverable; an error page is not.
   */
  let tenant: TenantDomainRow | null = null
  try {
    const { data } = await createAdminClient()
      .from('tenants')
      .select('domain, domain_token, domain_verified_at, domain_verification_method')
      .eq('id', ctx.tenantId)
      .single()
    tenant = (data as TenantDomainRow | null) ?? null
  } catch (error) {
    console.error('[verify-domain] could not read the tenant domain row', error)
  }

  return (
    <div className="min-h-screen bg-page px-4 py-10">
      <div className="mx-auto w-full max-w-2xl space-y-5">
        <div className="rounded-xl border border-danger/30 bg-danger/5 p-6">
          <div className="flex gap-3.5">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-danger/10 text-danger">
              <ShieldAlert className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <h1 className="text-[20px] font-bold tracking-[-0.02em]">
                {ctx.tenant?.name ?? 'This workspace'} is paused
              </h1>
              <p className="mt-1.5 text-sm leading-relaxed text-ink">
                Every workspace has three days to confirm the company website it signed up with.
                This one is {overdue || 'past that deadline'}, so it is paused for you and for
                everyone on your team until the website is verified.
              </p>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                Verify it below and everything comes back immediately — no data has been touched. If
                you cannot publish the tag yourself, contact support and we will sort it out with
                you.
              </p>
            </div>
          </div>
        </div>

        <DomainVerification
          domain={tenant?.domain ?? null}
          token={tenant?.domain_token ?? ''}
          verifiedAt={tenant?.domain_verified_at ?? null}
          method={(tenant?.domain_verification_method as 'meta' | 'dns' | null) ?? null}
          timezone={ctx.tenant?.timezone ?? 'UTC'}
        />

        <div className="flex flex-wrap items-center justify-between gap-3 px-1">
          <a
            href="mailto:support@oneclickhr.app"
            className="focus-ring rounded text-[13px] font-medium text-brand-ink hover:underline"
          >
            Contact support
          </a>
          <form action="/api/auth/signout" method="post">
            <Button type="submit" variant="ghost" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
