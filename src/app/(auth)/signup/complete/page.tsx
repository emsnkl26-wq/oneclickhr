import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { resolveContext, homeFor } from '@/lib/auth/context'
import { CompleteSignupForm } from './complete-signup-form'

export const metadata: Metadata = { title: 'Name your workspace' }
export const dynamic = 'force-dynamic'

/**
 * The second half of a Google sign-up (056).
 *
 * Google proves who the person is; it cannot say what their company is called.
 * Until this form is sent the account is an organization with no workspace,
 * and every org page sends it back here.
 */
export default async function CompleteSignupPage() {
  const result = await resolveContext()
  if (result.status === 'anonymous') redirect('/signup')
  if (result.status === 'orphaned') redirect('/session-invalid')
  const { ctx } = result
  if (ctx.role !== 'org' || ctx.tenantId) redirect(homeFor(ctx.role))

  return <CompleteSignupForm email={ctx.email} defaultName={ctx.fullName ?? ''} />
}
