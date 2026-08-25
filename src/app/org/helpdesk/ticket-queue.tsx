'use client'

import * as React from 'react'
import Link from 'next/link'
import { LifeBuoy } from 'lucide-react'
import { DataTable, EmptyState, StatusChip, type Column } from '@/components/ui/patterns'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/primitives'
import { LinkTabs } from '@/components/ui/link-tabs'
import { SearchField } from '@/components/ui/search-field'
import { FilterSelect } from '@/components/ui/filter-select'
import { Pagination } from '@/components/ui/pagination'
import { formatLocal } from '@/lib/time'
import { initials, humanize } from '@/lib/utils'
import type { TicketPriority, TicketStatus } from '@/types/db'

export interface QueueTicket {
  id: string
  code: string
  subject: string
  priority: TicketPriority
  status: TicketStatus
  employeeId: string
  employeeName: string
  employeePhoto: string | null
  createdAt: string
  lastActivityAt: string
}

export function TicketQueue({
  tickets, total, page, perPage, filter, openCount, searching, timezone,
}: {
  tickets: QueueTicket[]
  total: number
  page: number
  perPage: number
  filter: string
  priority: string
  openCount: number
  searching: boolean
  timezone: string
}) {
  const columns: Column<QueueTicket>[] = [
    {
      key: 'code',
      header: 'Ticket ID',
      className: 'w-28',
      cell: (row) => (
        <Link
          href={`/org/helpdesk/${row.id}`}
          className="tabular font-medium text-brand-600 hover:underline"
        >
          {row.code}
        </Link>
      ),
    },
    {
      key: 'subject',
      header: 'Subject',
      cell: (row) => (
        <Link href={`/org/helpdesk/${row.id}`} className="block truncate font-medium hover:underline">
          {row.subject}
        </Link>
      ),
    },
    {
      key: 'employee',
      header: 'Raised by',
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
          <span className="min-w-0 truncate">{row.employeeName}</span>
        </div>
      ),
    },
    {
      key: 'priority',
      header: 'Priority',
      cell: (row) => <StatusChip status={row.priority} label={humanize(row.priority)} />,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => <StatusChip status={row.status} />,
    },
    {
      key: 'created',
      header: 'Created',
      cell: (row) => (
        <span className="whitespace-nowrap text-ink-muted">
          {formatLocal(row.createdAt, timezone, 'd MMM yyyy')}
        </span>
      ),
    },
    {
      key: 'updated',
      header: 'Last updated',
      cell: (row) => (
        <span className="whitespace-nowrap text-ink-muted">
          {formatLocal(row.lastActivityAt, timezone, 'd MMM, HH:mm')}
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <LinkTabs
          param="status"
          active={filter}
          tabs={[
            { value: 'open_all', label: openCount ? `Open (${openCount})` : 'Open' },
            { value: 'resolved', label: 'Resolved' },
            { value: 'closed', label: 'Closed' },
            { value: 'all', label: 'All' },
          ]}
        />

        <div className="flex flex-wrap items-center gap-3">
          <FilterSelect
            param="priority"
            label="Filter by priority"
            className="sm:w-44"
            options={[
              { value: '', label: 'All priorities' },
              { value: 'high', label: 'High' },
              { value: 'medium', label: 'Medium' },
              { value: 'low', label: 'Low' },
            ]}
          />
          <SearchField
            param="q"
            placeholder="Search by employee"
            label="Search tickets"
            className="sm:w-56 sm:flex-none"
          />
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={tickets}
        rowKey={(row) => row.id}
        empty={
          <EmptyState
            icon={LifeBuoy}
            title={searching ? 'Nothing matches those filters' : 'No tickets here'}
            description={
              searching
                ? 'Try a different employee or priority.'
                : 'Requests your team raises will land here.'
            }
          />
        }
      />

      <Pagination page={page} perPage={perPage} total={total} />
    </div>
  )
}
