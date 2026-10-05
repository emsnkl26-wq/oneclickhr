import { NextRequest } from 'next/server'
import { z } from 'zod'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { deleteObject } from '@/lib/r2'
import { audit } from '@/lib/audit'
import { addStorageUsed } from '@/lib/storage-quota'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

const patchSchema = z.object({
  label: z
    .string()
    .trim()
    .max(120)
    .nullable()
    .transform((v) => v || null),
})

/** Name a document ("Passport", "Signed offer letter") — what the file IS (056). */
async function handlePATCH(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const { label } = await parseBody(request, patchSchema)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('documents')
    .update({ label })
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .select('id')
    .maybeSingle()

  if (error) return jsonError(friendlyDbError(error), 400)
  if (!data) return jsonError('That document was not found.', 404)
  return jsonOk({ ok: true })
}

/**
 * Remove a document: the row, then the stored object. The row goes first so a
 * storage failure leaves an orphaned object (harmless, invisible) rather than a
 * listed document whose download is broken.
 */
async function handleDELETE(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const supabase = await createSupabaseServerClient()

  const { data: doc } = await supabase
    .from('documents')
    .select('id, file_url, file_name, employee_id, size_bytes')
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle()
  if (!doc) return jsonError('That document was not found.', 404)

  const { error } = await supabase.from('documents').delete().eq('id', id).eq('tenant_id', ctx.tenantId)
  if (error) return jsonError(friendlyDbError(error), 400)

  try {
    await deleteObject(doc.file_url)
  } catch (err) {
    console.error('[documents] object delete failed', err)
  }
  // Released from the workspace's storage quota (056).
  if (doc.size_bytes) await addStorageUsed(ctx.tenantId, -Number(doc.size_bytes))

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'document.deleted',
    entity: 'documents',
    entityId: id,
    meta: { fileName: doc.file_name, employeeId: doc.employee_id },
    request,
  })

  return jsonOk({ ok: true })
}

export const PATCH = withErrorHandler(handlePATCH)
export const DELETE = withErrorHandler(handleDELETE)
