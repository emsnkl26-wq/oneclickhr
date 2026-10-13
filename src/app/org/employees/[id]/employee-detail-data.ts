import 'server-only'

/**
 * The employee record page's reads, one loader per INDEPENDENT region.
 *
 * This page was the worst offender in the app for time-to-first-paint: a single
 * profile lookup, and then a TWELVE-way `Promise.all` whose slowest member
 * decided when any of it appeared. Opening somebody's record to copy their
 * phone number meant waiting on their placements, every letter ever generated
 * for them, sixty uninvoiced weeks and their full education history.
 *
 * The profile lookup itself stays serial and stays in the page: it is a
 * primary-key read, it decides `notFound()`, and the page's identity — name,
 * photo, designation, the heading — is built from it. Everything else is a
 * region now.
 *
 * Every loader is `cache()`d ON THE EMPLOYEE ID rather than on an object, so
 * the regions that genuinely share a read share it: attendance feeds both the
 * stat cards and the month list, and project assignments feed both a stat card
 * and the projects panel. Two calls with the same id string are one query;
 * `cache()` keyed on a passed object would only have deduplicated while both
 * callers happened to hold the same reference.
 */
import { cache } from 'react'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { todayIn } from '@/lib/time'
import type { GeneratedDocumentType, TimesheetStatus } from '@/types/db'

/** The columns the record page reads. Never `*` — profiles is a wide row. */
export const EMPLOYEE_COLUMNS =
  'id, full_name, email, phone, photo_url, employee_code, designation, department_id, date_of_joining, timezone, linkedin_url, is_active, is_recruiter, must_change_password, created_at, skills, tracking_mode, pay_schedule, pay_frequency, country'

/**
 * The profile itself.
 *
 * `cache()`d because the page body needs it for the heading and `notFound()`,
 * and three regions need it again for the form, the sign-in panel and the
 * danger zone. One primary-key read serves all of them.
 *
 * RLS scopes this to the tenant, so an id from another workspace is simply
 * missing — the isolation is the lookup, not an extra branch.
 */
export const loadEmployee = cache(async (id: string) => {
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('profiles')
    .select(EMPLOYEE_COLUMNS)
    .eq('id', id)
    .eq('role', 'employee')
    .maybeSingle()

  // A read that FAILED is not a record that is missing. Answering both with
  // notFound() tells someone it was deleted when the database was simply
  // unreachable, which is the one explanation they cannot act on.
  if (error) {
    console.error('[org/employees/:id] load failed', error)
    throw new Error('That employee could not be loaded. Please try again.')
  }

  return data
})

/**
 * The onboarding this account came from, if there is one.
 *
 * 'completed' is included so an admin can reopen the full form and correct
 * somebody's details later (M2 #1) — the banner switches to a quiet 'edit'
 * affordance in that case rather than an alert.
 */
export const loadOnboarding = cache(async (id: string) => {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('employee_onboarding')
    .select('id, status, submitted_at')
    .eq('employee_profile_id', id)
    .in('status', ['invited', 'submitted', 'completed'])
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return data
})

export const loadDepartments = cache(async () => {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.from('departments').select('id, name').order('name')
  return data ?? []
})

/** This month's attendance — the stat cards and the month list share it. */
export const loadAttendance = cache(async (id: string) => {
  const ctx = await requireOrg()
  const supabase = await createSupabaseServerClient()
  const monthStart = `${todayIn(ctx.tenant.timezone).slice(0, 7)}-01`

  const { data } = await supabase
    .from('attendance')
    .select('id, date, login_time, logout_time, total_hours, is_late')
    .eq('employee_id', id)
    .gte('date', monthStart)
    .order('date', { ascending: false })

  const records = (data ?? []) as Array<{
    id: string
    date: string
    // Non-null by schema: a row only exists once somebody has clocked in.
    login_time: string
    logout_time: string | null
    total_hours: number | null
    is_late: boolean | null
  }>

  return {
    records,
    totalHours: records.reduce((sum, r) => sum + Number(r.total_hours ?? 0), 0),
    lateCount: records.filter((r) => r.is_late).length,
  }
})

export const loadLeaves = cache(async (id: string) => {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('leaves')
    .select('id, start_date, end_date, days, status, reason')
    .eq('employee_id', id)
    .order('created_at', { ascending: false })
    .limit(10)
  return (data ?? []) as Array<{
    id: string
    start_date: string
    end_date: string
    days: number
    status: string
    reason: string | null
  }>
})

export const loadDocuments = cache(async (id: string) => {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('documents')
    .select('id, file_url, file_name, label, kind, created_at')
    .eq('employee_id', id)
    .order('created_at', { ascending: false })
  return data ?? []
})

