import { Suspense } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { SignInForm } from '../_components/sign-in-form'
import { CardSkeleton } from '@/components/ui/patterns'

export const metadata: Metadata = { title: 'Sign in' }

/**
 * The ORGANIZATION door — owners and platform admins.
 *
 * Employees have their own at /employee-login and are refused here, with the
 * same message a wrong password gets. Two doors is a UX decision (an employee
 * should never be shown "Create a workspace"); the enforcement is the role check
 * in /api/auth/login, which both pages post to.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={<CardSkeleton lines={5} />}>
      <SignInForm
        portal="org"
        title="Welcome back"
        subtitle="Sign in to your organization's workspace."
        footer={
          <>
            <p className="mt-6 text-center text-sm text-ink-muted">
              New organization?{' '}
              <Link href="/signup" className="font-medium text-brand-ink hover:underline">
                Create a workspace
              </Link>
            </p>

            <p className="mt-4 border-t border-line pt-4 text-center text-xs leading-relaxed text-ink-muted">
              This is the administrator sign-in. If your organization created your
              account for you,{' '}
              <Link href="/employee-login" className="font-medium text-brand-ink hover:underline">
                use the employee portal
              </Link>
              .
            </p>
          </>
        }
      />
    </Suspense>
  )
}
