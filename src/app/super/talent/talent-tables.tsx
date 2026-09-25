'use client'

import * as React from 'react'
import Link from 'next/link'
import { FileText, Trash2, Users } from 'lucide-react'
import { DataTable, EmptyState, StatusChip, type Column } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import { SearchField } from '@/components/ui/search-field'
import { FilterSelect } from '@/components/ui/filter-select'
import { Pagination } from '@/components/ui/pagination'
import { countryName } from '@/lib/geo'
import { formatDateLabel, formatInstantLabel } from '@/lib/time'
import { cn } from '@/lib/utils'
import { DeleteUserDialog, type DeletableUser } from '../delete-user-dialog'

type VisaState = 'valid' | 'expiring' | 'expired' | 'not_tracked' | 'unknown'

interface TalentRow {
  id: string
  tenant_name: string
  full_name: string | null
  email: string | null
  phone: string | null
  designation: string | null
  is_active: boolean
  city: string | null
  country: string | null
  onboarding_work_auth_status: string | null
  onboarding_visa_type: string | null
  visa_type: string | null
  visa_expiry_date: string | null
  visa_days_left: number | null
  visa_state: VisaState
  latest_role_title: string | null
}

const VISA_TONE: Record<VisaState, string> = {
  valid: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
  expiring: 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300',
  expired: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300',
  not_tracked: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300',
  unknown: 'bg-page text-ink-muted ring-1 ring-inset ring-line',
}

/** The chip text — the filter uses the longer descriptions from the server. */
const VISA_SHORT: Record<VisaState, string> = {
  valid: 'Valid',
  expiring: 'Expiring soon',
  expired: 'Expired',
  not_tracked: 'Not tracked',
  unknown: 'Unknown',
}

