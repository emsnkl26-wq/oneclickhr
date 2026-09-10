import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { invoiceFromTimesheetsSchema } from '@/lib/schemas'
import { computeTotals, normalizeItems, suggestInvoiceNumber } from '@/lib/invoice'
import { billLines, type BillableWeek } from '@/lib/billing'
import { addDays } from '@/lib/time'
import { audit } from '@/lib/audit'
import type { RateUnit } from '@/types/db'

export const dynamic = 'force-dynamic'

/**
 * Turn approved weeks into an invoice for the vendor.
 *
 * ORG-ONLY, and that is not a formality: this handler reads `bill_rate` out of
 * `employee_assignments`, which is the number the whole of 022 exists to keep
 * away from employees. `apiRequireOrg()` is the only thing standing between a
 * session and that column, because the service role is not used here — the
 * caller's own client is, so RLS applies underneath the guard as well.
 *
 * FIVE THINGS ARE CHECKED, and each one is a different way of getting a wrong
 * invoice rather than a failed one:
 *
 *   1. Every week is APPROVED. Billing an unreviewed week bills hours nobody
 *      has agreed to.
 *   2. Every week is UNBILLED. `timesheets.invoice_id` plus its unique index
 *      (024) is the real guarantee; this is the friendly half.
 *   3. Every week belongs to the SAME VENDOR. An invoice goes to one company.
 *   4. Every week has an ASSIGNMENT with a bill rate. No rate, no line, and
 *      saying so beats inventing a zero.
 *   5. Nothing crosses the tenant boundary — enforced by RLS, restated by the
 *      explicit filter, and made structurally impossible by 018's composite
 *      foreign keys.
 *
 * ORDER MATTERS AT THE END. The invoice is inserted first, then the timesheets
 * are stamped with its id. If the stamp fails the invoice is DELETED, because
 * an invoice whose weeks are still marked billable is one that will be raised
 * twice — and a vendor billed twice is worse than an org that has to click
 * Generate again.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const input = await parseBody(request, invoiceFromTimesheetsSchema)
  const supabase = await createSupabaseServerClient()

  // Deduplicated: the same id twice would otherwise bill the same week twice on
  // the same invoice, and the "already invoiced" check below would not catch it
  // because neither copy is stamped yet.
  const ids = Array.from(new Set(input.timesheetIds))

  const { data: sheets, error: loadError } = await supabase
    .from('timesheets')
    .select(
      'id, code, week_start, week_end, status, billable_hours, invoice_id, vendor_id, client_id, assignment_id, employee:profiles!timesheets_employee_id_fkey(full_name, email)'
    )
    .in('id', ids)
    .eq('tenant_id', ctx.tenantId)

  if (loadError) return jsonError(friendlyDbError(loadError), 400)

  const rows = (sheets ?? []) as unknown as Array<{
    id: string
    code: string
    week_start: string
    week_end: string
    status: string
    billable_hours: number | string
    invoice_id: string | null
    vendor_id: string | null
    client_id: string | null
    assignment_id: string | null
    employee: { full_name: string | null; email: string | null } | null
  }>

  if (rows.length !== ids.length) {
    return jsonError('One of those timesheets could not be found.', 404)
  }

  const notApproved = rows.filter((row) => row.status !== 'approved')
  if (notApproved.length) {
    return jsonError(
      `${notApproved.map((r) => r.code).join(', ')} ${notApproved.length === 1 ? 'has' : 'have'} not been approved yet.`,
      409
    )
  }

  const alreadyBilled = rows.filter((row) => row.invoice_id)
  if (alreadyBilled.length) {
    return jsonError(
      `${alreadyBilled.map((r) => r.code).join(', ')} ${alreadyBilled.length === 1 ? 'has' : 'have'} already been invoiced.`,
      409
    )
  }

  const vendorIds = new Set(rows.map((row) => row.vendor_id))
  if (vendorIds.size > 1) {
    return jsonError(
      'Those timesheets are for different vendors. An invoice goes to one vendor, so generate one per vendor.',
      400
    )
  }

  const vendorId = rows[0].vendor_id
  if (!vendorId) {
    return jsonError(
      'Those timesheets are not linked to a vendor, so there is nobody to invoice. Set the placement on the employee first.',
      400
    )
  }

  const missingAssignment = rows.filter((row) => !row.assignment_id)
  if (missingAssignment.length) {
    return jsonError(
      `${missingAssignment.map((r) => r.code).join(', ')} ${missingAssignment.length === 1 ? 'has' : 'have'} no placement, so there is no rate to bill at.`,
      400
    )
  }

  /*
   * The rates. Read per assignment rather than per timesheet, because several
   * weeks of the same placement share one rate and a person can legitimately be
   * on two placements with the same vendor at different rates.
   */
  const assignmentIds = Array.from(new Set(rows.map((row) => row.assignment_id!)))
  const { data: assignments, error: rateError } = await supabase
    .from('employee_assignments')
    .select('id, bill_rate, bill_currency, rate_unit')
    .in('id', assignmentIds)
    .eq('tenant_id', ctx.tenantId)

  if (rateError) return jsonError(friendlyDbError(rateError), 400)

  const rateById = new Map(
    (assignments ?? []).map((row) => [
      row.id as string,
      {
        billRate: row.bill_rate == null ? null : Number(row.bill_rate),
        currency: row.bill_currency as string,
        unit: row.rate_unit as RateUnit,
      },
    ])
  )

  const unrated = rows.filter((row) => rateById.get(row.assignment_id!)?.billRate == null)
  if (unrated.length) {
    return jsonError(
      `There is no bill rate on the placement behind ${unrated.map((r) => r.code).join(', ')}. Add one before invoicing.`,
      400
    )
  }

  // One invoice, one currency. Mixed currencies would need a conversion rate
  // this product does not hold, and summing them regardless would be a lie.
  const currencies = new Set(assignmentIds.map((id) => rateById.get(id)!.currency))
  if (currencies.size > 1) {
    return jsonError(
      'Those placements bill in different currencies, so they cannot go on one invoice.',
      400
    )
  }
  const currency = rateById.get(assignmentIds[0])!.currency

  /*
   * Lines, grouped by assignment so each group is billed at its own rate. A
   * week with no billable hours produces no line at all — see `billLines`.
   */
  const items = assignmentIds.flatMap((assignmentId) => {
    const rate = rateById.get(assignmentId)!
    const weeks: BillableWeek[] = rows
      .filter((row) => row.assignment_id === assignmentId)
      .map((row) => ({
        id: row.id,
        code: row.code,
        weekStart: row.week_start,
        weekEnd: row.week_end,
        billableHours: Number(row.billable_hours),
        employeeName: row.employee?.full_name || row.employee?.email || 'Employee',
      }))
    return billLines(weeks, rate.billRate!, rate.unit)
  })

  if (!items.length) {
    return jsonError('Those weeks have no billable hours, so there is nothing to invoice.', 400)
  }

  // Who is being billed, and on what terms.
  const { data: vendor } = await supabase
    .from('vendors')
    .select('id, name, email, address, payment_terms_days')
    .eq('id', vendorId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle()

  if (!vendor) return jsonError('That vendor could not be found.', 404)

  const address = (vendor.address ?? {}) as Record<string, string | undefined>
  const issueDate = input.issueDate ?? new Date().toISOString().slice(0, 10)
  const dueDate =
    input.dueDate ?? addDays(issueDate, Number(vendor.payment_terms_days ?? 30))

  // Advisory, exactly as in the manual create path: `UNIQUE(tenant_id,
  // invoice_number)` is the guarantee, and a clash comes back as a 409 the
  // caller retries.
  let invoiceNumber = input.invoiceNumber
  if (!invoiceNumber) {
    const { data: existing } = await supabase
      .from('invoices')
      .select('invoice_number')
      .eq('tenant_id', ctx.tenantId)
      .order('created_at', { ascending: false })
      .limit(200)
    invoiceNumber = suggestInvoiceNumber((existing ?? []).map((row) => row.invoice_number))
  }

  const totals = computeTotals(items, input.taxPercent, 0)
  const periodStart = rows.reduce((min, r) => (r.week_start < min ? r.week_start : min), rows[0].week_start)
  const periodEnd = rows.reduce((max, r) => (r.week_end > max ? r.week_end : max), rows[0].week_end)

  const { data: invoice, error: insertError } = await supabase
    .from('invoices')
    .insert({
      tenant_id: ctx.tenantId,
      vendor_id: vendorId,
      client_id: rows[0].client_id,
      period_start: periodStart,
      period_end: periodEnd,
      invoice_number: invoiceNumber,
      bill_to: {
        name: vendor.name,
        email: vendor.email ?? undefined,
        address: [address.line1, address.line2, address.city, address.state, address.postalCode, address.country]
          .filter(Boolean)
          .join(', ') || undefined,
      },
      items: normalizeItems(items),
      currency,
      subtotal: totals.subtotal,
      tax_percent: input.taxPercent,
      total: totals.total,
      amount_paid: 0,
      balance_due: totals.balanceDue,
      status: 'draft',
      issue_date: issueDate,
      due_date: dueDate,
      notes: input.notes,
      created_by: ctx.userId,
    })
    .select('id, invoice_number')
    .single()

  if (insertError) {
    if (insertError.code === '23505') {
      return jsonError('You already have an invoice with that number.', 409)
    }
    return jsonError(friendlyDbError(insertError), 400)
  }

  /*
   * Stamp the weeks as billed. `.is('invoice_id', null)` makes this the atomic
   * claim: two people generating at once, the second update matches no rows and
   * we roll the duplicate invoice back rather than bill the vendor twice.
   */
  const { data: stamped, error: stampError } = await supabase
    .from('timesheets')
    .update({ invoice_id: invoice.id, invoiced_at: new Date().toISOString() })
    .in('id', ids)
    .eq('tenant_id', ctx.tenantId)
    .is('invoice_id', null)
    .select('id')

  if (stampError || (stamped ?? []).length !== ids.length) {
    await supabase.from('invoices').delete().eq('id', invoice.id).eq('tenant_id', ctx.tenantId)
    console.error('[invoices/from-timesheets] rolled back', stampError?.message)
    return jsonError(
      'Those timesheets were invoiced by someone else a moment ago. Reload and try again.',
      409
    )
  }

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'invoice.generated_from_timesheets',
    entity: 'invoices',
    entityId: invoice.id,
    meta: {
      invoiceNumber: invoice.invoice_number,
      total: totals.total,
      currency,
      timesheets: rows.map((row) => row.code),
    },
    request,
  })

  return jsonOk({ id: invoice.id, invoiceNumber: invoice.invoice_number, total: totals.total }, 201)
}

export const POST = withErrorHandler(handlePOST)
