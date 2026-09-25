import type { Metadata } from 'next'
import Link from 'next/link'
import { Download } from 'lucide-react'
import { requireSuperAdmin } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { PageHeader } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import { LinkTabs } from '@/components/ui/link-tabs'
import {
  TALENT_PER_PAGE, VISA_STATES, loadCandidateDirectory, loadTalentDirectory, parseTalentFilters,
} from '@/lib/talent'
import { TalentTable, CandidateTable } from './talent-tables'

export const metadata: Metadata = { title: 'Talent' }
export const dynamic = 'force-dynamic'

/**
 * Every employee on the platform with their work authorization — and every job
 * seeker — in one searchable place, for when the platform team is hiring (053).
 *
 * Cross-tenant by design, so it reads with the ADMIN client behind
 * requireSuperAdmin(), like every other page in /super. The employee list comes
 * from `super_talent_directory`, a view only the service role can read.
 */
export default async function TalentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  await requireSuperAdmin()
  const params = await searchParams
  const filters = parseTalentFilters(params)
  const admin = createAdminClient()

  const [{ data: tenants }, result] = await Promise.all([
    admin.from('tenants').select('id, name').order('name').limit(1000),
    filters.tab === 'candidates' ? loadCandidateDirectory(admin, filters) : loadTalentDirectory(admin, filters),
  ])

  const exportQuery = new URLSearchParams(
    Object.entries(params).filter(([key, value]) => key !== 'page' && value) as Array<[string, string]>
  ).toString()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Talent"
        description="Employees across every organization with their work authorization, and job seekers from the portal — searchable for when you are hiring."
        actions={
          <Button asChild variant="secondary">
            <a href={`/api/super/talent/export${exportQuery ? `?${exportQuery}` : ''}`}>
              <Download />
              Export CSV
            </a>
          </Button>
        }
      />

      <LinkTabs
        param="tab"
        active={filters.tab === 'candidates' ? 'candidates' : ''}
        tabs={[
          { value: '', label: 'Employees' },
          { value: 'candidates', label: 'Job seekers' },
        ]}
        resets={['page', 'visa', 'org']}
      />

      {filters.tab === 'candidates' ? (
        <CandidateTable
          rows={result.rows as never}
          total={result.total}
          page={filters.page}
          perPage={TALENT_PER_PAGE}
        />
      ) : (
        <TalentTable
          rows={result.rows as never}
          total={result.total}
          page={filters.page}
          perPage={TALENT_PER_PAGE}
          tenants={(tenants ?? []) as Array<{ id: string; name: string }>}
          visaStates={VISA_STATES}
        />
      )}

      <p className="px-1 text-xs leading-relaxed text-ink-muted">
        Visa numbers and documents are never shown here. Open a person for their full work history;
        files stay behind their organization&apos;s own access controls.{' '}
        <Link href="/super/users" className="font-medium text-brand-600 hover:underline">
          Manage accounts
        </Link>
      </p>
    </div>
  )
}
