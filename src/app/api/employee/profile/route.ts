import { NextRequest } from 'next/server'
import { z } from 'zod'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireTenantUser } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { keyBelongsToTenant } from '@/lib/r2'
import { isValidTimezone } from '@/lib/time'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * Self-service profile fields, and ONLY these.
 *
 * The schema is the first gate; `tg_profiles_guard` in 002_rls.sql is the real
 * one — it raises if a self-update touches role, is_active, department,
 * designation, employee code, joining date, or tenant. So even a request crafted
 * outside this schema cannot escalate anything.
 *
 * EVERY FIELD IS OPTIONAL, AND ABSENT MEANS "LEAVE IT ALONE". Two controls now
 * write here — the details form and the photo control on the profile header —
 * and a required field would force each of them to post the other's state.
 * Whichever one loaded first would then quietly revert the other's edit. A key
 * sent as null or '' still CLEARS the value; only omission is a no-op.
 */
const schema = z.object({
  fullName: z.string().trim().min(2, 'Enter your name').max(120).optional(),
  phone: z.string().trim().max(32).nullish(),
  photoKey: z.string().trim().max(300).nullish(),
  timezone: z.string().trim().min(3).max(64).optional(),
  /** Their own LinkedIn address (059). Self-service, like `phone` above. */
  linkedinUrl: z.string().trim().max(400).nullish(),
})

async function handlePATCH(request: NextRequest) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const input = await parseBody(request, schema)

  if (input.timezone !== undefined && !isValidTimezone(input.timezone)) {
    return jsonError('That is not a recognised timezone.', 400)
  }
  if (input.photoKey && !keyBelongsToTenant(input.photoKey, ctx.tenantId)) {
    return jsonError('That file does not belong to this workspace.', 403)
  }
  // A scheme is required so the saved value is an absolute link. A bare
  // `linkedin.com/in/x` renders as a relative URL and navigates inside our own
  // app, which looks like a broken page rather than a wrong field.
  if (input.linkedinUrl && !/^https?:\/\/\S+$/i.test(input.linkedinUrl)) {
    return jsonError('Enter a full LinkedIn address starting with https://', 400)
  }

  const patch: Record<string, unknown> = {}
  if (input.fullName !== undefined) patch.full_name = input.fullName
  if (input.phone !== undefined) patch.phone = input.phone || null
  if (input.photoKey !== undefined) patch.photo_url = input.photoKey || null
  if (input.timezone !== undefined) patch.timezone = input.timezone
  if (input.linkedinUrl !== undefined) patch.linkedin_url = input.linkedinUrl || null

  if (Object.keys(patch).length === 0) return jsonOk({ ok: true, unchanged: true })

  const supabase = await createSupabaseServerClient()

  const { error } = await supabase.from('profiles').update(patch).eq('id', ctx.userId)

  if (error) return jsonError(friendlyDbError(error), 400)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'profile.updated',
    entity: 'profiles',
    entityId: ctx.userId,
    request,
  })

  return jsonOk({ ok: true })
}

export const PATCH = withErrorHandler(handlePATCH)
