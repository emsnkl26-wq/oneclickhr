import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader, StatusChip } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/primitives'
import { formatPeriod, formatLocal } from '@/lib/time'
import { initials } from '@/lib/utils'
import { TimesheetReview } from './timesheet-review'
import type { TimesheetStatus } from '@/types/db'

export const metadata: Metadata = { title: 'Timesheet review' }
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
 * One submitted week, exactly as the employee filled it in.
 *
 * The grid is the SAME component the employee edits, in read-only mode. Two
 * renderers would be two chances for the reviewer and the person being reviewed
 * to see different numbers, which on an approval screen is the one bug that
 * cannot be tolerated.
 */
export default async function OrgTimesheetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const ctx = await requireOrg()
  const { id } = await params
  const supabase = await createSupabaseServerClient()

  const { data: sheet } = await supabase
    .from('timesheets')
    .select(
      'id, code, employee_id, week_start, week_end, status, total_hours, billable_hours, non_billable_hours, comments, attachment_url, attachment_name, review_note, submitted_at, reviewed_at, employee:profiles!timesheets_employee_id_fkey(id, full_name, email, photo_url, designation)'
    )
    .eq('id', id)
    .maybeSingle()

  if (!sheet) notFound()

  const employee = sheet.employee as unknown as {
    id: string
    full_name: string | null
    email: string | null
    photo_url: string | null
    designation: string | null
  } | null

  const [{ data: entries }, { data: projects }] = await Promise.all([
    supabase
      .from('timesheet_entries')
      .select(
        'id, project_id, task_name, billable, position, hours_sun, hours_mon, hours_tue, hours_wed, hours_thu, hours_fri, hours_sat'
      )
      .eq('timesheet_id', id)
      .order('position'),
    supabase.from('projects').select('id, code, name, client_name'),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Timesheet ${sheet.code}`}
        description={formatPeriod(sheet.week_start, sheet.week_end)}
        actions={
          <>
            <StatusChip status={sheet.status as TimesheetStatus} className="self-center" />
            <Button asChild variant="secondary">
              <Link href="/org/timesheets">
                <ArrowLeft />
                All timesheets
              </Link>
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-line bg-card p-5 shadow-sm">
        <Avatar className="size-12">
          {employee?.photo_url ? (
            <AvatarImage
              src={`/api/files/view?key=${encodeURIComponent(employee.photo_url)}`}
              alt=""
            />
          ) : null}
          <AvatarFallback>{initials(employee?.full_name, employee?.email)}</AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <Link
            href={`/org/employees/${sheet.employee_id}`}
            className="text-[15px] font-semibold hover:underline"
          >
            {employee?.full_name || employee?.email || 'Employee'}
          </Link>
          <p className="mt-0.5 text-sm text-ink-muted">
            {employee?.designation || 'No designation'}
          </p>
        </div>

        <div className="flex flex-wrap gap-x-8 gap-y-2 text-right">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-ink-muted">Total</p>
            <p className="tabular text-[17px] font-bold text-brand-600">
              {Number(sheet.total_hours)}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-ink-muted">Billable</p>
            <p className="tabular text-[17px] font-semibold">{Number(sheet.billable_hours)}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-ink-muted">
              Non-billable
            </p>
            <p className="tabular text-[17px] font-semibold">
              {Number(sheet.non_billable_hours)}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-ink-muted">Submitted</p>
            <p className="text-sm">
              {sheet.submitted_at
                ? formatLocal(sheet.submitted_at, ctx.tenant.timezone, 'd MMM, HH:mm')
                : '—'}
            </p>
          </div>
        </div>
      </div>

      <TimesheetReview
        timesheet={{
          id: sheet.id,
          code: sheet.code,
          weekStart: sheet.week_start,
          status: sheet.status as TimesheetStatus,
          comments: sheet.comments,
          attachmentKey: sheet.attachment_url,
          attachmentName: sheet.attachment_name,
          reviewNote: sheet.review_note,
          reviewedAt: sheet.reviewed_at,
          employeeName: employee?.full_name || employee?.email || 'Employee',
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
        projects={(projects ?? []).map((project) => ({
          id: project.id,
          code: project.code,
          name: project.name,
          clientName: project.client_name,
        }))}
        timezone={ctx.tenant.timezone}
      />
    </div>
  )
}
