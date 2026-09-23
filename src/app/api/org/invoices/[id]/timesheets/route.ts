import { NextRequest } from 'next/server'
import { withErrorHandler, jsonOk, jsonError, friendlyDbError, uuidSchema } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * The approved weeks billed on this invoice — the same link `from-timesheets`
 * (024) stamps onto `timesheets.invoice_id` when the invoice is generated.
 *
 * Read by the PDF export (src/lib/invoice-pdf.ts) to auto-append a timesheet
 * summary page to a NORMAL invoice: nothing to fetch, and nothing to show, on
 * a freelancer invoice or a normal one entered by hand with no linked weeks.
 */
async function handleGET(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('timesheets')
    .select(
      'id, code, week_start, week_end, billable_hours, employee:profiles!timesheets_employee_id_fkey(full_name, email)'
    )
    .eq('invoice_id', id)
    .eq('tenant_id', ctx.tenantId)
    .order('week_start', { ascending: true })

  if (error) return jsonError(friendlyDbError(error), 400)

  const rows = (data ?? []) as unknown as Array<{
    id: string
    code: string
    week_start: string
    week_end: string
    billable_hours: number | string
    employee: { full_name: string | null; email: string | null } | null
  }>

  return jsonOk({
    timesheets: rows.map((row) => ({
      id: row.id,
      code: row.code,
      weekStart: row.week_start,
      weekEnd: row.week_end,
      billableHours: Number(row.billable_hours),
      employeeName: row.employee?.full_name || row.employee?.email || 'Employee',
    })),
  })
}

export const GET = withErrorHandler(handleGET)
