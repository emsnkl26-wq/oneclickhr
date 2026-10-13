import { Suspense } from 'react'
import type { Metadata } from 'next'
import { EmployeeDocuments, type EmployeeDocument } from './employee-documents'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { effectivePaySchedule } from '@/lib/pay-schedule'
import {
  ArrowLeft, ArrowRight, ClipboardList, Download, FileSignature, FilePlus2,
  Eye, Briefcase, Timer, Building2, Pencil, Linkedin,
} from 'lucide-react'
import { requireOrg } from '@/lib/auth/guards'
import {
  PageHeader, StatCard, StatusChip, EmptyState, Skeleton, StatCardSkeleton,
  ListCardSkeleton, FormCardSkeleton,
} from '@/components/ui/patterns'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/primitives'
import {
  ExperienceSection, EducationSection, SkillsSection,
  type ExperienceItem, type EducationItem,
} from '@/components/profile/profile-sections'
import { formatLocal, formatPeriod } from '@/lib/time'
import { initials, formatHours, cn } from '@/lib/utils'
import { DOCUMENT_TYPE_LABELS } from '@/lib/document-templates'
import { EMPLOYEE_LOGIN_PATH } from '@/lib/routes'
import { appUrl } from '@/lib/env'
import { EmployeeEditForm } from './employee-edit-form'
import { SignInDetails } from './sign-in-details'
import { EmployeeDangerZone } from './danger-zone'
import { GenerateInvoiceButton } from '@/components/invoice/generate-invoice-button'
import {
  loadAttendance, loadBackground, loadBillableWeeks, loadDepartments, loadDocuments,
  loadEmployee, loadGeneratedDocuments, loadLeaves, loadOnboarding, loadPlacements,
  loadProjects, loadTimesheets,
} from './employee-detail-data'

export const metadata: Metadata = { title: 'Employee' }
export const dynamic = 'force-dynamic'

/**
 * One person's record, STREAMED.
 *
 * The page body awaits exactly one thing — the profile — because it has to:
 * it decides `notFound()`, and it carries the name in the heading. That is a
 * primary-key read. The other twelve used to share a `Promise.all` with it and
 * therefore a finish line; each is now a region that paints on its own.
 *
 * Boundaries are drawn where the DATA splits, not where the layout does. The
 * two-column grids below each hold several independent regions, and a column
 * that is one logical stack (sign-in, attendance, leave, documents) is still
 * several boundaries, because four unrelated queries should not wait for each
 * other to show a card that is already answered.
 */
export default async function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const ctx = await requireOrg()
  const { id } = await params
  const employee = await loadEmployee(id)
  if (!employee) notFound()

  const tz = ctx.tenant.timezone
  const employeeName = employee.full_name || employee.email || 'Employee'

  return (
    <div className="space-y-6">
      <PageHeader
        title={employeeName}
        description={employee.designation || 'No designation set'}
        actions={
          <>
            {/*
              The invoice button reads up to sixty uninvoiced weeks to populate
              its dialog. It is the single most expensive thing in the header
              and nobody is blocked by its absence, so the other two controls
              render without it and it appears in place.
            */}
            <Suspense fallback={<Skeleton className="h-9 w-36 rounded-lg" />}>
              <InvoiceAction id={id} employeeName={employeeName} />
            </Suspense>
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

      {/* Absent for everybody whose onboarding is closed — no fallback. */}
      <Suspense fallback={null}>
        <OnboardingBanner id={id} />
      </Suspense>

      <Suspense fallback={<IdentityCardSkeleton />}>
        <IdentityCard id={id} tz={tz} />
      </Suspense>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Suspense
          fallback={
            <>
              <StatCardSkeleton />
              <StatCardSkeleton />
              <StatCardSkeleton />
            </>
          }
        >
          <AttendanceStats id={id} />
        </Suspense>
        <Suspense fallback={<StatCardSkeleton />}>
          <ProjectStat id={id} />
        </Suspense>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Suspense fallback={<FormCardSkeleton fields={8} />}>
          <EditForm id={id} />
        </Suspense>

        <div className="space-y-5">
          {employee.email ? (
            <SignInDetails
              employeeId={employee.id}
              email={employee.email}
              loginUrl={`${appUrl()}${EMPLOYEE_LOGIN_PATH}`}
              mustChangePassword={employee.must_change_password}
            />
          ) : null}

          <Suspense fallback={<ListCardSkeleton rows={5} />}>
            <AttendanceCard id={id} tz={tz} />
          </Suspense>

          <Suspense fallback={<ListCardSkeleton rows={4} />}>
            <LeaveCard id={id} />
          </Suspense>

          <Suspense fallback={<ListCardSkeleton rows={3} />}>
            <Documents id={id} employeeName={employeeName} />
          </Suspense>
        </div>
      </div>

      {/*
        Everything the employee maintains about themselves, read-only.

        These are the SAME components the employee edits on their own profile,
        with `readOnly` set — so what an org admin reads here is exactly what the
        person entered, with no second renderer to drift out of step.
      */}
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          {/* Experience and education come from one loader and render as one
              block; skills ride on the profile row already in hand. */}
          <Suspense
            fallback={
              <>
                <ListCardSkeleton rows={3} />
                <ListCardSkeleton rows={2} />
              </>
            }
          >
            <Background id={id} />
          </Suspense>
          <SkillsSection
            skills={Array.isArray(employee.skills) ? (employee.skills as string[]) : []}
            readOnly
          />
        </div>

        <div className="space-y-5">
          <Suspense fallback={<ListCardSkeleton rows={3} />}>
            <GeneratedDocuments id={id} tz={tz} />
          </Suspense>
          <Suspense fallback={<ListCardSkeleton rows={2} />}>
            <Placements id={id} employeeId={employee.id} />
          </Suspense>
          <Suspense fallback={<ListCardSkeleton rows={3} />}>
            <Projects id={id} />
          </Suspense>
          <Suspense fallback={<ListCardSkeleton rows={4} />}>
            <RecentTimesheets id={id} />
          </Suspense>
        </div>
      </div>

      <EmployeeDangerZone employeeId={employee.id} name={employee.full_name || null} />
    </div>
  )
}

