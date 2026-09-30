import { NextRequest } from 'next/server'
import { withErrorHandler, jsonOk, jsonError, uuidSchema } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getObject, keyBelongsToTenant } from '@/lib/r2'
import { isEmailConfigured, sendLetterEmail } from '@/lib/email'
import { DOCUMENT_TYPE_LABELS } from '@/lib/document-templates'
import { rateLimit, limitKey } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'
import type { GeneratedDocumentType } from '@/types/db'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/** Well above any generated letter; a bigger object is not one of ours. */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

/**
 * Email a generated letter to its recipient, with the PDF attached.
 *
 * THE ADDRESS IS THE ONE ON THE LETTER, never one from the request. The body
 * carries nothing at all, so this route cannot be pointed at an arbitrary
 * inbox — it sends a workspace's own document to the person it was written
 * for. To send elsewhere, correct the letter's recipient first.
 *
 * The PDF is read back from storage rather than accepted from the client, so
 * what is emailed is exactly what the library holds.
 */
async function handlePOST(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  if (!isEmailConfigured()) {
    return jsonError('Email is not set up for this workspace. Download the PDF and send it manually.', 503)
  }

  const limited = await rateLimit(limitKey('letter-send', ctx.userId), 20, 60 * 60 * 1000)
  if (!limited.ok) return jsonError('Too many letters sent in the last hour. Please try again later.', 429)

  const id = uuidSchema.parse((await params).id)
  const supabase = await createSupabaseServerClient()

  const { data: letter } = await supabase
    .from('generated_documents')
    .select('id, doc_type, title, recipient_name, recipient_email, file_url, file_name')
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle()

  if (!letter) return jsonError('That document was not found.', 404)
  if (!letter.recipient_email) {
    return jsonError('This letter has no recipient email. Add one, or download it and send it manually.', 400)
  }
  if (!letter.file_url || !keyBelongsToTenant(letter.file_url, ctx.tenantId)) {
    return jsonError('The PDF for this letter could not be found.', 404)
  }

  let content: Buffer
  try {
    content = await getObject(letter.file_url)
  } catch (err) {
    console.error('[letters/send] could not read the PDF', err)
    return jsonError('The PDF for this letter could not be read. Please try again.', 502)
  }
  if (content.byteLength > MAX_ATTACHMENT_BYTES) {
    return jsonError('This PDF is too large to email. Download it and send it manually.', 413)
  }

  const { data: tenant } = await supabase
    .from('tenants')
    .select('company_email')
    .eq('id', ctx.tenantId)
    .maybeSingle()

  const result = await sendLetterEmail({
    to: letter.recipient_email,
    recipientName: letter.recipient_name ?? '',
    documentLabel: DOCUMENT_TYPE_LABELS[letter.doc_type as GeneratedDocumentType] ?? 'Letter',
    orgName: ctx.tenant.name,
    brandColor: ctx.tenant.primaryColor,
    replyTo: tenant?.company_email || ctx.email,
    attachment: { filename: letter.file_name || `${letter.title}.pdf`, content },
  })

  if (!result.ok) {
    return jsonError('The email could not be sent. Download the PDF and send it manually.', 502)
  }

  const sentAt = new Date().toISOString()
  const { error: stampError } = await supabase
    .from('generated_documents')
    .update({ sent_at: sentAt, sent_to: letter.recipient_email })
    .eq('id', id)
  // The email is out; failing to stamp it must not make the org send it twice.
  if (stampError) console.error('[letters/send] could not record the send', stampError)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'document.sent',
    entity: 'generated_documents',
    entityId: id,
    meta: { docType: letter.doc_type, to: letter.recipient_email },
    request,
  })

  return jsonOk({ ok: true, sentAt, sentTo: letter.recipient_email })
}

export const POST = withErrorHandler(handlePOST)
