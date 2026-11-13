'use client'

import * as React from 'react'
import { Mail, Building2, Users, Archive, Check, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { EmptyState, StatusChip } from '@/components/ui/patterns'
import { Select } from '@/components/ui/input'
import { apiPatch, ApiClientError } from '@/lib/fetcher'

export interface EnquiryRow {
  id: string
  name: string
  email: string
  company: string
  teamSize: string | null
  enquiry: string | null
  message: string
  status: 'new' | 'read' | 'archived'
  createdAt: string
}

const STATUS_TONE: Record<EnquiryRow['status'], 'info' | 'neutral'> = {
  new: 'info',
  read: 'neutral',
  archived: 'neutral',
}
const STATUS_LABEL: Record<EnquiryRow['status'], string> = {
  new: 'New',
  read: 'Read',
  archived: 'Archived',
}

export function EnquiriesList({ initialRows }: { initialRows: EnquiryRow[] }) {
  const [rows, setRows] = React.useState<EnquiryRow[]>(initialRows)
  const [filter, setFilter] = React.useState<'all' | EnquiryRow['status']>('all')
  const [busyId, setBusyId] = React.useState<string | null>(null)

  const visible = rows.filter((r) => filter === 'all' || r.status === filter)
  const newCount = rows.filter((r) => r.status === 'new').length

  async function setStatus(row: EnquiryRow, status: EnquiryRow['status']) {
    setBusyId(row.id)
    const previous = row.status
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status } : r)))
    try {
      await apiPatch(`/api/super/enquiries/${row.id}`, { status })
    } catch (err) {
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: previous } : r)))
      toast.error(err instanceof ApiClientError ? err.message : 'Could not update the enquiry.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          {rows.length} enquir{rows.length === 1 ? 'y' : 'ies'}
          {newCount > 0 ? ` · ${newCount} new` : ''}
        </p>
        <Select
          aria-label="Filter enquiries"
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
          className="w-40"
        >
          <option value="all">All</option>
          <option value="new">New</option>
          <option value="read">Read</option>
          <option value="archived">Archived</option>
        </Select>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={Mail}
          title="No enquiries"
          description="Messages from the marketing site's contact form appear here."
        />
      ) : (
        <ul className="space-y-3">
          {visible.map((row) => (
            <li
              key={row.id}
              className="rounded-xl border border-line bg-card p-4 sm:p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-ink">{row.name}</span>
                    <StatusChip
                      status={row.status}
                      label={STATUS_LABEL[row.status]}
                      tone={STATUS_TONE[row.status]}
                    />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
                    <span className="inline-flex items-center gap-1">
                      <Mail className="size-3.5" />
                      <a href={`mailto:${row.email}`} className="hover:underline">
                        {row.email}
                      </a>
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Building2 className="size-3.5" />
                      {row.company}
                    </span>
                    {row.teamSize ? (
                      <span className="inline-flex items-center gap-1">
                        <Users className="size-3.5" />
                        {row.teamSize}
                      </span>
                    ) : null}
                  </div>
                </div>
                <span className="shrink-0 text-xs text-ink-muted">
                  {new Date(row.createdAt).toLocaleString()}
                </span>
              </div>

              {row.enquiry ? (
                <p className="mt-3 text-xs font-medium uppercase tracking-wide text-ink-muted">
                  {row.enquiry}
                </p>
              ) : null}
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink">
                {row.message}
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                {row.status !== 'read' ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={busyId === row.id}
                    onClick={() => setStatus(row, 'read')}
                  >
                    <Check />
                    Mark read
                  </Button>
                ) : null}
                {row.status !== 'archived' ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={busyId === row.id}
                    onClick={() => setStatus(row, 'archived')}
                  >
                    <Archive />
                    Archive
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={busyId === row.id}
                    onClick={() => setStatus(row, 'new')}
                  >
                    <RotateCcw />
                    Reopen
                  </Button>
                )}
                <Button size="sm" variant="secondary" asChild>
                  <a href={`mailto:${row.email}?subject=Re: your OneclickHR enquiry`}>
                    <Mail />
                    Reply
                  </a>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
