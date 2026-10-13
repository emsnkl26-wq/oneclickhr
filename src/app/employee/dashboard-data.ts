import 'server-only'

/**
 * The employee dashboard's reads, one loader per INDEPENDENT region.
 *
 * Same reasoning as the org dashboard's companion file, plus one problem of its
 * own that mattered more: this page opened with
 *
 *     const onboarding = await loadEmployeeOnboarding(ctx)
 *     const [ …ten queries… ] = await Promise.all([…])
 *
 * — a SERIAL round trip in front of every other read on the page. The onboarding
 * lookup decided whether the page led with a form request, so the ten queries
 * behind it could not start until it came back, and the employee waited for the
 * sum of two trips before seeing anything at all. That lookup is null for
 * almost everybody, almost always.
 *
 * Streaming dissolves the dependency rather than optimizing it: the banner is
 * its own region now, so it no longer gates anything, and the clock-in control —
 * the single thing most employees open this page to use — paints without
 * waiting on tasks, notifications, placements or three timesheet counts.
 *
 * Every loader is `cache()`d and request-scoped. The month's attendance rows are
 * read once and serve both the stat cards and the "recent attendance" list.
 */
import { cache } from 'react'
import { requireEmployee } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { loadEmployeeOnboarding } from '@/lib/employee-onboarding'
import { todayIn } from '@/lib/time'

/**
 * The dates every region measures against, computed once — so a page rendered
 * across midnight cannot put two different "today"s on the same screen.
 */
export const employeeWindow = cache(async () => {
  const ctx = await requireEmployee()
  const tz = ctx.tenant.timezone
  const today = todayIn(tz)
  return { ctx, tz, today, monthStart: `${today.slice(0, 7)}-01` }
})

/** Still being onboarded? Null for everybody who is finished. */
export const loadOnboardingState = cache(async () => {
  const { ctx } = await employeeWindow()
  return loadEmployeeOnboarding(ctx)
})

/*
 * Every query below is scoped to this employee BY RLS, not by the filters
 * written on it. The `.eq('employee_id', …)` on some of them is redundant — the
 * attendance/leaves policies already restrict an employee to
 * `employee_id = auth.uid()`. It stays because it makes the intent legible at
 * the call site.
 */

/**
 * The shift the clock-in control is looking at.
 *
 * Two reads, raced. A shift that crossed midnight in the org's zone is still
 * open but no longer files under "today" — see the matching comment in
 * `/api/employee/clock`. Without the second one the toggle loses track of it
 * the moment the calendar day rolls over: it reports "not clocked in" and
 * offers a fresh Clock In while the earlier shift sits open forever with no
 * control left to close it.
 */
export const loadCurrentShift = cache(async () => {
  const { today } = await employeeWindow()
  const supabase = await createSupabaseServerClient()

  const [todayRecord, openRecord] = await Promise.all([
    supabase
      .from('attendance')
      .select('id, login_time, logout_time, total_hours, is_late')
      .eq('date', today)
      .maybeSingle(),
    supabase
      .from('attendance')
      .select('id, login_time, logout_time, total_hours, is_late')
      .is('logout_time', null)
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  // The open shift wins: it is the one that still has a control attached.
  return openRecord.data ?? todayRecord.data ?? null
})

/** This month's attendance — read once, used by both the stats and the list. */
export const loadMonthAttendance = cache(async () => {
  const { monthStart } = await employeeWindow()
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('attendance')
    .select('id, date, login_time, logout_time, total_hours, is_late')
    .gte('date', monthStart)
    .order('date', { ascending: false })

  const records = (data ?? []) as Array<{
    id: string
    date: string
    // Non-null by schema (see `attendance` in src/types/db.ts): a row only
    // exists once somebody has clocked in. `formatLocal` relies on it.
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

/**
 * The four counted cards.
 *
 * All `head: true` — an index-only scan that returns no rows at all. Fetching
 * the timesheets to count them would pull an employment history's worth of
 * weeks onto a dashboard that only ever shows the number.
 */
export const loadWorkCounts = cache(async () => {
  const supabase = await createSupabaseServerClient()

  const [activeProjects, timesheets, approved, rejected] = await Promise.all([
    supabase
      .from('project_assignments')
      .select('project_id, projects!inner(status)', { count: 'exact', head: true })
      .eq('projects.status', 'active'),
    supabase.from('timesheets').select('id', { count: 'exact', head: true }),
    supabase.from('timesheets').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
    supabase.from('timesheets').select('id', { count: 'exact', head: true }).eq('status', 'rejected'),
  ])

  return {
    activeProjects: activeProjects.count ?? 0,
    timesheets: timesheets.count ?? 0,
    approved: approved.count ?? 0,
    rejected: rejected.count ?? 0,
  }
})

export const loadMyTasks = cache(async () => {
  const { ctx } = await employeeWindow()
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('task_assignees')
    .select('task_id, tasks(id, title, priority, due_date)')
    .eq('profile_id', ctx.userId)
    .limit(5)

  return (data ?? [])
    .map(
      (row) =>
        row.tasks as unknown as {
          id: string
          title: string
          priority: string
          due_date: string | null
        } | null
    )
    .filter(Boolean) as Array<{
    id: string
    title: string
    priority: string
    due_date: string | null
  }>
})

export const loadAnnouncements = cache(async () => {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('notifications')
    .select('id, title, description, created_at')
    .order('created_at', { ascending: false })
    .limit(4)

  return (data ?? []) as Array<{
    id: string
    title: string
    description: string | null
    created_at: string
  }>
})

export const loadMyLeaves = cache(async () => {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('leaves')
    .select('id, start_date, end_date, days, status')
    .order('created_at', { ascending: false })
    .limit(5)

  return (data ?? []) as Array<{
    id: string
    start_date: string
    end_date: string
    days: number
    status: string
  }>
})
