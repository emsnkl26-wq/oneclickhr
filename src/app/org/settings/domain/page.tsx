import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, Clock } from 'lucide-react'
import { requireOrg } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { daysUntilDeadline, deadlineLabel } from '@/lib/domain'
import { PageHeader } from '@/components/ui/patterns'
import { DomainVerification } from './domain-verification'

export const metadata: Metadata = { title: 'Verify domain' }
export const dynamic = 'force-dynamic'

/**
 * The one screen where the verification token is revealed.
 *
 * Read with the ADMIN client because `domain_token` is deliberately absent from
 * `current_profile()` — a secret the org publishes on request has no business
 * riding along in the context every page render already carries. The read is
 * scoped by `ctx.tenantId`, which comes from the verified session.
 */
export default async function DomainPage() {
  const ctx = await requireOrg()
  const admin = createAdminClient()

  const { data: tenant } = await admin
    .from('tenants')
    .select('domain, domain_token, domain_verified_at, domain_verification_method, domain_verify_due_at')
    .eq('id', ctx.tenantId)
    .single()

  // The banner hides itself on this page, so the deadline has to be restated
  // here or it disappears at exactly the moment someone came to act on it.
  const daysLeft = tenant?.domain_verified_at
    ? null
    : daysUntilDeadline(tenant?.domain_verify_due_at)

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/org/settings"
          className="focus-ring mb-3 inline-flex items-center gap-1.5 rounded text-[13px] font-medium text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Settings
        </Link>
        <PageHeader
          title="Company website"
          description="Confirming your website is what reserves this workspace for your company — so a colleague signing up later joins you instead of starting a second one."
          actions={
            daysLeft !== null ? (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold ${
                  daysLeft < 0
                    ? 'bg-danger/10 text-danger'
                    : 'bg-amber-50 text-amber-700'
                }`}
              >
                <Clock className="size-3.5" aria-hidden />
                {deadlineLabel(daysLeft)}
              </span>
            ) : null
          }
        />
      </div>

      <DomainVerification
        domain={tenant?.domain ?? null}
        token={tenant?.domain_token ?? ''}
        verifiedAt={tenant?.domain_verified_at ?? null}
        method={(tenant?.domain_verification_method as 'meta' | 'dns' | null) ?? null}
        timezone={ctx.tenant.timezone}
      />
    </div>
  )
}
