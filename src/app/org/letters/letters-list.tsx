'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FileSignature, Download, Eye, Trash2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { DataTable, EmptyState, StatusChip, type Column } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/primitives'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter,
} from '@/components/ui/primitives'
import { LinkTabs } from '@/components/ui/link-tabs'
import { SearchField } from '@/components/ui/search-field'
import { Pagination } from '@/components/ui/pagination'
import { apiDelete, ApiClientError } from '@/lib/fetcher'
import { DOCUMENT_TYPE_LABELS } from '@/lib/document-templates'
import { formatLocal } from '@/lib/time'
import { initials } from '@/lib/utils'
import type { GeneratedDocumentType } from '@/types/db'

export interface LetterRow {
  id: string
  docType: GeneratedDocumentType
  title: string
  fileKey: string
  fileName: string | null
  /** Null for the common case: an offer written before the person had an account. */
  employeeId: string | null
  employeeName: string
  employeePhoto: string | null
  authorName: string | null
  createdAt: string
}

export function LettersList({
  letters, total, page, perPage, docType, searching, timezone,
}: {
  letters: LetterRow[]
  total: number
  page: number
  perPage: number
  docType: string
  searching: boolean
  timezone: string
}) {
  const router = useRouter()
  const [removing, setRemoving] = React.useState<LetterRow | null>(null)
  const [busy, setBusy] = React.useState(false)

  async function remove() {
    if (!removing) return
    setBusy(true)
    try {
      await apiDelete(`/api/org/letters/${removing.id}`)
      toast.success('Document deleted')
      setRemoving(null)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const columns: Column<LetterRow>[] = [
    {
      key: 'title',
      header: 'Document',
      cell: (row) => (
        <div className="flex items-start gap-2.5">
          <FileSignature className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden />
          <div className="min-w-0">
            <p className="truncate font-medium">{row.title}</p>
            <p className="truncate text-xs text-ink-muted">{row.fileName || 'document.pdf'}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Template',
      cell: (row) => (
        <StatusChip status="neutral" tone="neutral" label={DOCUMENT_TYPE_LABELS[row.docType]} />
      ),
    },
    {
      key: 'employee',
      header: 'Recipient',
      // Only a recipient WITH a profile gets a link. The rest are people who
      // have been sent an offer and have not accepted it yet — there is nowhere
      // for their name to lead, and a dead link would suggest otherwise.
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
          {row.employeeId ? (
            <Link
              href={`/org/employees/${row.employeeId}`}
              className="min-w-0 truncate hover:underline"
            >
              {row.employeeName}
            </Link>
          ) : (
            <span className="min-w-0 truncate">{row.employeeName}</span>
          )}
        </div>
      ),
    },
    {
      key: 'created',
      header: 'Generated',
      cell: (row) => (
        <div>
          <p className="whitespace-nowrap text-ink-muted">
            {formatLocal(row.createdAt, timezone, 'd MMM yyyy')}
          </p>
          {row.authorName ? (
            <p className="truncate text-xs text-ink-muted">by {row.authorName}</p>
          ) : null}
        </div>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'w-40',
      cell: (row) => (
        <div className="flex items-center justify-end gap-0.5">
          <Button asChild size="icon" variant="ghost" aria-label={`Preview ${row.title}`}>
            <a
              href={`/api/files/view?key=${encodeURIComponent(row.fileKey)}`}
              target="_blank"
              rel="noreferrer"
            >
              <Eye />
            </a>
          </Button>
          <Button asChild size="icon" variant="ghost" aria-label={`Download ${row.title}`}>
            <a
              href={`/api/files/view?key=${encodeURIComponent(row.fileKey)}&download=${encodeURIComponent(
                row.fileName || 'document.pdf'
              )}`}
            >
              <Download />
            </a>
          </Button>
          <Button asChild size="icon" variant="ghost" aria-label={`Generate another for ${row.employeeName}`}>
            <Link href={`/org/letters/new?employee=${row.employeeId}&type=${row.docType}`}>
              <RefreshCw />
            </Link>
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Delete ${row.title}`}
            onClick={() => setRemoving(row)}
          >
            <Trash2 />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <LinkTabs
          param="type"
          active={docType}
          tabs={[
            { value: '', label: 'All' },
            { value: 'offer_letter', label: 'Offer letters' },
            { value: 'employment_agreement', label: 'Agreements' },
            { value: 'internship_offer', label: 'Internships' },
          ]}
        />
        <SearchField
          param="q"
          placeholder="Search by recipient"
          label="Search documents"
          className="sm:max-w-72 sm:flex-none"
        />
      </div>

      <DataTable
        columns={columns}
        rows={letters}
        rowKey={(row) => row.id}
        empty={
          <EmptyState
            icon={FileSignature}
            title={searching ? 'Nothing matches that' : 'No documents generated yet'}
            description={
              searching
                ? 'Try a different name or template.'
                : 'Generate an offer letter or an employment agreement on your own letterhead.'
            }
            action={
              searching ? null : (
                <Button asChild>
                  <Link href="/org/letters/new">Generate a document</Link>
                </Button>
              )
            }
          />
        }
      />

      <Pagination page={page} perPage={perPage} total={total} />

      <Dialog open={!!removing} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Delete this document?</DialogTitle>
          </DialogHeader>
          <DialogBody className="pb-4">
            <p className="text-sm text-ink-muted">
              {removing?.title} will be removed from {removing?.employeeName}&apos;s profile, from
              the document library and from storage. Anyone who already downloaded a copy keeps it.
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRemoving(null)} disabled={busy}>
              Keep it
            </Button>
            <Button variant="danger" loading={busy} onClick={remove}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
