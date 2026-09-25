import { Suspense } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { SignInForm } from '@/app/(auth)/_components/sign-in-form'
import { CardSkeleton } from '@/components/ui/patterns'

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: false },
}

/**
 * The JOB SEEKER door (052). Same form and same /api/auth/login as the other
 * two doors; `portal="candidate"` makes the server refuse any account that is
 * not a job seeker, with the same message a wrong password gets.
 *
 * `?next=` (set by "Apply now") brings them back to the posting afterwards —
 * the form only honours a same-origin relative path.
 */
export default function CandidateLoginPage() {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-12 sm:py-16">
      <Suspense fallback={<CardSkeleton lines={5} />}>
        <SignInForm
          portal="candidate"
          title="Sign in to apply"
          subtitle="Your job seeker account — apply in a click and follow every application."
          footer={
            <p className="mt-6 text-center text-sm text-ink-muted">
              New here?{' '}
              <Link href="/jobs/signup" className="font-medium text-brand-600 hover:underline">
                Create a free account
              </Link>
            </p>
          }
        />
      </Suspense>
      <p className="mt-6 text-center text-xs leading-relaxed text-ink-muted">
        Hiring or managing a team?{' '}
        <Link href="/login" className="font-medium text-brand-600 hover:underline">
          Organization sign-in
        </Link>{' '}
        ·{' '}
        <Link href="/employee-login" className="font-medium text-brand-600 hover:underline">
          Employee portal
        </Link>
      </p>
    </div>
  )
}
