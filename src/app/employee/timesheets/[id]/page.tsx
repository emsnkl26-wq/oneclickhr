import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireEmployee } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { TimesheetEditor } from './timesheet-editor'
import type { TimesheetStatus } from '@/types/db'

export const metadata: Metadata = { title: 'Timesheet' }
export const dynamic = 'force-dynamic'

interface EntryRow {
  id: string
  project_id: string | null
  task_name: string | null
  billable: boolean
  position: number
  hours_sun: number
  hours_mon: number
  hours_tue: number
  hours_wed: number
  hours_thu: number
  hours_fri: number
  hours_sat: number
}

/**
 * One week, editable while it is open or rejected and read-only afterwards.
 *
 * The project list is the employee's ASSIGNMENTS, not the tenant's projects:
 * the save handler re-proves every project id against the same assignments, so
 * offering anything wider here would only produce a form that fails on submit.
 */
export default async function EmployeeTimesheetPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireEmployee()
  const { id } = await params
  const supabase = await createSupabaseServerClient()

  // RLS limits an employee to their own sheets, so someone else's id is a 404.
  const { data: sheet } = await supabase
    .from('timesheets')
    .select(
      'id, code, week_start, week_end, status, total_hours, billable_hours, non_billable_hours, comments, attachment_url, attachment_name, review_note, reviewed_at, submitted_at'
    )
    .eq('id', id)
    .maybeSingle()

  if (!sheet) notFound()

  const [{ data: entries }, { data: assignments }] = await Promise.all([
    supabase
      .from('timesheet_entries')
      .select(
        'id, project_id, task_name, billable, position, hours_sun, hours_mon, hours_tue, hours_wed, hours_thu, hours_fri, hours_sat'
      )
      .eq('timesheet_id', id)
      .order('position'),
    supabase
      .from('project_assignments')
      .select('project:projects(id, code, name, client_name, status)')
      .order('created_at', { ascending: false }),
  ])

  const projects = (
    (assignments ?? []) as unknown as Array<{
      project: { id: string; code: string; name: string; client_name: string | null; status: string } | null
    }>
  )
    .map((row) => row.project)
    .filter(Boolean)
    // Only ACTIVE projects are offered — plus any a saved line already points
    // at. Without that second clause, reopening an old week whose project has
    // since been closed would silently blank that line's project.
    .filter(
      (project) =>
        project!.status === 'active' ||
        (entries ?? []).some((entry) => entry.project_id === project!.id)
    ) as Array<{ id: string; code: string; name: string; client_name: string | null }>

  return (
    <TimesheetEditor
      timesheet={{
        id: sheet.id,
        code: sheet.code,
        weekStart: sheet.week_start,
        weekEnd: sheet.week_end,
        status: sheet.status as TimesheetStatus,
        comments: sheet.comments ?? '',
        attachmentKey: sheet.attachment_url,
        attachmentName: sheet.attachment_name,
        reviewNote: sheet.review_note,
      }}
      entries={((entries ?? []) as unknown as EntryRow[]).map((entry) => ({
        key: entry.id,
        projectId: entry.project_id ?? '',
        taskName: entry.task_name ?? '',
        billable: entry.billable,
        hours: [
          Number(entry.hours_sun), Number(entry.hours_mon), Number(entry.hours_tue),
          Number(entry.hours_wed), Number(entry.hours_thu), Number(entry.hours_fri),
          Number(entry.hours_sat),
        ],
      }))}
      projects={projects.map((project) => ({
        id: project.id,
        code: project.code,
        name: project.name,
        clientName: project.client_name,
      }))}
    />
  )
}
