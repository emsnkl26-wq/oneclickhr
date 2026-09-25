import { Suspense } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { SignInForm } from '../_components/sign-in-form'
import { CardSkeleton } from '@/components/ui/patterns'

export const metadata: Metadata = { title: 'Employee sign in' }

/**
 * The EMPLOYEE door. There is no sign-up on it and there never will be —
 * an account inside someone's workspace only ever comes from that workspace.
 */
export default function EmployeeLoginPage() {
  return (
    <Suspense fallback={<CardSkeleton lines={5} />}>
      <SignInForm
        portal="employee"
        title="Employee sign in"
        subtitle="Use the email and password your organization sent you."
        footer={
          <p className="mt-6 border-t border-line pt-4 text-center text-xs leading-relaxed text-ink-muted">
            Employees do not sign up here — your organization creates your account and sends your
            sign-in details. If you run the organization,{' '}
            <Link href="/login" className="font-medium text-brand-ink hover:underline">
              sign in as an administrator
            </Link>
            .
          </p>
        }
      />
    </Suspense>
  )
}
