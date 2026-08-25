'use client'

import * as React from 'react'
import Link from 'next/link'
import { Timer, Download, Paperclip } from 'lucide-react'
import { DataTable, EmptyState, StatusChip, type Column } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/primitives'
import { LinkTabs } from '@/components/ui/link-tabs'
import { SearchField } from '@/components/ui/search-field'
import { DateRangeFilter } from '@/components/ui/date-range-filter'
import { Pagination } from '@/components/ui/pagination'
import { toCsv, downloadCsv } from '@/lib/csv'
import { formatPeriod } from '@/lib/time'
import { initials, truncate } from '@/lib/utils'
import type { TimesheetStatus } from '@/types/db'

export interface QueueRow {
  id: string
  code: string
  employeeId: string
  employeeName: string
  employeePhoto: string | null
  weekStart: string
  weekEnd: string
  status: TimesheetStatus
  totalHours: number
  billableHours: number
  comments: string | null
  reviewNote: string | null
  hasAttachment: boolean
}

export function TimesheetQueue({
  timesheets, total, page, perPage, filter, pendingCount, searching, from, to,
}: {
  timesheets: QueueRow[]
  total: number
  page: number
  perPage: number
  filter: string
  pendingCount: number
  searching: boolean
  from: string
  to: string
  timezone: string
}) {
  /**
   * The export covers the CURRENT PAGE, and the button says so.
   *
   * Exporting everything would mean a second, unpaged query of the whole
   * workspace behind a button that looks instant. Narrowing with the date range
   * and then exporting is the honest version of the same job, and the range is
   * already in the URL.
   */
  function exportCsv() {
    const csv = toCsv(
      ['Timesheet ID', 'Employee', 'Period start', 'Period end', 'Total hours', 'Billable hours', 'Status', 'Comments'],
      timesheets.map((row) => [
        row.code,
        row.employeeName,
        row.weekStart,
        row.weekEnd,
        row.totalHours,
        row.billableHours,
        row.status,
        row.comments ?? '',
      ])
    )
    const suffix = from || to ? `-${from || 'start'}_${to || 'today'}` : ''
    downloadCsv(`timesheets${suffix}.csv`, csv)
  }

  const columns: Column<QueueRow>[] = [
    {
      key: 'code',
      header: 'Timesheet ID',
      className: 'w-32',
      cell: (row) => (
        <Link
          href={`/org/timesheets/${row.id}`}
          className="tabular font-medium text-brand-600 hover:underline"
        >
          {row.code}
        </Link>
      ),
    },
    {
      key: 'employee',
      header: 'Employee',
      cell: (row) => (
        <div className="flex items-center gap-2.5">
          <Avatar className="size-8">
            {row.employeePhoto ? (
              <AvatarImage
                src={`/api/files/view?key=${encodeURIComponent(row.employeePhoto)}`}
                alt=""
              />
            ) : null}
            <AvatarFallback className="text-[10px]">
              {initials(row.employeeName, null)}
            </AvatarFallback>
          </Avatar>
          <span className="min-w-0 truncate font-medium">{row.employeeName}</span>
        </div>
      ),
    },
    {
      key: 'period',
      header: 'Period',
      cell: (row) => (
        <span className="tabular whitespace-nowrap">{formatPeriod(row.weekStart, row.weekEnd)}</span>
      ),
    },
    {
      key: 'hours',
      header: 'Total hours',
      className: 'text-right',
      headerClassName: 'text-right',
      cell: (row) => <span className="tabular font-medium">{row.totalHours}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => (
        <div className="flex items-center gap-1.5">
          <StatusChip status={row.status} />
          {row.hasAttachment ? (
            <Paperclip className="size-3.5 text-ink-muted" aria-label="Has an attachment" />
          ) : null}
        </div>
      ),
    },
    {
      key: 'comments',
      header: 'Comments',
      cell: (row) => {
        const text = row.status === 'rejected' && row.reviewNote ? row.reviewNote : row.comments
        if (!text) return <span className="text-ink-muted">—</span>
        return (
          <span className="text-ink-muted" title={text}>
            {truncate(text, 60)}
          </span>
        )
      },
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <LinkTabs
          param="status"
          active={filter}
          tabs={[
            {
              value: 'submitted',
              label: pendingCount ? `Awaiting review (${pendingCount})` : 'Awaiting review',
            },
            { value: 'approved', label: 'Approved' },
            { value: 'rejected', label: 'Rejected' },
            { value: 'all', label: 'All' },
          ]}
        />

        <div className="flex flex-wrap items-center gap-3">
          <DateRangeFilter />
          <SearchField
            param="q"
            placeholder="Search by employee"
            label="Search timesheets"
            className="sm:w-56 sm:flex-none"
          />
          <Button variant="secondary" onClick={exportCsv} disabled={!timesheets.length}>
            <Download />
            Export page
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={timesheets}
        rowKey={(row) => row.id}
        empty={
          <EmptyState
            icon={Timer}
            title={searching ? 'Nothing matches those filters' : 'Nothing to review'}
            description={
              searching
                ? 'Try a different name or widen the date range.'
                : 'Timesheets your team submits will appear here for approval.'
            }
          />
        }
      />

      <Pagination page={page} perPage={perPage} total={total} />
    </div>
  )
}
