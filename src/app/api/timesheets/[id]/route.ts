import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema } from '@/lib/api'
import { apiRequireEmployee } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { saveTimesheetSchema } from '@/lib/schemas'
import { keyBelongsToTenant } from '@/lib/r2'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * Save the week — as a draft, or submitted for review.
 *
 * WHY THE ENTRIES ARE REPLACED WHOLESALE. The grid is edited as one thing: rows
 * are added, removed and re-ordered before anything is saved. Diffing them would
 * need a stable client-side id per line and would still leave the interesting
 * question — a line the person deleted — to a second request that might not
 * arrive. Deleting the week's lines and writing exactly what the form holds
 * makes the saved state identical to the state on screen, always.
 *
 * That is safe here because `timesheet_entries` carries no history: the totals
 * are recomputed by `tg_timesheet_rollup` from whatever rows exist, and the
 * approval record lives on the parent row, which is not touched by the replace.
 *
 * The replace goes through `save_timesheet_entries()` rather than a DELETE
 * request followed by an INSERT request, because those would be two separate
 * transactions — and a failure between them would leave the week emptied, with
 * the hours the person just typed gone. The function does both in one, running
 * as the caller so the same RLS policies still decide what may be written.
 *
 * WHAT STOPS AN EMPLOYEE APPROVING THEMSELVES. Three things, and the last is the
 * one that matters: the schema has no status field; RLS lets an employee update
 * only their own row; and `tg_timesheets_guard` refuses any status other than
 * `open` or `submitted` from the employee's own session.
 */
async function handlePATCH(request: NextRequest, { params }: Params) {
  const gate = await apiRequireEmployee()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const input = await parseBody(request, saveTimesheetSchema)
  const supabase = await createSupabaseServerClient()

  const { data: sheet } = await supabase
    .from('timesheets')
    .select('id, code, status, week_start, week_end')
    .eq('id', id)
    .eq('employee_id', ctx.userId)
    .maybeSingle()

  if (!sheet) return jsonError('That timesheet was not found.', 404)
  if (sheet.status !== 'open' && sheet.status !== 'rejected') {
    return jsonError('This timesheet has been submitted and can no longer be edited.', 409)
  }

  if (input.attachmentKey && !keyBelongsToTenant(input.attachmentKey, ctx.tenantId)) {
    return jsonError('That file does not belong to this workspace.', 403)
  }

  // A line with no hours at all is the empty row the form always keeps at the
  // bottom. Dropping it here means "Save" on an untouched grid stores nothing
  // rather than a row of zeroes the totals would have to ignore later.
  const entries = input.entries.filter(
    (entry) =>
      entry.hoursSun + entry.hoursMon + entry.hoursTue + entry.hoursWed +
        entry.hoursThu + entry.hoursFri + entry.hoursSat >
        0 || !!entry.projectId || !!entry.taskName
  )

  if (input.submit && entries.length === 0) {
    return jsonError('Add at least one line before submitting.', 400)
  }

  // Every project id is re-proved against this employee's assignments. RLS
  // already hides other tenants' projects; this also stops someone logging hours
  // against a project inside their own org that they are not on.
  const projectIds = Array.from(
    new Set(entries.map((entry) => entry.projectId).filter(Boolean) as string[])
  )
  if (projectIds.length) {
    const { data: allowed } = await supabase
      .from('project_assignments')
      .select('project_id')
      .eq('employee_id', ctx.userId)
      .in('project_id', projectIds)

    const allowedIds = new Set((allowed ?? []).map((row) => row.project_id))
    if (allowedIds.size !== projectIds.length) {
      return jsonError('You are not assigned to one of those projects.', 403)
    }
  }

  const { error: saveError } = await supabase.rpc('save_timesheet_entries', {
    p_timesheet_id: id,
    p_entries: entries,
  })

  if (saveError) return jsonError(friendlyDbError(saveError), 400)

  /*
   * The header update goes LAST, and deliberately does not set the totals:
   * `tg_timesheet_rollup` has already written them from the rows above, and a
   * number computed in Node could only ever disagree with the grid.
   *
   * Resubmitting a rejected week clears the old decision. Leaving it would show
   * the employee a rejection note against a sheet they have since fixed, and the
   * org a "rejected" stamp on something waiting for them.
   */
  const patch: Record<string, unknown> = {
    comments: input.comments,
    attachment_url: input.attachmentKey,
    attachment_name: input.attachmentName,
  }
  if (input.submit) {
    patch.status = 'submitted'
    patch.submitted_at = new Date().toISOString()
    patch.review_note = null
    patch.reviewed_at = null
    patch.reviewed_by = null
  }

  const { error } = await supabase.from('timesheets').update(patch).eq('id', id)
  if (error) return jsonError(friendlyDbError(error), 400)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: input.submit ? 'timesheet.submitted' : 'timesheet.saved',
    entity: 'timesheets',
    entityId: id,
    meta: { code: sheet.code, weekStart: sheet.week_start, lines: entries.length },
    request,
  })

  return jsonOk({ ok: true, status: input.submit ? 'submitted' : sheet.status })
}

/** Withdraw a week that has not been submitted. */
async function handleDELETE(request: NextRequest, { params }: Params) {
  const gate = await apiRequireEmployee()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const supabase = await createSupabaseServerClient()

  const { data: sheet } = await supabase
    .from('timesheets')
    .select('id, code, status')
    .eq('id', id)
    .eq('employee_id', ctx.userId)
    .maybeSingle()

  if (!sheet) return jsonError('That timesheet was not found.', 404)
  if (sheet.status === 'submitted' || sheet.status === 'approved') {
    return jsonError('A submitted timesheet cannot be deleted.', 409)
  }

  const { error } = await supabase.from('timesheets').delete().eq('id', id)
  if (error) return jsonError(friendlyDbError(error), 400)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'timesheet.deleted',
    entity: 'timesheets',
    entityId: id,
    meta: { code: sheet.code },
    request,
  })

  return jsonOk({ ok: true })
}

export const PATCH = withErrorHandler(handlePATCH)
export const DELETE = withErrorHandler(handleDELETE)
