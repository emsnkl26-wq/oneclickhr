/**
 * The 404, for `notFound()` and for any URL that matches no route.
 *
 * Deliberately vague about WHY. Every id in this app is a tenant's private data,
 * and "that timesheet does not exist" versus "you may not see that timesheet"
 * are two different sentences that together let anyone with a session probe for
 * which ids are real. RLS already answers both cases identically; this page has
 * to as well.
 *
 * The exit is `/`, not a portal path: the root route resolves the signed-in
 * role and forwards, so the same page works for an employee, an org admin, a
 * super admin, and someone who is not signed in at all.
 */

import Link from 'next/link'
import type { Metadata } from 'next'
import { FileQuestion, Home } from 'lucide-react'
import { Button } from '@/components/ui/button'

export const metadata: Metadata = { title: 'Not found' }

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6 py-16">
      <div className="w-full max-w-md text-center">
        <div className="bg-brand-50 mx-auto flex size-12 items-center justify-center rounded-full">
          <FileQuestion className="text-brand-600 size-6" aria-hidden />
        </div>

        <h1 className="mt-5 text-xl font-semibold text-ink">We could not find that page</h1>

        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          The link may be out of date, or the record may have been removed by someone in your
          organization.
        </p>

        <div className="mt-6 flex justify-center">
          <Button asChild>
            <Link href="/">
              <Home />
              Go to my dashboard
            </Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
