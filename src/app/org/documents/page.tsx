import type { Metadata } from 'next'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/patterns'
import { DocumentLibrary, DOCUMENT_KINDS, type DocumentRow } from './document-library'

export const metadata: Metadata = { title: 'Documents' }
export const dynamic = 'force-dynamic'

const PER_PAGE = 50

/** What `search_documents` returns, one row per document on this page. */
interface SearchRow {
  id: string
  employee_id: string | null
  kind: DocumentRow['kind']
  file_url: string
  file_name: string | null
  mime_type: string | null
  size_bytes: number | null
  excerpt: string | null
  created_at: string
  total_count: number
}

/**
 * The library, searched and paged BY THE DATABASE.
 *
 * This page used to select `extracted_text` for 500 documents and filter them in
 * the browser. That is a design that works beautifully on a demo tenant and
 * collapses on a real one: the extracted text of a scanned contract is hundreds
 * of kilobytes, so the payload grew without bound while the screen never showed
 * more than a couple of dozen rows.
 *
 * `search_documents` (009_performance.sql) does the filtering against the
 * existing full-text index, cuts the excerpt to the 240 characters the table
 * actually renders, and returns one page. It runs SECURITY INVOKER, so the same
 * RLS policy scopes it to this tenant.
 */
export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; kind?: string; page?: string }>
}) {
  const ctx = await requireOrg()
  const supabase = await createSupabaseServerClient()
  const params = await searchParams

  const page = Math.max(1, parseInt(params.page ?? '', 10) || 1)
  const query = params.q?.trim() || null
  const kind = DOCUMENT_KINDS.includes(params.kind as never) ? params.kind! : null

  const { data } = await supabase.rpc('search_documents', {
    p_query: query,
    p_kind: kind,
    p_limit: PER_PAGE,
    p_offset: (page - 1) * PER_PAGE,
  })

  const rows = (data ?? []) as SearchRow[]
  const total = rows[0]?.total_count ?? 0

  // Names for the fifty rows on screen — never for the whole table.
  const employeeIds = Array.from(
    new Set(rows.map((row) => row.employee_id).filter(Boolean) as string[])
  )
  const names = new Map<string, string>()
  if (employeeIds.length) {
    const { data: people } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', employeeIds)
    for (const person of people ?? []) {
      names.set(person.id, person.full_name || person.email || 'Employee')
    }
  }

  const documents: DocumentRow[] = rows.map((row) => ({
    id: row.id,
    employee_id: row.employee_id,
    employeeName: row.employee_id ? (names.get(row.employee_id) ?? null) : null,
    kind: row.kind,
    file_url: row.file_url,
    file_name: row.file_name,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    excerpt: row.excerpt,
    created_at: row.created_at,
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Documents"
        description="Every file in your workspace. PDF contents are searchable."
      />
      <DocumentLibrary
        documents={documents}
        total={Number(total)}
        page={page}
        perPage={PER_PAGE}
        searching={!!query || !!kind}
        timezone={ctx.tenant.timezone}
      />
    </div>
  )
}
