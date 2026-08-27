'use client'

import * as React from 'react'
import { Download, FileText } from 'lucide-react'
import { DataTable, EmptyState, StatusChip, type Column } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import { SearchField } from '@/components/ui/search-field'
import { Pagination } from '@/components/ui/pagination'
import { FilterSelect } from '@/components/ui/filter-select'
import { formatLocal } from '@/lib/time'
import { humanize, truncate } from '@/lib/utils'
import type { DocumentKind } from '@/types/db'

/*
 * The kinds the type filter offers — also the allowlist the page validates
 * against. Imported, not declared here: `document-kinds.ts` explains why data a
 * Server Component reads must not live inside a `'use client'` module. The local
 * `import` is what the filter below binds to; a bare `export { … } from` would
 * re-export it without ever defining it in this scope.
 */
import { DOCUMENT_KINDS } from './document-kinds'
export { DOCUMENT_KINDS }

export interface DocumentRow {
  id: string
  employee_id: string | null
  employeeName: string | null
  kind: DocumentKind
  file_url: string
  file_name: string | null
  mime_type: string | null
  size_bytes: number | null
  excerpt: string | null
  created_at: string
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * `documents` is ONE page of results that the database has already filtered —
 * see the page component for why the search cannot live in here any more. The
 * controls write to the URL; the server answers.
 */
export function DocumentLibrary({
  documents, total, page, perPage, searching, timezone,
}: {
  documents: DocumentRow[]
  total: number
  page: number
  perPage: number
  /** True when a term or type filter is active — changes what "empty" means. */
  searching: boolean
  timezone: string
}) {
  const columns: Column<DocumentRow>[] = [
    {
      key: 'file',
      header: 'File',
      cell: (row) => (
        <div className="flex items-start gap-2.5">
          <FileText className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden />
          <div className="min-w-0">
            <p className="truncate font-medium">{row.file_name || 'Untitled'}</p>
            {row.excerpt ? (
              <p className="mt-0.5 line-clamp-1 text-xs text-ink-muted">
                {truncate(row.excerpt.replace(/\s+/g, ' '), 90)}
              </p>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      key: 'kind',
      header: 'Type',
      cell: (row) => <StatusChip status="neutral" tone="neutral" label={humanize(row.kind)} />,
    },
    {
      key: 'employee',
      header: 'Employee',
      cell: (row) => <span className="text-ink-muted">{row.employeeName || '—'}</span>,
    },
    {
      key: 'size',
      header: 'Size',
      cell: (row) => <span className="tabular text-ink-muted">{formatBytes(row.size_bytes)}</span>,
    },
    {
      key: 'uploaded',
      header: 'Uploaded',
      cell: (row) => (
        <span className="whitespace-nowrap text-ink-muted">
          {formatLocal(row.created_at, timezone, 'd MMM yyyy')}
        </span>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'w-14',
      cell: (row) => (
        <Button asChild size="icon" variant="ghost" aria-label={`Download ${row.file_name}`}>
          <a
            href={`/api/files/view?key=${encodeURIComponent(row.file_url)}&download=${encodeURIComponent(
              row.file_name || 'document'
            )}`}
          >
            <Download />
          </a>
        </Button>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchField
          param="q"
          placeholder="Search filenames or text inside PDFs"
          label="Search documents"
        />
        <FilterSelect
          param="kind"
          label="Filter by type"
          className="sm:w-52"
          options={[
            { value: '', label: 'All types' },
            { value: 'employee_doc', label: 'Employee documents' },
            { value: 'work_auth', label: 'Work authorization' },
            { value: 'general', label: 'General' },
          ]}
        />
      </div>

      <DataTable
        columns={columns}
        rows={documents}
        rowKey={(row) => row.id}
        empty={
          <EmptyState
            icon={FileText}
            title={searching ? 'No matches' : 'No documents yet'}
            description={
              searching
                ? 'Try a different search term or clear the filter.'
                : 'Files uploaded while adding employees or recording work authorizations appear here.'
            }
          />
        }
      />

      <Pagination page={page} perPage={perPage} total={total} />
    </div>
  )
}
