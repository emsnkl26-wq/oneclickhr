import { NextRequest } from 'next/server'
import { z } from 'zod'
import { withErrorHandler, parseBody, jsonOk, jsonError, uuidSchema } from '@/lib/api'
import { apiRequireSuperAdmin } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { isEmailConfigured, sendVisaExpiryNotice } from '@/lib/email'
import { rateLimit, limitKey } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

const bodySchema = z.object({
  /** Copy the workspace's owners, so the employer knows the reminder went out. */
  copyEmployer: z.boolean().default(true),
  note: z.string().trim().max(500).optional().transform((v) => v || null),
})

/**
 * Email someone about their expiring work authorization, from the platform
 * console (056).
 *
 * The scheduled job (/api/cron/visa-reminders) already writes at 90, 30, 7 and
 * 0 days; this is the hand-sent version for whenever the platform team sees a
 * date coming up. It reads the authorization with the nearest expiry, so the
 * reminder is always about the one that matters, and it is rate-limited per
 * person so a double click cannot become a pile of email.
 */
async function handlePOST(request: NextRequest, { params }: Params) {
  const gate = await apiRequireSuperAdmin()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const userId = uuidSchema.parse((await params).id)
  const input = await parseBody(request, bodySchema)

  if (!isEmailConfigured()) return jsonError('Email is not configured on this server.', 503)

  const limited = await rateLimit(limitKey('visa-remind', userId), 3, 60 * 60 * 1000)
  if (!limited.ok) return jsonError('A reminder was sent to this person very recently.', 429)

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('id, full_name, email, tenant_id, role')
    .eq('id', userId)
    .maybeSingle()

  if (!profile || profile.role !== 'employee' || !profile.tenant_id || !profile.email) {
    return jsonError('Only an employee with an email address can be reminded.', 400)
  }

  const [{ data: auth }, { data: tenant }, { data: owners }] = await Promise.all([
    admin
      .from('work_authorizations')
      .select('visa_type, expiry_date')
      .eq('employee_id', userId)
      .order('expiry_date', { ascending: true })
      .limit(1)
      .maybeSingle(),
    admin.from('tenants').select('name').eq('id', profile.tenant_id).maybeSingle(),
    admin
      .from('profiles')
      .select('email')
      .eq('tenant_id', profile.tenant_id)
      .eq('role', 'org')
      .eq('is_active', true),
  ])

  if (!auth) return jsonError('This person has no work authorization on record.', 404)

  const today = new Date(new Date().toISOString().slice(0, 10)).getTime()
  const daysRemaining = Math.round((new Date(auth.expiry_date).getTime() - today) / 86_400_000)

  const cc = input.copyEmployer
    ? ((owners ?? []) as Array<{ email: string | null }>)
        .map((o) => o.email)
        .filter((email): email is string => !!email && email !== profile.email)
    : []

  const result = await sendVisaExpiryNotice({
    to: profile.email,
    cc,
    employeeName: profile.full_name || profile.email,
    visaType: auth.visa_type,
    expiryDate: auth.expiry_date,
    daysRemaining,
    orgName: tenant?.name ?? 'your employer',
    note: input.note,
  })

  if (!result.ok) return jsonError('The reminder could not be sent. Please try again.', 502)

  await audit({
    tenantId: profile.tenant_id,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'visa.reminder_sent',
    entity: 'profiles',
    entityId: userId,
    meta: { visaType: auth.visa_type, expiryDate: auth.expiry_date, daysRemaining, copied: cc.length },
    request,
  })

  return jsonOk({ ok: true, daysRemaining })
}

export const POST = withErrorHandler(handlePOST)
