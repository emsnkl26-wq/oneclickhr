'use client'

import * as React from 'react'
import { ShieldCheck } from 'lucide-react'
import { DataTable, EmptyState, type Column } from '@/components/ui/patterns'
import { SearchField } from '@/components/ui/search-field'
import { FilterSelect } from '@/components/ui/filter-select'
import { Pagination } from '@/components/ui/pagination'
import { formatLocal } from '@/lib/time'

/**
 * The action namespaces this product writes — the prefix before the dot in
 * "employee.deactivated".
 *
 * Declared rather than derived. The groups used to be collected from whatever
 * happened to be in the loaded page, which meant the filter's options changed
 * as you paged and a namespace with no recent activity vanished from it. This
 * list is the actual vocabulary: every `audit()` call in the codebase uses one
 * of these prefixes, so a new one belongs here alongside the call that emits it.
 */
export const ACTION_GROUPS = [
  'attendance',
  'auth',
  'board_column',
  'calendar',
  'department',
  'employee',
  'file',
  'invoice',
  'leave',
  'meeting',
  'notification',
  'onboarding',
  'payslip',
  'profile',
  'task',
  'tenant',
  'work_auth',
] as const

interface AuditRow {
  id: string
  tenant_id: string | null
  tenantName: string
  actor_email: string | null
  action: string
  entity: string | null
  entity_id: string | null
  ip: string | null
  meta: Record<string, unknown>
  created_at: string
}

/** `logs` is one page; the URL carries the filter and the server applies it. */
export function AuditViewer({
  logs, total, page, perPage, filtered,
}: {
  logs: AuditRow[]
  total: number
  page: number
  perPage: number
  filtered: boolean
}) {

  const columns: Column<AuditRow>[] = [
    {
      key: 'time',
      header: 'When',
      cell: (row) => (
        <span className="tabular whitespace-nowrap text-ink-muted">
          {formatLocal(row.created_at, 'UTC', 'd MMM yyyy, HH:mm:ss')}
        </span>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      cell: (row) => (
        <code className="rounded bg-page px-1.5 py-0.5 font-mono text-[11px]">{row.action}</code>
      ),
    },
    {
      key: 'actor',
      header: 'Actor',
      cell: (row) => (
        <span className="truncate text-ink-muted">{row.actor_email || 'system'}</span>
      ),
    },
    {
      key: 'tenant',
      header: 'Organization',
      cell: (row) => <span className="truncate">{row.tenantName}</span>,
    },
    {
      key: 'entity',
      header: 'Entity',
      cell: (row) => <span className="text-ink-muted">{row.entity || '—'}</span>,
    },
    {
      key: 'meta',
      header: 'Detail',
      cell: (row) => {
        const keys = Object.keys(row.meta ?? {})
        if (!keys.length) return <span className="text-ink-muted">—</span>
        return (
          <span
            className="line-clamp-1 max-w-[260px] font-mono text-[11px] text-ink-muted"
            title={JSON.stringify(row.meta, null, 2)}
          >
            {keys.map((key) => `${key}=${String(row.meta[key])}`).join(' ')}
          </span>
        )
      },
    },
    {
      key: 'ip',
      header: 'IP',
      cell: (row) => <span className="tabular text-xs text-ink-muted">{row.ip || '—'}</span>,
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchField
          param="q"
          placeholder="Search by action, actor or entity"
          label="Search audit log"
        />
        <FilterSelect
          param="action"
          label="Filter by action group"
          className="sm:w-48"
          options={[
            { value: '', label: 'All actions' },
            ...ACTION_GROUPS.map((group) => ({ value: group, label: group })),
          ]}
        />
      </div>

      <DataTable
        columns={columns}
        rows={logs}
        rowKey={(row) => row.id}
        empty={
          <EmptyState
            icon={ShieldCheck}
            title={filtered ? 'No matches' : 'Nothing recorded yet'}
            description={
              filtered
                ? 'Try a different search term or clear the filter.'
                : 'Actions across the platform are recorded here as they happen.'
            }
          />
        }
      />

      <Pagination page={page} perPage={perPage} total={total} />
    </div>
  )
}
