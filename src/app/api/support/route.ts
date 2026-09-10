import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireTenantUser } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supportRequestSchema } from '@/lib/schemas'
import { rateLimit, limitKey } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * Tell Oneclickhr something.
 *
 * NOT THE HELP DESK. `/api/tickets` is a workspace's own internal queue, which
 * never leaves the tenant. This one goes the other way: a customer reporting a
 * bug, asking for a feature, or querying a bill — traffic that previously
 * arrived at whatever email address somebody happened to know.
 *
 * WHO IT IS FROM IS NOT UP TO THE CALLER. The reporter, their email and their
 * workspace all come from the session, and the RLS insert policy (028) pins
 * `profile_id` to `auth.uid()` independently. A support queue where anybody can
 * file a report in a colleague's name is worse than no queue.
 *
 * The name, email and workspace name are COPIED onto the row rather than joined
 * on read, so a report survives the account being deleted. An unattributable bug
 * report is close to useless.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  // Generous for a person, useless for a script. This is a write endpoint open
  // to every signed-in user in the product.
  const limited = await rateLimit(limitKey('support', ctx.userId), 10, 60 * 60 * 1000)
  if (!limited.ok) {
    return jsonError('You have sent several messages recently. Please give us a little time.', 429)
  }

  const input = await parseBody(request, supportRequestSchema)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('support_requests')
    .insert({
      tenant_id: ctx.tenantId,
      profile_id: ctx.userId,
      reporter_name: ctx.fullName,
      reporter_email: ctx.email,
      tenant_name: ctx.tenant?.name ?? null,
      category: input.category,
      subject: input.subject,
      message: input.message,
      page_url: input.pageUrl,
      // Truncated to the column's limit rather than rejected: a browser with an
      // unusually long UA string is not a reason to lose somebody's bug report.
      user_agent: (request.headers.get('user-agent') ?? '').slice(0, 500) || null,
      status: 'new',
    })
    .select('id')
    .single()

  if (error) return jsonError(friendlyDbError(error), 400)

  return jsonOk({ id: data.id }, 201)
}

export const POST = withErrorHandler(handlePOST)
