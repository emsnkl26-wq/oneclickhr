import { NextRequest } from 'next/server'
import { withErrorHandler, jsonOk, jsonError, friendlyDbError, uuidSchema } from '@/lib/api'
import { apiRequireTenantUser } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * Follow a card.
 *
 * Always the CALLER — there is no body, and `profile_id` comes from the
 * session. Subscribing somebody else to a notification stream they did not ask
 * for is the sort of thing that gets a product's notifications muted wholesale,
 * and `task_watchers_insert` refuses it for anyone but an org user anyway.
 *
 * Watching is mostly automatic (assignment, authorship and creation all
 * subscribe you, by trigger). This exists for the case the automatic rules do
 * not cover: caring about a card that is not yours.
 */
async function handlePOST(_request: NextRequest, { params }: Params) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const taskId = uuidSchema.parse((await params).id)
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from('task_watchers')
    // Already watching is the outcome the caller wanted, not an error.
    .upsert(
      { task_id: taskId, profile_id: ctx.userId, tenant_id: ctx.tenantId },
      { onConflict: 'task_id,profile_id', ignoreDuplicates: true }
    )

  if (error) return jsonError(friendlyDbError(error), 400)
  return jsonOk({ watching: true })
}

async function handleDELETE(_request: NextRequest, { params }: Params) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const taskId = uuidSchema.parse((await params).id)
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from('task_watchers')
    .delete()
    .eq('task_id', taskId)
    .eq('profile_id', ctx.userId)

  if (error) return jsonError(friendlyDbError(error), 400)
  return jsonOk({ watching: false })
}

export const POST = withErrorHandler(handlePOST)
export const DELETE = withErrorHandler(handleDELETE)
