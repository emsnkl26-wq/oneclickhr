import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  ArrowLeft, ArrowRight, ClipboardList, Download, FileText, FileSignature, FilePlus2,
  Eye, Briefcase, Timer, Building2,
} from 'lucide-react'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader, StatCard, StatusChip, EmptyState } from '@/components/ui/patterns'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/primitives'
import {
  ExperienceSection, EducationSection, SkillsSection,
  type ExperienceItem, type EducationItem,
} from '@/components/profile/profile-sections'
import { formatLocal, todayIn, formatPeriod } from '@/lib/time'
import { initials, formatHours, cn } from '@/lib/utils'
import { DOCUMENT_TYPE_LABELS } from '@/lib/document-templates'
import { EMPLOYEE_LOGIN_PATH } from '@/lib/routes'
import { appUrl } from '@/lib/env'
import { EmployeeEditForm } from './employee-edit-form'
import { SignInDetails } from './sign-in-details'
import { GenerateInvoiceButton } from '@/components/invoice/generate-invoice-button'
import type { GeneratedDocumentType, TimesheetStatus } from '@/types/db'

export const metadata: Metadata = { title: 'Employee' }
export const dynamic = 'force-dynamic'

export default async function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const ctx = await requireOrg()
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const tz = ctx.tenant.timezone

  // RLS scopes this to the tenant, so an id from another workspace is simply a
  // 404 — the isolation is the lookup, not an extra branch.
  const { data: employee, error: employeeError } = await supabase
    .from('profiles')
    .select(
      'id, full_name, email, phone, photo_url, employee_code, designation, department_id, date_of_joining, timezone, is_active, must_change_password, created_at, skills, tracking_mode'
    )
    .eq('id', id)
    .eq('role', 'employee')
    .maybeSingle()

  // A read that FAILED is not a record that is missing. Answering both with
  // notFound() tells someone it was deleted when the database was simply
  // unreachable, which is the one explanation they cannot act on.
  if (employeeError) {
    console.error('[org/employees/:id] load failed', employeeError)
    throw new Error('That employee could not be loaded. Please try again.')
  }

  if (!employee) notFound()

  const monthStart = `${todayIn(tz).slice(0, 7)}-01`

  const [
    { data: departments },
    { data: attendance },
    { data: leaves },
    { data: documents },
    { data: experience },
    { data: education },
    { data: letters },
    { data: assignments },
    { data: timesheets },
    { data: onboarding },
    { data: billable },
    { data: placements },
  ] = await Promise.all([
      supabase.from('departments').select('id, name').order('name'),
      supabase
        .from('attendance')
        .select('id, date, login_time, logout_time, total_hours, is_late')
        .eq('employee_id', id)
        .gte('date', monthStart)
        .order('date', { ascending: false }),
      supabase
        .from('leaves')
        .select('id, start_date, end_date, days, status, reason')
        .eq('employee_id', id)
        .order('created_at', { ascending: false })
        .limit(10),
      supabase
        .from('documents')
        .select('id, file_url, file_name, label, kind, created_at')
        .eq('employee_id', id)
        .order('created_at', { ascending: false }),
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
      supabase
        .from('generated_documents')
        .select('id, doc_type, title, file_url, file_name, created_at')
        .eq('employee_id', id)
        .order('created_at', { ascending: false }),
      supabase
        .from('project_assignments')
        .select('project:projects(id, code, name, client_name, status)')
        .eq('employee_id', id),
      supabase
        .from('timesheets')
        .select('id, code, week_start, week_end, status, total_hours')
        .eq('employee_id', id)
        .order('week_start', { ascending: false })
        .limit(8),
      /*
       * The onboarding this account came from, if it is still open. This is the
       * page an admin lands on when they finally have the missing paperwork, so
       * it is where the way back into the form belongs.
       */
      supabase
        .from('employee_onboarding')
        .select('id, status, submitted_at')
        .eq('employee_profile_id', id)
        // 'completed' is included so an admin can reopen the full form and
        // correct somebody's details later (M2 #1) — the banner below switches
        // to a quiet 'edit' affordance in that case rather than an alert.
        .in('status', ['invited', 'submitted', 'completed'])
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      /*
       * Weeks this person has worked that are approved and NOT yet billed —
       * exactly what the "Generate invoice" button offers. Filtering here rather
       * than in the browser means the dialog cannot show a week that was
       * invoiced a minute ago in another tab.
       */
      supabase
        .from('timesheets')
        .select('id, code, week_start, week_end, billable_hours, vendor_id, vendor:vendors(name)')
        .eq('employee_id', id)
        .eq('status', 'approved')
        .is('invoice_id', null)
        .order('week_start', { ascending: false })
        .limit(60),
      // Placements, so the page can say who this person works for and through.
      supabase
        .from('employee_assignments')
        .select(
          'id, bill_rate, bill_currency, pay_rate, pay_currency, rate_unit, start_date, end_date, is_primary, status, vendor:vendors(id, name), client:clients(id, name)'
        )
        .eq('employee_id', id)
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: false }),
    ])

  const records = attendance ?? []
  const totalHours = records.reduce((sum, r) => sum + Number(r.total_hours ?? 0), 0)
  const lateCount = records.filter((r) => r.is_late).length

  const skills = Array.isArray(employee.skills) ? (employee.skills as string[]) : []

  const projects = (
    (assignments ?? []) as unknown as Array<{
      project: { id: string; code: string; name: string; client_name: string | null; status: string } | null
    }>
  )
    .map((row) => row.project)
    .filter(Boolean) as Array<{
    id: string
    code: string
    name: string
    client_name: string | null
    status: string
  }>

  const generated = (letters ?? []) as unknown as Array<{
    id: string
    doc_type: GeneratedDocumentType
    title: string
    file_url: string
    file_name: string | null
    created_at: string
  }>

  const sheets = (timesheets ?? []) as unknown as Array<{
    id: string
    code: string
    week_start: string
    week_end: string
    status: TimesheetStatus
    total_hours: number
  }>

  const employeeName = employee.full_name || employee.email || 'Employee'

  const billableWeeks = ((billable ?? []) as unknown as Array<{
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

  const placementRows = ((placements ?? []) as unknown as Array<{
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

  return (
    <div className="space-y-6">
      <PageHeader
        title={employee.full_name || employee.email || 'Employee'}
        description={employee.designation || 'No designation set'}
        actions={
          <>
            <GenerateInvoiceButton
              timesheets={billableWeeks}
              employeeName={employee.full_name || employee.email || 'this employee'}
            />
            <Button asChild>
              <Link href={`/org/letters/new?employee=${employee.id}`}>
                <FilePlus2 />
                Generate document
              </Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/org/employees">
                <ArrowLeft />
                All employees
              </Link>
            </Button>
          </>
        }
      />

      {onboarding ? (
        /*
          Three states, three tones. A submitted form is an ACTION waiting on
          somebody (green, prominent); an unfinished one is a gap (amber); a
          completed one is neither — just the way back into the full record, so
          it gets the same neutral treatment as any other card on the page.
        */
        <div
          className={cn(
            'flex flex-col gap-4 rounded-xl border p-5 sm:flex-row sm:items-center',
            onboarding.status === 'submitted'
              ? 'border-emerald-200 bg-emerald-50/60'
              : onboarding.status === 'completed'
                ? 'border-line bg-card shadow-sm'
                : 'border-amber-200 bg-amber-50/60'
          )}
        >
          <ClipboardList
            className={cn(
              'size-5 shrink-0',
              onboarding.status === 'submitted'
                ? 'text-emerald-600'
                : onboarding.status === 'completed'
                  ? 'text-brand-600'
                  : 'text-amber-600'
            )}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              {onboarding.status === 'submitted'
                ? 'Their onboarding details are ready for review'
                : onboarding.status === 'completed'
                  ? 'Full employee details'
                  : 'Onboarding is not finished'}
            </p>
            <p className="mt-0.5 text-sm leading-relaxed text-ink-muted">
              {onboarding.status === 'submitted'
                ? 'They have filled in their own details. Approving is what writes them onto this profile.'
                : onboarding.status === 'completed'
                  ? 'Address, work authorization, compensation, bank details and documents. Editing here updates their profile directly.'
                  : 'They can sign in and complete their own details, or you can fill them in here. Until it is approved they are not counted as an active member of the team.'}
            </p>
          </div>
          <Button asChild variant={onboarding.status === 'submitted' ? 'default' : 'secondary'}>
            <Link href={`/org/employees/onboard/${onboarding.id}`}>
              {onboarding.status === 'submitted'
                ? 'Review and approve'
                : onboarding.status === 'completed'
                  ? 'Edit full details'
                  : 'Open onboarding form'}
              <ArrowRight />
            </Link>
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-line bg-card p-5 shadow-sm">
        <Avatar className="size-16">
          {employee.photo_url ? (
            <AvatarImage
              src={`/api/files/view?key=${encodeURIComponent(employee.photo_url)}`}
              alt=""
            />
          ) : null}
          <AvatarFallback className="text-lg">
            {initials(employee.full_name, employee.email)}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[17px] font-semibold">{employee.full_name || 'Unnamed'}</p>
            {!employee.is_active ? (
              <StatusChip status="inactive" />
            ) : onboarding ? (
              <StatusChip status="onboarding" label="Onboarding" tone="warning" />
            ) : (
              <StatusChip status="active" />
            )}
            {employee.must_change_password ? (
              <StatusChip status="pending" label="Has not set a password yet" />
            ) : null}
          </div>
          <p className="mt-0.5 text-sm text-ink-muted">{employee.email}</p>
          <p className="tabular mt-0.5 text-sm text-ink-muted">
            {employee.employee_code ? `${employee.employee_code} · ` : ''}
            {employee.phone || 'No phone'}
          </p>
        </div>

        <div className="text-right text-sm text-ink-muted">
          <p>Joined {employee.date_of_joining || formatLocal(employee.created_at, tz, 'd MMM yyyy')}</p>
          <p className="mt-0.5">{employee.timezone}</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Days present this month" value={records.length} accent />
        <StatCard label="Hours this month" value={formatHours(totalHours)} />
        <StatCard label="Late logins" value={lateCount} />
        <StatCard
          label="Active projects"
          value={projects.filter((project) => project.status === 'active').length}
          icon={Briefcase}
          tone="orange"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <EmployeeEditForm
          employee={{
            id: employee.id,
            fullName: employee.full_name ?? '',
            phone: employee.phone ?? '',
            employeeCode: employee.employee_code ?? '',
            designation: employee.designation ?? '',
            departmentId: employee.department_id ?? '',
            dateOfJoining: employee.date_of_joining ?? '',
            timezone: employee.timezone,
            isActive: employee.is_active,
            trackingMode: employee.tracking_mode ?? '',
          }}
          departments={departments ?? []}
        />

        <div className="space-y-5">
          {employee.email ? (
            <SignInDetails
              employeeId={employee.id}
              email={employee.email}
              loginUrl={`${appUrl()}${EMPLOYEE_LOGIN_PATH}`}
              mustChangePassword={employee.must_change_password}
            />
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Attendance this month</CardTitle>
            </CardHeader>
            {records.length === 0 ? (
              <EmptyState title="No attendance recorded" description="Nothing logged this month." />
            ) : (
              <ul className="scrollbar-thin max-h-72 divide-y divide-line overflow-y-auto">
                {records.map((record) => (
                  <li key={record.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                    <span className="tabular w-24 shrink-0">{record.date}</span>
                    <span className="tabular flex-1 text-ink-muted">
                      {formatLocal(record.login_time, tz, 'HH:mm')}
                      {record.logout_time
                        ? ` – ${formatLocal(record.logout_time, tz, 'HH:mm')}`
                        : ' – active'}
                    </span>
                    {record.is_late ? <StatusChip status="late" label="Late" /> : null}
                    <span className="tabular w-16 shrink-0 text-right font-medium">
                      {formatHours(record.total_hours)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent leave</CardTitle>
            </CardHeader>
            {(leaves ?? []).length === 0 ? (
              <EmptyState title="No leave requests" description="Nothing applied for yet." />
            ) : (
              <ul className="divide-y divide-line">
                {(leaves ?? []).map((leave) => (
                  <li key={leave.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                    <span className="tabular flex-1">
                      {leave.start_date} → {leave.end_date}
                    </span>
                    <span className="tabular text-ink-muted">{leave.days}d</span>
                    <StatusChip status={leave.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Documents</CardTitle>
            </CardHeader>
            {(documents ?? []).length === 0 ? (
              <EmptyState
                icon={FileText}
                title="No documents"
                description="Files uploaded for this person appear here."
              />
            ) : (
              <ul className="divide-y divide-line">
                {(documents ?? []).map((doc) => (
                  <li key={doc.id} className="flex items-center gap-3 px-5 py-2.5">
                    <FileText className="size-4 shrink-0 text-ink-muted" aria-hidden />
                    {/* The label says what the file IS; the file name is
                        whatever their scanner called it, so it drops to a
                        subtitle once there is something better to lead with. */}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">
                        {doc.label || doc.file_name || 'Untitled'}
                      </span>
                      {doc.label && doc.file_name ? (
                        <span className="block truncate text-xs text-ink-muted">
                          {doc.file_name}
                        </span>
                      ) : null}
                    </span>
                    <Button asChild size="icon" variant="ghost" aria-label="Download">
                      <a
                        href={`/api/files/view?key=${encodeURIComponent(doc.file_url)}&download=${encodeURIComponent(
                          doc.file_name || 'document'
                        )}`}
                      >
                        <Download />
                      </a>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {/*
        Everything the employee maintains about themselves, read-only.

        These are the SAME components the employee edits on their own profile,
        with `readOnly` set — so what an org admin reads here is exactly what the
        person entered, with no second renderer to drift out of step.
      */}
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <ExperienceSection items={(experience ?? []) as unknown as ExperienceItem[]} readOnly />
          <EducationSection items={(education ?? []) as unknown as EducationItem[]} readOnly />
          <SkillsSection skills={skills} readOnly />
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Generated documents</CardTitle>
              <Button asChild size="sm" variant="secondary">
                <Link href={`/org/letters/new?employee=${employee.id}`}>
                  <FilePlus2 />
                  Generate
                </Link>
              </Button>
            </CardHeader>
            {generated.length === 0 ? (
              <EmptyState
                icon={FileSignature}
                title="No letters issued"
                description="Offer letters and agreements generated for this person appear here."
              />
            ) : (
              <ul className="divide-y divide-line">
                {generated.map((letter) => (
                  <li key={letter.id} className="flex items-center gap-3 px-5 py-3">
                    <FileSignature className="size-4 shrink-0 text-ink-muted" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{letter.title}</p>
                      <p className="truncate text-xs text-ink-muted">
                        {DOCUMENT_TYPE_LABELS[letter.doc_type]} ·{' '}
                        {formatLocal(letter.created_at, tz, 'd MMM yyyy')}
                      </p>
                    </div>
                    <Button asChild size="icon" variant="ghost" aria-label="Preview">
                      <a
                        href={`/api/files/view?key=${encodeURIComponent(letter.file_url)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Eye />
                      </a>
                    </Button>
                    <Button asChild size="icon" variant="ghost" aria-label="Download">
                      <a
                        href={`/api/files/view?key=${encodeURIComponent(letter.file_url)}&download=${encodeURIComponent(
                          letter.file_name || 'document.pdf'
                        )}`}
                      >
                        <Download />
                      </a>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Placements</CardTitle>
            </CardHeader>
            {placementRows.length === 0 ? (
              <EmptyState
                icon={Building2}
                title="No placement yet"
                description="Set who this person works through and for, so their timesheets can be billed."
                action={
                  <Button asChild size="sm" variant="secondary">
                    <Link href={`/org/placements?employee=${employee.id}`}>Add a placement</Link>
                  </Button>
                }
              />
            ) : (
              <ul className="divide-y divide-line">
                {placementRows.map((row) => (
                  <li key={row.id} className="px-5 py-3.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{row.vendorName ?? 'Vendor'}</p>
                      {row.clientName ? (
                        <>
                          <ArrowRight className="size-3.5 text-ink-muted" aria-hidden />
                          <p className="text-sm">{row.clientName}</p>
                        </>
                      ) : null}
                      {row.isPrimary ? <StatusChip status="info" tone="info" label="Primary" /> : null}
                      {row.status === 'ended' ? <StatusChip status="ended" label="Ended" /> : null}
                    </div>
                    {/*
                      Both rates, side by side, and ONLY on this org-side page.
                      The employee's own screens never receive the bill figure —
                      it does not exist in the view they read. See 022.
                    */}
                    <p className="tabular mt-1 text-[13px] text-ink-muted">
                      {row.billRate != null
                        ? `Billed ${row.billCurrency} ${row.billRate} / ${row.rateUnit}`
                        : 'No bill rate set'}
                      {' · '}
                      {row.payRate != null
                        ? `pays ${row.payCurrency} ${row.payRate} / ${row.rateUnit}`
                        : 'no pay rate set'}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Projects</CardTitle>
            </CardHeader>
            {projects.length === 0 ? (
              <EmptyState
                icon={Briefcase}
                title="Not on any project"
                description="Assign this person to a project so they can log hours."
              />
            ) : (
              <ul className="divide-y divide-line">
                {projects.map((project) => (
                  <li key={project.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/org/projects/${project.id}`}
                        className="block truncate text-sm font-medium hover:underline"
                      >
                        {project.name}
                      </Link>
                      <p className="tabular truncate text-xs text-ink-muted">
                        {project.code}
                        {project.client_name ? ` · ${project.client_name}` : ''}
                      </p>
                    </div>
                    <StatusChip status={project.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent timesheets</CardTitle>
            </CardHeader>
            {sheets.length === 0 ? (
              <EmptyState
                icon={Timer}
                title="No timesheets"
                description="Weeks this person files will appear here."
              />
            ) : (
              <ul className="divide-y divide-line">
                {sheets.map((sheet) => (
                  <li key={sheet.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/org/timesheets/${sheet.id}`}
                        className="tabular block truncate text-sm font-medium hover:underline"
                      >
                        {formatPeriod(sheet.week_start, sheet.week_end)}
                      </Link>
                      <p className="tabular truncate text-xs text-ink-muted">{sheet.code}</p>
                    </div>
                    <StatusChip status={sheet.status} />
                    <span className="tabular w-14 shrink-0 text-right text-sm font-medium">
                      {Number(sheet.total_hours)}h
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
