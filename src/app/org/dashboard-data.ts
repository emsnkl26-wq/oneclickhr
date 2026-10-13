import 'server-only'

/**
 * The org dashboard's reads, one exported loader per INDEPENDENT region.
 *
 * WHY THIS FILE EXISTS
 *
 * The page used to open with a single twelve-way `Promise.all`. That is the
 * right shape for twelve queries, and the wrong shape for a page: `await`ing it
 * in the component body means nothing renders until the SLOWEST of the twelve
 * comes back, so the fortnight-wide attendance scan — far and away the heaviest
 * read here — held the headcount, the money and both lists behind it. The
 * manager sat on a full-page skeleton waiting for a chart they had not scrolled
 * to yet.
 *
 * Splitting the page into Suspense regions fixes that only if each region can
 * start its own reads. Hence one loader per region: the page renders
 * immediately, every region's queries are in flight by the end of the first
 * tick (React begins all Suspense children concurrently — they do NOT run in
 * series), and each card paints the moment its own data lands.
 *
 * WHY EVERY LOADER IS `cache()`d
 *
 * Regions legitimately overlap. `totalEmployees` is the headline card, the
 * denominator of the attendance gauge and the reference line on the trend
 * chart; three regions ask for it and exactly one query is issued. Without
 * `cache()` the split would have TRADED a slow first paint for more database
 * load, which is not a trade worth making. `cache()` is request-scoped, so
 * nothing here is ever shared between two users.
 *
 * The queries themselves are unchanged from the single-batch version — same
 * `head: true` counts, same single range scan for the fortnight, same embedded
 * employee rows rather than a follow-up `.in()`. See the notes at each one.
 */
import { cache } from 'react'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { todayIn, addDays } from '@/lib/time'
import { monthRange } from '@/lib/expenses'

/** How far back the two plots look. Two weeks reads as "recently" to a manager. */
export const TREND_DAYS = 14

/** How far ahead the visa card counts as "upcoming". */
const VISA_HORIZON_DAYS = 120

/**
 * The dates every region measures against, computed ONCE.
 *
 * Shared deliberately rather than recomputed per region: `todayIn(tz)` reads
 * the wall clock, and a page that rendered either side of midnight would
 * otherwise put two different "today"s on the same screen — the headline card
 * counting one day and the trend chart ending on another.
 */
export const dashboardWindow = cache(async () => {
  const ctx = await requireOrg()
  const tz = ctx.tenant.timezone
  const today = todayIn(tz)
  const thisMonth = today.slice(0, 7)
  const { from: monthFrom, to: monthTo } = monthRange(thisMonth)

  return {
    ctx,
    tz,
    today,
    thisMonth,
    monthFrom,
    monthTo,
    trendStart: addDays(today, -(TREND_DAYS - 1)),
    visaHorizon: addDays(today, VISA_HORIZON_DAYS),
  }
})

/** PostgREST returns a one-to-one embed as an object, or null when unmatched. */
export type EmbeddedPerson = {
  full_name: string | null
  email: string | null
  photo_url?: string | null
} | null

export const displayName = (person: EmbeddedPerson) =>
  person?.full_name || person?.email || 'Employee'

/*
 * Every query below runs through the USER-SCOPED client, so RLS scopes each one
 * to this tenant automatically. The explicit `.eq('tenant_id', …)` is absent on
 * purpose — adding it here would suggest the isolation depends on remembering
 * to write it, and on this client it does not.
 */

/**
 * Headcount and who is in today.
 *
 * Both are `head: true` counts — an index-only scan each, no rows crossing the
 * wire. They are loaded together because every region that wants one wants the
 * other (the card shows the ratio, the gauge draws it).
 */
export const loadHeadcount = cache(async () => {
  const { today } = await dashboardWindow()
  const supabase = await createSupabaseServerClient()

  const [employees, todayOrActive] = await Promise.all([
    supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'employee')
      .eq('is_active', true),
    supabase
      .from('attendance')
      .select('id', { count: 'exact', head: true })
      .or(`date.eq.${today},logout_time.is.null`),
  ])

  const total = employees.count ?? 0
  const present = todayOrActive.count ?? 0
  return {
    total,
    present,
    rate: total ? Math.round((present / total) * 100) : 0,
  }
})

/**
 * Leave awaiting a decision: the five most recent, plus the TRUE total.
 *
 * The count comes from `count`, not `rows.length` — the rows are capped for
 * display, so counting them capped the number as well and a workspace with
 * forty pending requests reported five.
 *
 * Employee names arrive as an embedded row rather than a follow-up
 * `.in('id', …)`, which could not start until this query had finished.
 */
