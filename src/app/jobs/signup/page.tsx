import { Suspense } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { CandidateSignupForm } from './candidate-signup-form'
import { CardSkeleton } from '@/components/ui/patterns'

export const metadata: Metadata = {
  title: 'Create your account',
  robots: { index: false, follow: false },
}

/** A job seeker's account (052): name, email, password — nothing about a company. */
export default function CandidateSignupPage() {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-12 sm:py-16">
      {/* The form reads `?error=` from /auth/callback, and `useSearchParams`
          opts the subtree into client rendering — so it needs a boundary, the
          same way /jobs/login does. */}
      <Suspense fallback={<CardSkeleton lines={5} />}>
        <CandidateSignupForm />
      </Suspense>
      <p className="mt-6 text-center text-xs leading-relaxed text-ink-muted">
        Hiring for your company?{' '}
        <Link href="/signup" className="font-medium text-brand-ink hover:underline">
          Create an organization workspace
        </Link>{' '}
        instead.
      </p>
    </div>
  )
}
