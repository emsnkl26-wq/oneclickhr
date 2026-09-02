import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireTenantUser } from '@/lib/auth/guards'
import { finalizeUploadSchema } from '@/lib/schemas'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { keyBelongsToTenant, extensionOf, deleteObject } from '@/lib/r2'
import { validateStoredObject, extractPdfText } from '@/lib/upload'
import { audit } from '@/lib/audit'
import type { DocumentKind } from '@/types/db'

export const dynamic = 'force-dynamic'

/**
 * What a non-org caller may finalize. Must agree with `EMPLOYEE_PURPOSES` in
 * /api/files/presign — this is the gate that matters (presign is fail-fast
 * courtesy), so a purpose allowed there and refused here would let an employee
 * upload bytes that are then deleted out from under them.
 */
const EMPLOYEE_PURPOSES = ['photo', 'general', 'employee_doc', 'work_auth']

const DOC_KINDS: Record<string, DocumentKind> = {
  employee_doc: 'employee_doc',
  work_auth: 'work_auth',
  general: 'general',
}

/**
 * Phase two: validate what actually landed in R2, then — and only then — record it.
 *
 * Order matters. The security pipeline (size, SVG sanitization, magic-byte
 * sniff, dangerous-MIME denylist, image-spoof check) runs against the STORED
 * BYTES before any row is written, and deletes the object if it fails. So a
 * rejected upload leaves nothing behind and a database row can never point at
 * content nobody inspected.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const input = await parseBody(request, finalizeUploadSchema)

  // The key came back from the client, so re-prove it is ours before touching it.
  if (!keyBelongsToTenant(input.key, ctx.tenantId)) {
    return jsonError('That file does not belong to this workspace.', 403)
  }
  if (ctx.role !== 'org' && !EMPLOYEE_PURPOSES.includes(input.purpose)) {
    await deleteObject(input.key)
    return jsonError('You do not have permission to upload this kind of file.', 403)
  }

  const result = await validateStoredObject({
    key: input.key,
    purpose: input.purpose,
    ext: extensionOf(input.fileName),
    claimedType: input.contentType,
  })

  if (!result.ok) {
    await audit({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: 'file.upload_rejected',
      entity: 'documents',
      meta: { purpose: input.purpose, reason: result.error, fileName: input.fileName },
      request,
    })
    return jsonError(result.error, result.status)
  }

  // Photos, logos and payslips are referenced by the row they belong to
  // (profiles.photo_url, tenants.logo_url, payslips.file_url), so there is no
  // separate document record for them.
  const kind = DOC_KINDS[input.purpose]
  let documentId: string | undefined

  if (kind) {
    const supabase = await createSupabaseServerClient()

    // PDFs get their text extracted for search and preview. Best effort — a
    // scanned document yields nothing and that is not a failure.
    const extractedText =
      result.contentType === 'application/pdf' ? await extractPdfText(input.key) : null

    const { data, error } = await supabase
      .from('documents')
      .insert({
        tenant_id: ctx.tenantId,
        owner_id: ctx.userId,
        employee_id: input.employeeId ?? null,
        kind,
        file_url: input.key,
        file_name: input.fileName,
        mime_type: result.contentType,
        size_bytes: result.size,
        extracted_text: extractedText,
      })
      .select('id')
      .single()

    if (error) {
      // Never leave an object nothing points at.
      await deleteObject(input.key)
      return jsonError(friendlyDbError(error), 400)
    }
    documentId = data.id
  }

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'file.uploaded',
    entity: 'documents',
    entityId: documentId ?? null,
    meta: {
      purpose: input.purpose,
      contentType: result.contentType,
      sizeBytes: result.size,
      fileName: input.fileName,
    },
    request,
  })

  return jsonOk({
    key: input.key,
    contentType: result.contentType,
    size: result.size,
    documentId,
  })
}

export const POST = withErrorHandler(handlePOST)