export const loadPendingLeaves = cache(async () => {
  const supabase = await createSupabaseServerClient()

  const { data, count } = await supabase
    .from('leaves')
    .select(
      'id, employee_id, start_date, end_date, days, reason, status, created_at, employee:profiles!leaves_employee_id_fkey(full_name, email, photo_url)',
      { count: 'exact' }
    )
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(5)

  const rows = (data ?? []) as unknown as Array<{
    id: string
    employee_id: string
    start_date: string
    end_date: string
    days: number
    reason: string
    status: string
    created_at: string
    employee: EmbeddedPerson
  }>

  return { rows, count: count ?? rows.length }
})

/**
 * Work authorizations expiring inside the horizon.
 *
 * Filtered by the index rather than in JavaScript: taking the five soonest and
 * then discarding any beyond the horizon showed an empty card to a workspace
 * whose five nearest expiries were all far out, while a nearer one existed.
 */
export const loadExpiringVisas = cache(async () => {
  const { visaHorizon } = await dashboardWindow()
  const supabase = await createSupabaseServerClient()

  const { data, count } = await supabase
    .from('work_authorizations')
    .select(
      'id, employee_id, visa_type, expiry_date, employee:profiles!work_authorizations_employee_id_fkey(full_name, email)',
      { count: 'exact' }
    )
    .lte('expiry_date', visaHorizon)
    .order('expiry_date', { ascending: true })
    .limit(5)

  const rows = (data ?? []) as unknown as Array<{
    id: string
    employee_id: string
    visa_type: string
    expiry_date: string
    employee: EmbeddedPerson
  }>

  return { rows, count: count ?? rows.length }
})

/** The three operational counts, all `head: true`. */
export const loadOperations = cache(async () => {
  const supabase = await createSupabaseServerClient()

  const [activeProjects, pendingTimesheets, openTickets] = await Promise.all([
    supabase.from('projects').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('timesheets').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
    supabase
      .from('tickets')
      .select('id', { count: 'exact', head: true })
      .in('status', ['open', 'in_progress']),
  ])

  return {
    activeProjects: activeProjects.count ?? 0,
    pendingTimesheets: pendingTimesheets.count ?? 0,
    openTickets: openTickets.count ?? 0,
  }
})

export const loadRecentHires = cache(async () => {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('profiles')
    .select('id, full_name, email, photo_url, designation, created_at')
    .eq('role', 'employee')
    .order('created_at', { ascending: false })
    .limit(5)

  return data ?? []
})

/**
 * The fortnight of attendance — the heaviest read on the page, and the reason
 * the page is split at all.
 *
 * ONE range scan on `(tenant_id, date desc)` returning two narrow columns per
 * clock-in, bucketed in memory by the caller; not fourteen count queries. A
 * thousand-person workspace is fourteen thousand two-column rows, which is
 * cheaper than fourteen round trips — but it is still the slowest thing here,
 * which is exactly why it now lives behind its own Suspense boundary instead of
 * holding the headline numbers hostage.
 */
export const loadAttendanceWindow = cache(async () => {
  const { today, trendStart } = await dashboardWindow()
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('attendance')
    .select('date, total_hours')
    .gte('date', trendStart)
    .lte('date', today)
    .limit(20000)

  return (data ?? []) as Array<{ date: string; total_hours: number | null }>
})

/**
 * This month's money. Three narrow reads, deliberately scoped to the CURRENT
 * MONTH rather than all time: "are we up or down" is a question about the
 * period you are in, and an all-time figure on a dashboard is one nobody can
 * act on.
 *
 * Payroll is derived from verified payment confirmations rather than copied
 * into `expenses` — see 033's header for why there is no second copy.
 */
export const loadMonthMoney = cache(async () => {
  const { thisMonth, monthFrom, monthTo } = await dashboardWindow()
  const supabase = await createSupabaseServerClient()

  const [expenses, payroll, invoices] = await Promise.all([
    supabase
      .from('expenses')
      .select('amount, currency, category')
      .gte('spent_on', monthFrom)
      .lte('spent_on', monthTo)
      .limit(2000),
    supabase
      .from('payment_confirmations')
      .select('amount, currency, status')
      .eq('month', Number(thisMonth.slice(5, 7)))
      .eq('year', Number(thisMonth.slice(0, 4))),
    supabase
      .from('invoices')
      .select('amount_paid, currency, status')
      .gte('issue_date', monthFrom)
      .lte('issue_date', monthTo)
      .limit(2000),
  ])

  return {
    expenses: expenses.data ?? [],
    payroll: payroll.data ?? [],
    invoices: invoices.data ?? [],
  }
})

/**
 * What the greeting counts as "waiting on you".
 *
 * Its own loader rather than a read of the two regions that own these numbers,
 * because it needs only the counts and both are already `cache()`d: the leave
 * query it shares with the list below is issued once for the pair.
 */
export const loadWaitingOnYou = cache(async () => {
  const [leaves, operations] = await Promise.all([loadPendingLeaves(), loadOperations()])
  return leaves.count + operations.pendingTimesheets
})
