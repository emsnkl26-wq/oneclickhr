import type { Metadata } from 'next'
import Link from 'next/link'
import { FilePlus2 } from 'lucide-react'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import { LettersList, type LetterRow } from './letters-list'
import type { GeneratedDocumentType } from '@/types/db'

export const metadata: Metadata = { title: 'Letters' }
export const dynamic = 'force-dynamic'

const PER_PAGE = 50

interface LetterWithEmployee {
  id: string
  doc_type: GeneratedDocumentType
  title: string
  file_url: string
  file_name: string | null
  employee_id: string | null
  recipient_name: string
  created_at: string
  employee: { full_name: string | null; email: string | null; photo_url: string | null } | null
  author: { full_name: string | null; email: string | null } | null
}

/**
 * Every offer letter and agreement this workspace has issued.
 *
 * THE RECIPIENT IS A COLUMN, not a join. Most rows here are offer letters,
 * written before the person has an account at all, so there is frequently no
 * profile to embed — an `!inner` join would hide exactly the letters this screen
 * exists for. `recipient_name` is written on every row (historical ones included,
 * backfilled by migration 016), which is also what lets the search filter parent
 * rows directly instead of pruning an embed that may not be there.
 *
 * The employee embed survives only to show a face and link to a profile on the
 * documents that happen to have been generated from one.
 */
export default async function LettersPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; q?: string; page?: string }>
}) {
  const ctx = await requireOrg()
  const supabase = await createSupabaseServerClient()
  const params = await searchParams

  const types: GeneratedDocumentType[] = ['offer_letter', 'employment_agreement', 'internship_offer']
  const docType = types.includes(params.type as GeneratedDocumentType) ? params.type! : ''
  const search = params.q?.trim() || ''
  const page = Math.max(1, parseInt(params.page ?? '', 10) || 1)
  const offset = (page - 1) * PER_PAGE

  let query = supabase
    .from('generated_documents')
    .select(
      'id, doc_type, title, file_url, file_name, employee_id, recipient_name, created_at, employee:profiles!generated_documents_employee_id_fkey(full_name, email, photo_url), author:profiles!generated_documents_created_by_fkey(full_name, email)',
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .range(offset, offset + PER_PAGE - 1)

  if (docType) query = query.eq('doc_type', docType)
  if (search) query = query.ilike('recipient_name', `%${search}%`)

  const { data, count } = await query

  const rows: LetterRow[] = ((data ?? []) as unknown as LetterWithEmployee[]).map((letter) => ({
    id: letter.id,
    docType: letter.doc_type,
    title: letter.title,
    fileKey: letter.file_url,
    fileName: letter.file_name,
    employeeId: letter.employee_id,
    employeeName:
      letter.recipient_name || letter.employee?.full_name || letter.employee?.email || 'Recipient',
    employeePhoto: letter.employee?.photo_url ?? null,
    authorName: letter.author?.full_name || letter.author?.email || null,
    createdAt: letter.created_at,
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Letters"
        description="Offer letters and employment agreements, generated on your own letterhead."
        actions={
          <Button asChild>
            <Link href="/org/letters/new">
              <FilePlus2 />
              Generate document
            </Link>
          </Button>
        }
      />
      <LettersList
        letters={rows}
        total={count ?? rows.length}
        page={page}
        perPage={PER_PAGE}
        docType={docType}
        searching={!!search || !!docType}
        timezone={ctx.tenant.timezone}
      />
    </div>
  )
}