/* ------------------------------------------------------- Streamed regions */

async function InvoiceAction({ id, employeeName }: { id: string; employeeName: string }) {
  const billableWeeks = await loadBillableWeeks(id, employeeName)
  return (
    <GenerateInvoiceButton
      timesheets={billableWeeks}
      employeeId={id}
      employeeName={employeeName}
    />
  )
}

async function OnboardingBanner({ id }: { id: string }) {
  const onboarding = await loadOnboarding(id)

  /*
   * A COMPLETED onboarding is history, not a state: the person is onboarded.
   * Only an open one (invited / submitted) makes them "Onboarding" — which is
   * also what the team list goes by, so the two pages agree.
   */
  if (!onboarding || onboarding.status === 'completed') return null

  const submitted = onboarding.status === 'submitted'

  /*
    Only while there is something to DO: a submitted form is an action waiting
    on somebody (green, prominent); an unfinished one is a gap (amber). Once
    completed, the way back into the full record is the "Edit details" button on
    the profile card below — not a card of its own.
  */
  return (
    <div
      className={cn(
        'flex flex-col gap-4 rounded-xl border p-5 sm:flex-row sm:items-center',
        submitted ? 'border-emerald-200 bg-emerald-50/60' : 'border-amber-200 bg-amber-50/60'
      )}
    >
      <ClipboardList
        className={cn('size-5 shrink-0', submitted ? 'text-emerald-600' : 'text-amber-600')}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          {submitted
            ? 'Their onboarding details are ready for review'
            : 'Onboarding is not finished'}
        </p>
        <p className="mt-0.5 text-sm leading-relaxed text-ink-muted">
          {submitted
            ? 'They have filled in their own details. Approving is what writes them onto this profile.'
            : 'They can sign in and complete their own details, or you can fill them in here. Until it is approved they are not counted as an active member of the team.'}
        </p>
      </div>
      <Button asChild variant={submitted ? 'default' : 'secondary'}>
        <Link href={`/org/employees/onboard/${onboarding.id}`}>
          {submitted ? 'Review and approve' : 'Open onboarding form'}
          <ArrowRight />
        </Link>
      </Button>
    </div>
  )
}

/**
 * Name, photo, contact details and status.
 *
 * It is a region rather than part of the page body only because the status
 * chip and the "Edit details" button need the onboarding row — one indexed
 * lookup, so this is the first thing on the page to resolve.
 */