export function TalentTable({
  rows, total, page, perPage, tenants, visaStates,
}: {
  rows: TalentRow[]
  total: number
  page: number
  perPage: number
  tenants: Array<{ id: string; name: string }>
  visaStates: Record<VisaState, string>
}) {
  const columns: Column<TalentRow>[] = [
    {
      key: 'person',
      header: 'Employee',
      cell: (row) => (
        <Link href={`/super/talent/${row.id}`} className="block min-w-0 hover:underline">
          <span className="block truncate font-medium text-ink">{row.full_name || row.email}</span>
          <span className="block truncate text-xs text-ink-muted">{row.email}</span>
        </Link>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate text-sm">{row.designation || row.latest_role_title || '—'}</p>
          <p className="truncate text-xs text-ink-muted">{row.tenant_name}</p>
        </div>
      ),
    },
    {
      key: 'location',
      header: 'Location',
      cell: (row) => (
        <span className="text-sm text-ink-muted">
          {[row.city, row.country ? countryName(row.country) : null].filter(Boolean).join(', ') || '—'}
        </span>
      ),
    },
    {
      key: 'auth',
      header: 'Work authorization',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {row.visa_type || row.onboarding_visa_type || row.onboarding_work_auth_status || '—'}
          </p>
          {row.onboarding_work_auth_status && (row.visa_type || row.onboarding_visa_type) ? (
            <p className="truncate text-xs text-ink-muted">{row.onboarding_work_auth_status}</p>
          ) : null}
        </div>
      ),
    },
    {
      key: 'expiry',
      header: 'Visa status',
      cell: (row) => (
        <div className="space-y-0.5">
          <span
            className={cn(
              'inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold',
              VISA_TONE[row.visa_state]
            )}
          >
            {VISA_SHORT[row.visa_state]}
          </span>
          {row.visa_expiry_date ? (
            <p className="tabular text-xs text-ink-muted">
              {formatDateLabel(row.visa_expiry_date)}
              {row.visa_days_left != null && row.visa_days_left >= 0
                ? ` · ${row.visa_days_left}d left`
                : ''}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Account',
      cell: (row) => <StatusChip status={row.is_active ? 'active' : 'inactive'} />,
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <SearchField param="q" placeholder="Search name, email, role or visa" label="Search talent" />
        <div className="grid grid-cols-2 gap-3 sm:flex">
          <FilterSelect
            param="visa"
            label="Visa status"
            className="min-w-0 sm:w-52"
            options={[
              { value: '', label: 'Any visa status' },
              ...(Object.entries(visaStates) as Array<[VisaState, string]>).map(([value, label]) => ({
                value,
                label,
              })),
            ]}
          />
          <FilterSelect
            param="org"
            label="Organization"
            className="min-w-0 sm:w-48"
            options={[
              { value: '', label: 'All organizations' },
              ...tenants.map((t) => ({ value: t.id, label: t.name })),
            ]}
          />
          <FilterSelect
            param="status"
            label="Account"
            className="min-w-0 sm:w-36"
            options={[
              { value: '', label: 'Any account' },
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Deactivated' },
            ]}
          />
        </div>
      </div>

      <p className="text-sm text-ink-muted">
        {total} {total === 1 ? 'employee' : 'employees'}
      </p>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        empty={<EmptyState icon={Users} title="Nobody matches" description="Try a broader search or clear the filters." />}
      />
      <Pagination page={page} perPage={perPage} total={total} />
    </div>
  )
}

interface CandidateRow {
  id: string
  full_name: string | null
  email: string | null
  is_active: boolean
  created_at: string
  candidate: {
    headline: string | null
    phone: string | null
    location: string | null
    country: string | null
    work_authorization: string | null
    years_experience: number | string | null
    current_company: string | null
    resume_key: string | null
  } | null
  applications: number
}

export function CandidateTable({
  rows, total, page, perPage,
}: {
  rows: CandidateRow[]
  total: number
  page: number
  perPage: number
}) {
  const [deleting, setDeleting] = React.useState<DeletableUser | null>(null)

  const columns: Column<CandidateRow>[] = [
    {
      key: 'person',
      header: 'Job seeker',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.full_name || row.email}</p>
          <p className="truncate text-xs text-ink-muted">{row.candidate?.headline || row.email}</p>
        </div>
      ),
    },
    {
      key: 'contact',
      header: 'Contact',
      cell: (row) => (
        <div className="min-w-0 text-xs text-ink-muted">
          <p className="truncate">{row.email}</p>
          {row.candidate?.phone ? <p className="truncate">{row.candidate.phone}</p> : null}
        </div>
      ),
    },
    {
      key: 'where',
      header: 'Location',
      cell: (row) => (
        <span className="text-sm text-ink-muted">
          {[row.candidate?.location, row.candidate?.country ? countryName(row.candidate.country) : null]
            .filter(Boolean)
            .join(', ') || '—'}
        </span>
      ),
    },
    {
      key: 'auth',
      header: 'Work authorization',
      cell: (row) => <span className="text-sm">{row.candidate?.work_authorization || '—'}</span>,
    },
    {
      key: 'exp',
      header: 'Experience',
      cell: (row) => (
        <span className="text-sm text-ink-muted">
          {row.candidate?.years_experience != null ? `${Number(row.candidate.years_experience)} yrs` : '—'}
          {row.candidate?.current_company ? ` · ${row.candidate.current_company}` : ''}
        </span>
      ),
    },
    {
      key: 'apps',
      header: 'Applied',
      cell: (row) => (
        <span className="inline-flex items-center gap-1.5 text-sm">
          {row.applications}
          {row.candidate?.resume_key ? (
            <FileText className="size-3.5 text-ink-muted" aria-label="Has a CV on file" />
          ) : null}
        </span>
      ),
    },
    {
      key: 'joined',
      header: 'Joined',
      cell: (row) => (
        <span className="whitespace-nowrap text-xs text-ink-muted">{formatInstantLabel(row.created_at)}</span>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      cell: (row) =>
        row.email ? (
          <Button
            size="icon"
            variant="ghost"
            className="text-red-600 hover:text-red-700"
            aria-label={`Delete ${row.full_name || row.email} permanently`}
            onClick={() =>
              setDeleting({ id: row.id, name: row.full_name, email: row.email!, role: 'candidate' })
            }
          >
            <Trash2 />
          </Button>
        ) : null,
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchField param="q" placeholder="Search name or email" label="Search job seekers" />
        <FilterSelect
          param="status"
          label="Account"
          className="sm:w-40"
          options={[
            { value: '', label: 'Any account' },
            { value: 'active', label: 'Active' },
            { value: 'inactive', label: 'Deactivated' },
          ]}
        />
      </div>
      <p className="text-sm text-ink-muted">
        {total} job {total === 1 ? 'seeker' : 'seekers'}
      </p>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        empty={<EmptyState icon={Users} title="No job seekers yet" description="People who create an account on the job portal appear here." />}
      />
      <Pagination page={page} perPage={perPage} total={total} />
      <DeleteUserDialog user={deleting} onClose={() => setDeleting(null)} />
    </div>
  )
}
