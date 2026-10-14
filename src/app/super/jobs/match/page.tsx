import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { requireSuperAdmin } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { PageHeader } from '@/components/ui/patterns'
import { toSkills } from '@/lib/jobs'
import { MatchConsole } from './match-console'

export const metadata: Metadata = { title: 'Find candidates' }
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The hiring screen: a requirement in, a call list out.
 *
 * `?job=<id>` prefills from one of our own postings, which is how this is
 * reached from the job detail page — the description is already written and
 * retyping it to find candidates for it would be absurd. The prefill is a COPY:
 * everything on this page is editable and nothing saves back to the posting.
 *
 * Only OUR postings prefill. A customer's description is theirs, and the pool
 * this screen searches does not include their applicants either — the handler
 * at /api/super/candidate-match has the full note on that boundary.
 */
export default async function FindCandidatesPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string }>
}) {
  await requireSuperAdmin()
  const { job: jobId } = await searchParams

  let prefill: {
    title: string
    description: string
    minYears: string
    job: { id: string; title: string }
  } | null = null

  if (jobId && UUID.test(jobId)) {
    const { data } = await createAdminClient()
      .from('jobs')
      .select('id, title, tenant_id, description, responsibilities, requirements, skills, experience_min')
      .eq('id', jobId)
      .is('tenant_id', null)
      .maybeSingle()

    if (data) {
      const job = data as {
        id: string
        title: string
        description: string | null
        responsibilities: string | null
        requirements: string | null
        skills: unknown
        experience_min: number | null
      }
      prefill = {
        title: job.title,
        // Everything the posting says about the work, in the order a reader
        // meets it. The skill list is appended because it is the densest part
        // of any posting and the part the scorer gets most out of.
        description: [
          job.description,
          job.responsibilities,
          job.requirements,
          toSkills(job.skills).join(', '),
        ]
          .filter((part) => !!part && String(part).trim())
          .join('\n\n'),
        minYears: job.experience_min === null ? '' : String(job.experience_min),
        job: { id: job.id, title: job.title },
      }
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/super/jobs"
          className="focus-ring mb-3 inline-flex items-center gap-1.5 rounded text-[13px] font-medium text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Jobs
        </Link>
        <PageHeader
          title="Find candidates"
          description="Describe the role and we will rank everyone in our talent pool against it — job seekers from the portal and people who applied to our own postings, best first."
        />
      </div>

      <MatchConsole
        initialTitle={prefill?.title ?? ''}
        initialDescription={prefill?.description ?? ''}
        initialMinYears={prefill?.minYears ?? ''}
        fromJob={prefill?.job ?? null}
      />
    </div>
  )
}
