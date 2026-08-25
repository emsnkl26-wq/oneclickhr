import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { tenantSettingsSchema, onboardingSchema, companyDetailsSchema } from '@/lib/schemas'
import { isValidTimezone } from '@/lib/time'
import { keyBelongsToTenant } from '@/lib/r2'
import { audit } from '@/lib/audit'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

/**
 * One PATCH for the whole settings page.
 *
 * EVERY FIELD IS OPTIONAL, AND ABSENT MEANS "LEAVE IT ALONE". The page now has
 * two independent forms on it — branding and the letterhead — and each posts
 * only what it owns. Requiring the branding fields would force the letterhead
 * form to send a copy of them, and whichever form had loaded first would quietly
 * revert the other's edit. A key sent as null or '' still CLEARS the value; only
 * omission is a no-op.
 */
const patchSchema = tenantSettingsSchema
  .partial()
  .extend({ logoKey: z.string().trim().max(300).nullable().optional() })
  .merge(companyDetailsSchema.partial())

/** Column for each field this route can write, in one legible mapping. */
const BRANDING_COLUMNS = {
  name: 'name',
  primaryColor: 'primary_color',
  timezone: 'timezone',
  workStartTime: 'work_start_time',
} as const

const COMPANY_COLUMNS = {
  addressLine1: 'address_line1',
  addressLine2: 'address_line2',
  city: 'city',
  stateProvince: 'state_province',
  postalCode: 'postal_code',
  country: 'country',
  registrationNumber: 'registration_number',
  companyEmail: 'company_email',
  companyPhone: 'company_phone',
  website: 'website',
  signatoryName: 'signatory_name',
  signatoryTitle: 'signatory_title',
  signatoryPhone: 'signatory_phone',
} as const

/** Update workspace settings: name, branding, timezone, shift start, letterhead. */
async function handlePATCH(request: NextRequest) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const input = await parseBody(request, patchSchema)

  // An invalid IANA zone would silently corrupt every attendance day boundary
  // and the visa day-diff, so it is rejected here rather than trusted.
  if (input.timezone !== undefined && !isValidTimezone(input.timezone)) {
    return jsonError('That is not a recognised timezone.', 400)
  }
  if (input.logoKey && !keyBelongsToTenant(input.logoKey, ctx.tenantId)) {
    return jsonError('That file does not belong to this workspace.', 403)
  }

  const patch: Record<string, unknown> = {}
  const values = input as Record<string, unknown>

  for (const [field, column] of Object.entries({ ...BRANDING_COLUMNS, ...COMPANY_COLUMNS })) {
    if (values[field] !== undefined) patch[column] = values[field]
  }
  if (input.logoKey !== undefined) patch.logo_url = input.logoKey

  if (Object.keys(patch).length === 0) return jsonOk({ ok: true, unchanged: true })

  const supabase = await createSupabaseServerClient()

  // RLS restricts this to `id = app.current_tenant_id()`; the filter mirrors it
  // so the intent is legible at the call site too.
  const { error } = await supabase.from('tenants').update(patch).eq('id', ctx.tenantId)
  if (error) return jsonError(friendlyDbError(error), 400)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'tenant.settings_updated',
    entity: 'tenants',
    entityId: ctx.tenantId,
    meta: { fields: Object.keys(patch) },
    request,
  })

  return jsonOk({ ok: true })
}

/** Complete first-run onboarding: branding, timezone, first department. */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const input = await parseBody(request, onboardingSchema)
  if (!isValidTimezone(input.timezone)) {
    return jsonError('That is not a recognised timezone.', 400)
  }

  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from('tenants')
    .update({
      primary_color: input.primaryColor,
      timezone: input.timezone,
      onboarded_at: new Date().toISOString(),
    })
    .eq('id', ctx.tenantId)

  if (error) return jsonError(friendlyDbError(error), 400)

  // Best effort — a duplicate name should not block finishing onboarding.
  const { error: deptError } = await supabase
    .from('departments')
    .insert({ tenant_id: ctx.tenantId, name: input.departmentName })
  if (deptError && deptError.code !== '23505') {
    console.error('[onboarding] department insert failed', deptError.message)
  }

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'tenant.onboarded',
    entity: 'tenants',
    entityId: ctx.tenantId,
    request,
  })

  return jsonOk({ ok: true })
}

export const PATCH = withErrorHandler(handlePATCH)
export const POST = withErrorHandler(handlePOST)
