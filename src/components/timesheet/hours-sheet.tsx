'use client'

import * as React from 'react'
import Link from 'next/link'
import { Table2, Download, Info } from 'lucide-react'
import { DataTable, EmptyState, StatusChip, StatCard, type Column } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import { DateRangeFilter } from '@/components/ui/date-range-filter'
import { toCsv, downloadCsv } from '@/lib/csv'
import { formatPeriod, WEEK_DAY_LABELS } from '@/lib/time'
import { formatHours } from '@/lib/utils'
import type { TimesheetStatus } from '@/types/db'

export interface SheetRow {
  id: string
  timesheetId: string
  timesheetCode: string
  weekStart: string
  weekEnd: string
  status: TimesheetStatus
  projectLabel: string
  clientName: string | null
  taskName: string | null
  billable: boolean
  /** Sunday-first, seven entries — the same order the grid uses. */
  hours: number[]
  /** Only set on the org's view, where the rows span the whole team. */
  employeeName?: string | null
}

const rowTotal = (row: SheetRow) => row.hours.reduce((sum, value) => sum + value, 0)

/**
 * Every logged line, flattened into one spreadsheet.
 *
 * This is the view someone opens when a client asks "how many hours in March?" —
 * so it is deliberately a FLAT table rather than the weekly grid: one row per
 * project per week, seven day columns, a total and a status. That shape is also
 * what exports cleanly to CSV, which is most of what it is for.
 *
 * ONE COMPONENT FOR BOTH PORTALS. The employee sees their own lines and the org
 * sees the whole team's, with an extra column naming who each one belongs to.
 * The numbers, the ordering and the export are then identical on both sides,
 * which matters when the two are reconciling the same invoice.
 *
 * The export writes exactly what is on screen — same rows, same order, same
 * columns. An export that quietly differs from the table above it is the thing
 * that makes people stop trusting both.
 */
export function HoursSheet({
  rows, from, to, capped, showEmployee, timesheetBasePath,
}: {
  rows: SheetRow[]
  from: string
  to: string
  /** True when the row cap was hit, so the totals below are a floor. */
  capped: boolean
  showEmployee?: boolean
  /** Where a timesheet code links to — the portals have different routes. */
  timesheetBasePath: string
}) {
  const totals = React.useMemo(() => {
    const all = rows.reduce((sum, row) => sum + rowTotal(row), 0)
    const approved = rows
      .filter((row) => row.status === 'approved')
      .reduce((sum, row) => sum + rowTotal(row), 0)
    const billable = rows
      .filter((row) => row.billable)
      .reduce((sum, row) => sum + rowTotal(row), 0)
    return { all, approved, billable }
  }, [rows])

  function exportCsv() {
    const csv = toCsv(
      [
        'Timesheet ID',
        ...(showEmployee ? ['Employee'] : []),
        'Period start', 'Period end', 'Project / task', 'Client',
        ...WEEK_DAY_LABELS, 'Total hours', 'Billable', 'Status',
      ],
      rows.map((row) => [
        row.timesheetCode,
        ...(showEmployee ? [row.employeeName ?? ''] : []),
        row.weekStart,
        row.weekEnd,
        row.projectLabel,
        row.clientName ?? '',
        ...row.hours,
        rowTotal(row),
        row.billable ? 'Yes' : 'No',
        row.status,
      ])
    )
    downloadCsv(`hours-${from}_${to}.csv`, csv)
  }

  const columns: Column<SheetRow>[] = [
    {
      key: 'period',
      header: 'Period',
      cell: (row) => (
        <div className="min-w-0">
          <span className="tabular block whitespace-nowrap font-medium">
            {formatPeriod(row.weekStart, row.weekEnd)}
          </span>
          <Link
            href={`${timesheetBasePath}/${row.timesheetId}`}
            className="tabular text-xs text-brand-600 hover:underline"
          >
            {row.timesheetCode}
          </Link>
        </div>
      ),
    },
    ...(showEmployee
      ? [
          {
            key: 'employee',
            header: 'Employee',
            cell: (row: SheetRow) => (
              <span className="block truncate">{row.employeeName || 'Employee'}</span>
            ),
          },
        ]
      : []),
    {
      key: 'project',
      header: 'Project / client',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.projectLabel}</p>
          <p className="truncate text-xs text-ink-muted">
            {row.clientName || 'No client'}
            {row.taskName && row.projectLabel !== row.taskName ? ` · ${row.taskName}` : ''}
            {row.billable ? '' : ' · Non-billable'}
          </p>
        </div>
      ),
    },
    ...WEEK_DAY_LABELS.map((label, index) => ({
      key: label,
      header: label,
      className: 'text-center',
      headerClassName: 'text-center',
      cell: (row: SheetRow) => (
        <span className={row.hours[index] ? 'tabular font-medium' : 'tabular text-ink-muted'}>
          {row.hours[index] || 0}
        </span>
      ),
    })),
    {
      key: 'total',
      header: 'Total',
      className: 'text-right',
      headerClassName: 'text-right',
      cell: (row) => <span className="tabular font-semibold">{rowTotal(row)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => <StatusChip status={row.status} />,
    },
  ]

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Hours in this range"
          value={totals.all ? formatHours(totals.all) : '—'}
          accent
        />
        <StatCard label="Approved" value={totals.approved ? formatHours(totals.approved) : '—'} />
        <StatCard label="Billable" value={totals.billable ? formatHours(totals.billable) : '—'} />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <DateRangeFilter />
        <Button variant="secondary" onClick={exportCsv} disabled={!rows.length}>
          <Download />
          Export CSV
        </Button>
      </div>

      {capped ? (
        <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-700">
          <Info className="mt-px size-4 shrink-0" aria-hidden />
          This range has more lines than can be shown at once. Narrow the dates to see — and
          export — the rest.
        </p>
      ) : null}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        empty={
          <EmptyState
            icon={Table2}
            title="Nothing logged in this range"
            description="Widen the dates, or fill in a timesheet and it will show up here."
          />
        }
      />
    </div>
  )
}
