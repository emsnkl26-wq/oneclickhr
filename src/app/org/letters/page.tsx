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
  employee_id: string
  created_at: string
  employee: { full_name: string | null; email: string | null; photo_url: string | null } | null
  author: { full_name: string | null; email: string | null } | null
}

/**
 * Every offer letter and agreement this workspace has issued.
 *
 * `!inner` on the employee embed keeps the search able to filter PARENT rows by
 * the recipient's name; without it the filter would prune only the embedded
 * object and leave the letter behind with nobody attached to it.
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
      'id, doc_type, title, file_url, file_name, employee_id, created_at, employee:profiles!generated_documents_employee_id_fkey!inner(full_name, email, photo_url), author:profiles!generated_documents_created_by_fkey(full_name, email)',
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .range(offset, offset + PER_PAGE - 1)

  if (docType) query = query.eq('doc_type', docType)
  if (search) query = query.ilike('employee.full_name', `%${search}%`)

  const { data, count } = await query

  const rows: LetterRow[] = ((data ?? []) as unknown as LetterWithEmployee[]).map((letter) => ({
    id: letter.id,
    docType: letter.doc_type,
    title: letter.title,
    fileKey: letter.file_url,
    fileName: letter.file_name,
    employeeId: letter.employee_id,
    employeeName: letter.employee?.full_name || letter.employee?.email || 'Employee',
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
