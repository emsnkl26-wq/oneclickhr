import type { Metadata } from 'next'
import Link from 'next/link'
import { CandidateSignupForm } from './candidate-signup-form'

export const metadata: Metadata = {
  title: 'Create your account',
  robots: { index: false, follow: false },
}

/** A job seeker's account (052): name, email, password — nothing about a company. */
export default function CandidateSignupPage() {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-12 sm:py-16">
      <CandidateSignupForm />
      <p className="mt-6 text-center text-xs leading-relaxed text-ink-muted">
        Hiring for your company?{' '}
        <Link href="/signup" className="font-medium text-brand-600 hover:underline">
          Create an organization workspace
        </Link>{' '}
        instead.
      </p>
    </div>
  )
}