async function IdentityCard({ id, tz }: { id: string; tz: string }) {
  const [employee, onboarding] = await Promise.all([loadEmployee(id), loadOnboarding(id)])
  if (!employee) return null

  const onboardingOpen = !!onboarding && onboarding.status !== 'completed'

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-line bg-card p-5 shadow-sm">
      <Avatar className="size-16">
        {employee.photo_url ? (
          <AvatarImage src={`/api/files/view?key=${encodeURIComponent(employee.photo_url)}`} alt="" />
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
          ) : onboardingOpen ? (
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
        {/* Only an absolute https address becomes a link — the column is plain
            text, and a relative one would navigate inside this app. */}
        {employee.linkedin_url && /^https:\/\//i.test(employee.linkedin_url) ? (
          <a
            href={employee.linkedin_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-1.5 text-sm text-brand-ink hover:underline"
          >
            <Linkedin className="size-3.5 shrink-0" aria-hidden />
            LinkedIn
          </a>
        ) : null}
      </div>

      <div className="flex flex-col items-end gap-3 text-right text-sm text-ink-muted">
        <div>
          <p>Joined {employee.date_of_joining || formatLocal(employee.created_at, tz, 'd MMM yyyy')}</p>
          <p className="mt-0.5">{employee.timezone}</p>
        </div>
        {/* Address, work authorization, compensation, bank details and
            documents live on the full onboarding record; editing it there
            updates this profile directly. */}
        {onboarding?.status === 'completed' ? (
          <Button asChild size="sm" variant="secondary">
            <Link
              href={`/org/employees/onboard/${onboarding.id}`}
              title="Address, work authorization, compensation, bank details and documents"
            >
              <Pencil />
              Edit details
            </Link>
          </Button>
        ) : null}
      </div>
    </div>
  )
}

async function AttendanceStats({ id }: { id: string }) {
  const { records, totalHours, lateCount } = await loadAttendance(id)
  return (
    <>
      <StatCard label="Days present this month" value={records.length} accent />
      <StatCard label="Hours this month" value={formatHours(totalHours)} />
      <StatCard label="Late logins" value={lateCount} />
    </>
  )
}

async function ProjectStat({ id }: { id: string }) {
  const projects = await loadProjects(id)
  return (
    <StatCard
      label="Active projects"
      value={projects.filter((project) => project.status === 'active').length}
      icon={Briefcase}
      tone="orange"
    />
  )
}

async function EditForm({ id }: { id: string }) {
  const [employee, departments] = await Promise.all([loadEmployee(id), loadDepartments()])
  if (!employee) return null

  return (
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
        linkedinUrl: employee.linkedin_url ?? '',
        isActive: employee.is_active,
        isRecruiter: !!(employee as Record<string, unknown>).is_recruiter,
        trackingMode: employee.tracking_mode ?? '',
        paySchedule: employee.pay_schedule ?? '',
        automaticPaySchedule:
          effectivePaySchedule({
            pay_frequency: employee.pay_frequency,
            country: employee.country,
          }) === 'semi_monthly'
            ? 'twice a month'
            : 'monthly',
      }}
      departments={departments}
    />
  )
}

async function AttendanceCard({ id, tz }: { id: string; tz: string }) {
  const { records } = await loadAttendance(id)

  return (
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
  )
}

async function LeaveCard({ id }: { id: string }) {
  const leaves = await loadLeaves(id)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent leave</CardTitle>
      </CardHeader>
      {leaves.length === 0 ? (
        <EmptyState title="No leave requests" description="Nothing applied for yet." />
      ) : (
        <ul className="divide-y divide-line">
          {leaves.map((leave) => (
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
  )
}

async function Documents({ id, employeeName }: { id: string; employeeName: string }) {
  const documents = await loadDocuments(id)
  return (
    <EmployeeDocuments
      employeeId={id}
      employeeName={employeeName}
      documents={documents as EmployeeDocument[]}
    />
  )
}

async function Background({ id }: { id: string }) {
  const { experience, education } = await loadBackground(id)
  return (
    <>
      <ExperienceSection items={experience as unknown as ExperienceItem[]} readOnly />
      <EducationSection items={education as unknown as EducationItem[]} readOnly />
    </>
  )
}

async function GeneratedDocuments({ id, tz }: { id: string; tz: string }) {
  const generated = await loadGeneratedDocuments(id)

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Generated documents</CardTitle>
        <Button asChild size="sm" variant="secondary">
          <Link href={`/org/letters/new?employee=${id}`}>
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
  )
}

async function Placements({ id, employeeId }: { id: string; employeeId: string }) {
  const placementRows = await loadPlacements(id)

  return (
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
              <Link href={`/org/placements?employee=${employeeId}`}>Add a placement</Link>
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
                Both rates, side by side, and ONLY on this org-side page. The
                employee's own screens never receive the bill figure — it does
                not exist in the view they read. See 022.
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
  )
}

async function Projects({ id }: { id: string }) {
  const projects = await loadProjects(id)

  return (
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
  )
}

async function RecentTimesheets({ id }: { id: string }) {
  const sheets = await loadTimesheets(id)

  return (
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
  )
}

/* --------------------------------------------------- Region-sized fallback */

/** Matches IdentityCard: avatar, three lines of detail, a right-hand column. */
function IdentityCardSkeleton() {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-line bg-card p-5 shadow-sm">
      <Skeleton className="size-16 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-64 max-w-full" />
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="flex flex-col items-end gap-2">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-4 w-24" />
      </div>
    </div>
  )
}
