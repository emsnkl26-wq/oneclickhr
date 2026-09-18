'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { Select } from '@/components/ui/input'
import { useProgressRouter } from '@/lib/use-progress-router'
import type { JobType, JobWorkplace } from '@/types/db'

// A client copy — `@/lib/jobs` is server-only (same reason job-dialog keeps one).
const JOB_TYPE_LABELS: Record<JobType, string> = {
  full_time: 'Full time',
  part_time: 'Part time',
  contract: 'Contract',
  internship: 'Internship',
  temporary: 'Temporary',
}

const JOB_WORKPLACE_LABELS: Record<JobWorkplace, string> = {
  onsite: 'On site',
  remote: 'Remote',
  hybrid: 'Hybrid',
}

/**
 * Employment-type and workplace filters beside the search box.
 *
 * URL-driven like the tabs and the search, so the server does the narrowing and
 * a filtered view survives a refresh or a shared link.
 */
export function JobFilters() {
  const router = useProgressRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function setParam(name: string, value: string) {
    const next = new URLSearchParams(searchParams.toString())
    if (value) next.set(name, value)
    else next.delete(name)
    next.delete('page')
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname)
  }

  return (
    <>
      <Select
        aria-label="Employment type"
        className="sm:w-40"
        value={searchParams.get('type') ?? ''}
        onChange={(e) => setParam('type', e.target.value)}
        options={[
          { value: '', label: 'Any type' },
          ...Object.entries(JOB_TYPE_LABELS).map(([value, label]) => ({ value, label })),
        ]}
      />
      <Select
        aria-label="Workplace"
        className="sm:w-36"
        value={searchParams.get('workplace') ?? ''}
        onChange={(e) => setParam('workplace', e.target.value)}
        options={[
          { value: '', label: 'Anywhere' },
          ...Object.entries(JOB_WORKPLACE_LABELS).map(([value, label]) => ({ value, label })),
        ]}
      />
    </>
  )
}