/** Experience and education — read together, rendered in the same column. */
export const loadBackground = cache(async (id: string) => {
  const supabase = await createSupabaseServerClient()

  const [experience, education] = await Promise.all([
    supabase
      .from('employee_experience')
      .select('id, company_name, role_title, start_date, end_date, is_current, summary')
      .eq('employee_id', id)
      .order('is_current', { ascending: false })
      .order('start_date', { ascending: false, nullsFirst: false }),
    supabase
      .from('employee_education')
      .select('id, institution, degree, field_of_study, completion_year')
      .eq('employee_id', id)
      .order('completion_year', { ascending: false, nullsFirst: false }),
  ])

  return { experience: experience.data ?? [], education: education.data ?? [] }
})

export const loadGeneratedDocuments = cache(async (id: string) => {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('generated_documents')
    .select('id, doc_type, title, file_url, file_name, created_at')
    .eq('employee_id', id)
    .order('created_at', { ascending: false })

  return (data ?? []) as unknown as Array<{
    id: string
    doc_type: GeneratedDocumentType
    title: string
    file_url: string
    file_name: string | null
    created_at: string
  }>
})

/** Projects, via assignments. Feeds both a stat card and the projects panel. */
export const loadProjects = cache(async (id: string) => {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('project_assignments')
    .select('project:projects(id, code, name, client_name, status)')
    .eq('employee_id', id)

  return ((data ?? []) as unknown as Array<{
    project: {
      id: string
      code: string
      name: string
      client_name: string | null
      status: string
    } | null
  }>)
    .map((row) => row.project)
    .filter(Boolean) as Array<{
    id: string
    code: string
    name: string
    client_name: string | null
    status: string
  }>
})

export const loadTimesheets = cache(async (id: string) => {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('timesheets')
    .select('id, code, week_start, week_end, status, total_hours')
    .eq('employee_id', id)
    .order('week_start', { ascending: false })
    .limit(8)

  return (data ?? []) as unknown as Array<{
    id: string
    code: string
    week_start: string
    week_end: string
    status: TimesheetStatus
    total_hours: number
  }>
})

/**
 * Weeks this person has worked that are approved and NOT yet billed — exactly
 * what the "Generate invoice" button offers. Filtering here rather than in the
 * browser means the dialog cannot show a week that was invoiced a minute ago in
 * another tab.
 */
export const loadBillableWeeks = cache(async (id: string, employeeName: string) => {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('timesheets')
    .select('id, code, week_start, week_end, billable_hours, vendor_id, vendor:vendors(name)')
    .eq('employee_id', id)
    .eq('status', 'approved')
    .is('invoice_id', null)
    .order('week_start', { ascending: false })
    .limit(60)

  return ((data ?? []) as unknown as Array<{
    id: string
    code: string
    week_start: string
    week_end: string
    billable_hours: number | string
    vendor_id: string | null
    vendor: { name: string } | null
  }>).map((row) => ({
    id: row.id,
    code: row.code,
    weekStart: row.week_start,
    weekEnd: row.week_end,
    billableHours: Number(row.billable_hours),
    vendorId: row.vendor_id,
    vendorName: row.vendor?.name ?? null,
    employeeName,
  }))
})

/** Placements, so the page can say who this person works for and through. */
export const loadPlacements = cache(async (id: string) => {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('employee_assignments')
    .select(
      'id, bill_rate, bill_currency, pay_rate, pay_currency, rate_unit, start_date, end_date, is_primary, status, vendor:vendors(id, name), client:clients(id, name)'
    )
    .eq('employee_id', id)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: false })

  return ((data ?? []) as unknown as Array<{
    id: string
    bill_rate: number | string | null
    bill_currency: string
    pay_rate: number | string | null
    pay_currency: string
    rate_unit: string
    start_date: string | null
    end_date: string | null
    is_primary: boolean
    status: string
    vendor: { id: string; name: string } | null
    client: { id: string; name: string } | null
  }>).map((row) => ({
    id: row.id,
    vendorName: row.vendor?.name ?? null,
    clientName: row.client?.name ?? null,
    billRate: row.bill_rate == null ? null : Number(row.bill_rate),
    billCurrency: row.bill_currency,
    payRate: row.pay_rate == null ? null : Number(row.pay_rate),
    payCurrency: row.pay_currency,
    rateUnit: row.rate_unit,
    startDate: row.start_date,
    endDate: row.end_date,
    isPrimary: row.is_primary,
    status: row.status,
  }))
})
