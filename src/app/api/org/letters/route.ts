import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { generatedDocumentSchema } from '@/lib/schemas'
import { keyBelongsToTenant } from '@/lib/r2'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * Record a generated letter.
 *
 * The PDF itself is rendered in the BROWSER and uploaded through the ordinary
 * two-phase pipeline before this route is called. That split is deliberate:
 *
 *   • The document is already fully described by the form on screen, so
 *     rendering it there costs no round trip and puts no PDF toolchain in a
 *     serverless function.
 *   • The bytes still go through `/api/files/finalize`, which sniffs them and
 *     writes the `documents` row — so a generated letter is validated and
 *     searchable exactly like an uploaded one, with no second storage path.
 *
 * What is left for this handler is the part that must not be decided by a
 * client: proving the key belongs to this tenant, proving the employee does,
 * and writing the row that links the two.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const input = await parseBody(request, generatedDocumentSchema)

  if (!keyBelongsToTenant(input.key, ctx.tenantId)) {
    return jsonError('That file does not belong to this workspace.', 403)
  }

  const supabase = await createSupabaseServerClient()

  const { data: employee } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .eq('id', input.employeeId)
    .eq('role', 'employee')
    .maybeSingle()

  if (!employee) return jsonError('That employee was not found.', 404)

  const { data, error } = await supabase
    .from('generated_documents')
    .insert({
      tenant_id: ctx.tenantId,
      employee_id: input.employeeId,
      doc_type: input.docType,
      title: input.title,
      file_url: input.key,
      file_name: input.fileName,
      document_id: input.documentId ?? null,
      payload: input.payload,
      created_by: ctx.userId,
    })
    .select('id')
    .single()

  if (error) return jsonError(friendlyDbError(error), 400)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'document.generated',
    entity: 'generated_documents',
    entityId: data.id,
    meta: { docType: input.docType, employeeId: input.employeeId },
    request,
  })

  return jsonOk({ id: data.id }, 201)
}

export const POST = withErrorHandler(handlePOST)
