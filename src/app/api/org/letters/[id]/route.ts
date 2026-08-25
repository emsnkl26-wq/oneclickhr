import { NextRequest } from 'next/server'
import { withErrorHandler, jsonOk, jsonError, friendlyDbError, uuidSchema } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { keyBelongsToTenant, deleteObject } from '@/lib/r2'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * Delete a generated letter — the record, the library entry and the object.
 *
 * ORDER MATTERS, and it is the reverse of the upload's. Finalize validates the
 * bytes before writing a row, so a row never points at uninspected content; here
 * the rows go first, so a failure part-way through leaves an object nothing
 * references rather than a row pointing at a file that is gone. An orphaned
 * object is invisible and cheap; a dangling row is a broken download link on
 * someone's profile.
 */
async function handleDELETE(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const supabase = await createSupabaseServerClient()

  const { data: letter } = await supabase
    .from('generated_documents')
    .select('id, title, file_url, document_id, employee_id, doc_type')
    .eq('id', id)
    .maybeSingle()

  if (!letter) return jsonError('That document was not found.', 404)

  const { error } = await supabase.from('generated_documents').delete().eq('id', id)
  if (error) return jsonError(friendlyDbError(error), 400)

  if (letter.document_id) {
    await supabase.from('documents').delete().eq('id', letter.document_id)
  }

  // Re-prove the prefix before touching storage. The key came from our own row,
  // but this is the one call that reaches outside the database.
  if (keyBelongsToTenant(letter.file_url, ctx.tenantId)) {
    try {
      await deleteObject(letter.file_url)
    } catch (err) {
      console.error('[letters] could not remove the stored object', err)
    }
  }

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'document.deleted',
    entity: 'generated_documents',
    entityId: id,
    meta: { docType: letter.doc_type, employeeId: letter.employee_id },
    request,
  })

  return jsonOk({ ok: true })
}

export const DELETE = withErrorHandler(handleDELETE)
