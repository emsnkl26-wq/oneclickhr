import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { notificationSchema } from '@/lib/schemas'
import { deliverNotification } from '@/lib/notifications/dispatch'
import { isExternalImage } from '@/lib/notification-image'
import { keyBelongsToTenant } from '@/lib/r2'
import { audit } from '@/lib/audit'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const bodySchema = notificationSchema.and(z.object({ alsoEmail: z.boolean().default(false) }))

/**
 * Send a notification to everyone, a department, or one person.
 *
 * The audience is expressed as `send_to_type` + `target_id` and resolved by the
 * `notifications_select` policy at READ time, not fanned out into per-recipient
 * rows at write time. One row, and Postgres decides who may see it — which means
 * a later department change is reflected automatically, and there is no
 * duplicated audience list to drift.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const input = await parseBody(request, bodySchema)
  const supabase = await createSupabaseServerClient()

  // The target id comes from the request; confirm it belongs to this tenant.
  // Under RLS a foreign id resolves to nothing.
  if (input.sendToType === 'department') {
    const { data } = await supabase
      .from('departments')
      .select('id')
      .eq('id', input.targetId!)
      .maybeSingle()
    if (!data) return jsonError('That department was not found.', 404)
  }
  if (input.sendToType === 'employee') {
    const { data } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', input.targetId!)
      .eq('role', 'employee')
      .maybeSingle()
    if (!data) return jsonError('That employee was not found.', 404)
  }

  /*
   * An uploaded image arrives as a storage KEY, and a key is a path — so it is
   * checked against this tenant's prefix before it is stored. Without this, an
   * admin could paste another workspace's key and have /api/files/view resolve
   * it for their whole team. An external https:// link has no such check to
   * make: zod has already refused every other scheme.
   */
  if (input.imageUrl && !isExternalImage(input.imageUrl)) {
    if (!keyBelongsToTenant(input.imageUrl, ctx.tenantId)) {
      return jsonError('That image does not belong to this workspace.', 403)
    }
  }

  /*
   * The composer's "also send by email" checkbox is what decides IMPORTANCE for
   * an announcement, and it is the only event whose importance is not fixed by
   * the catalog (see src/lib/notifications/events.ts). That is the right shape
   * for this one: "is this worth an email?" is a judgement about the message
   * somebody has just typed, and the person typing it is the one who knows.
   *
   * It is stored on the row rather than kept as a local, so the record says what
   * was promised at send time even after the fact.
   */
  const importance = input.alsoEmail ? ('important' as const) : ('normal' as const)

  const { data: created, error } = await supabase
    .from('notifications')
    .insert({
      tenant_id: ctx.tenantId,
      title: input.title,
      description: input.description,
      send_to_type: input.sendToType,
      target_id: input.sendToType === 'all' ? null : input.targetId,
      image_url: input.imageUrl,
      importance,
      created_by: ctx.userId,
    })
    .select('id')
    .single()

  if (error) return jsonError(friendlyDbError(error), 400)

  /*
   * Everything beyond this point is delivery, and delivery never rolls the
   * notification back. It is in the portal now; whether a push service or Resend
   * was reachable a second later does not change that.
   *
   * The audience, the chunking and the "only an external image survives the trip
   * to an inbox" rule all used to live here as a block of inline email code.
   * They moved into `deliverNotification` when browser push landed, so that the
   * composer, `notifyEmployee` and the visa cron cannot end up with three
   * different answers to "who gets told, and how?".
   */
  const report = await deliverNotification({
    notificationId: created.id,
    tenantId: ctx.tenantId,
    audience:
      input.sendToType === 'all'
        ? { type: 'all' }
        : { type: input.sendToType, targetId: input.targetId! },
    title: input.title,
    description: input.description,
    imageUrl: input.imageUrl,
    event: 'announcement',
    importance,
    // The author does not need their own phone to buzz about their own notice.
    actorId: ctx.userId,
  })

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'notification.sent',
    entity: 'notifications',
    entityId: created.id,
    meta: {
      sendToType: input.sendToType,
      emailed: report.emailed,
      pushed: report.pushed,
      recipients: report.recipients,
    },
    request,
  })

  // `emailed` keeps the name and the meaning the composer has always read.
  return jsonOk({ id: created.id, emailed: report.emailed, pushed: report.pushed }, 201)
}

export const POST = withErrorHandler(handlePOST)
