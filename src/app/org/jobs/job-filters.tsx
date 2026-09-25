'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { Select } from '@/components/ui/input'
import { useProgressRouter } from '@/lib/use-progress-router'
import { JOB_TYPE_LABELS, JOB_WORKPLACE_LABELS } from '@/lib/job-form'


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
