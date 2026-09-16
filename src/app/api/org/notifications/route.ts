import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { notificationSchema } from '@/lib/schemas'
import { sendAnnouncement, isEmailConfigured } from '@/lib/email'
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

  const { data: created, error } = await supabase
    .from('notifications')
    .insert({
      tenant_id: ctx.tenantId,
      title: input.title,
      description: input.description,
      send_to_type: input.sendToType,
      target_id: input.sendToType === 'all' ? null : input.targetId,
      image_url: input.imageUrl,
      created_by: ctx.userId,
    })
    .select('id')
    .single()

  if (error) return jsonError(friendlyDbError(error), 400)

  // Optional email copy. In-app delivery has already happened by this point, so
  // a mail failure is reported but never rolls the notification back.
  let emailed = 0
  if (input.alsoEmail && isEmailConfigured()) {
    let query = supabase
      .from('profiles')
      .select('email')
      .eq('role', 'employee')
      .eq('is_active', true)
    if (input.sendToType === 'department') query = query.eq('department_id', input.targetId!)
    if (input.sendToType === 'employee') query = query.eq('id', input.targetId!)

    const { data: recipients } = await query
    const addresses = (recipients ?? []).map((r) => r.email).filter(Boolean) as string[]

    if (addresses.length) {
      // Resend caps recipients per call; chunk so a large team still receives it.
      for (let i = 0; i < addresses.length; i += 45) {
        const chunk = addresses.slice(i, i + 45)
        const result = await sendAnnouncement({
          to: chunk,
          title: input.title,
          description: input.description,
          orgName: ctx.tenant.name,
          brandColor: ctx.tenant.primaryColor,
          // Only a pasted link survives the trip to an inbox — see the note on
          // AnnouncementArgs.imageUrl.
          imageUrl:
            input.imageUrl && isExternalImage(input.imageUrl) ? input.imageUrl : null,
        })
        if (result.ok) emailed += chunk.length
      }
    }
  }

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'notification.sent',
    entity: 'notifications',
    entityId: created.id,
    meta: { sendToType: input.sendToType, emailed },
    request,
  })

  return jsonOk({ id: created.id, emailed }, 201)
}

export const POST = withErrorHandler(handlePOST)
