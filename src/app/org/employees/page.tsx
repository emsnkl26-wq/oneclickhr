import type { Metadata } from 'next'
import Link from 'next/link'
import { UserPlus } from 'lucide-react'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import { EmployeeList, type EmployeeRow } from './employee-list'
import type { DraftRow } from './draft-list'

export const metadata: Metadata = { title: 'Employees' }
export const dynamic = 'force-dynamic'

/** Columns the team table needs. Never `*` — profiles is a wide row. */
const EMPLOYEE_COLUMNS =
  'id, full_name, email, phone, photo_url, employee_code, designation, department_id, is_active, created_at'

/**
 * Columns the draft table exposes to a browser session. Named explicitly by
 * design — `select('*')` fails here, because the encrypted bank column is not
 * readable by the `authenticated` role (008_employee_onboarding.sql).
 */
const DRAFT_COLUMNS =
  'id, first_name, last_name, personal_email, designation, current_step, completed_steps, created_at, updated_at'

/**
 * Two tabs, and only the open one is fetched.
 *
 * Drafts and team members live in different tables and are rarely both wanted.
 * Loading both on every visit meant every org admin paid for the onboarding
 * drafts query whether or not they ever opened that tab. The closed tab now
 * costs one `count` — an index-only scan — which is all its badge needs.
 *
 * Every query runs through the USER-SCOPED client, so RLS scopes each one to
 * this tenant automatically.
 */
export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const ctx = await requireOrg()
  const supabase = await createSupabaseServerClient()
  const { tab } = await searchParams
  const active: 'team' | 'drafts' = tab === 'drafts' ? 'drafts' : 'team'

  const teamOpen = active === 'team'

  const [employees, drafts, departments] = await Promise.all([
    teamOpen
      ? supabase
          .from('profiles')
          .select(EMPLOYEE_COLUMNS, { count: 'exact' })
          .eq('role', 'employee')
          .order('created_at', { ascending: false })
      : supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'employee'),

    teamOpen
      ? supabase
          .from('employee_onboarding')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'draft')
      : supabase
          .from('employee_onboarding')
          .select(DRAFT_COLUMNS, { count: 'exact' })
          .eq('status', 'draft')
          .order('updated_at', { ascending: false }),

    // Only the team tab has a department filter and a department column.
    teamOpen
      ? supabase.from('departments').select('id, name').order('name')
      : Promise.resolve({ data: [] as { id: string; name: string }[], count: 0 }),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Employees"
        description="Everyone on your team, and the accounts they sign in with."
        actions={
          <Button asChild>
            <Link href="/org/employees/onboard">
              <UserPlus />
              Add employee
            </Link>
          </Button>
        }
      />
      <EmployeeList
        employees={teamOpen ? ((employees.data ?? []) as unknown as EmployeeRow[]) : null}
        employeeCount={employees.count ?? 0}
        departments={departments.data ?? []}
        drafts={teamOpen ? null : ((drafts.data ?? []) as unknown as DraftRow[])}
        draftCount={drafts.count ?? 0}
        tab={active}
        timezone={ctx.tenant.timezone}
      />
    </div>
  )
}
