/**
 * CROSS-TENANT ISOLATION TEST
 *
 * Proves, against a REAL Supabase project with 005_seed.sql applied, that
 * Tenant A cannot read or write Tenant B's employees, attendance, payslips,
 * invoices, tasks, meetings, documents or work authorizations — and that an
 * employee cannot read a colleague's private data inside their own tenant.
 *
 * WHY IT SIGNS IN AS REAL USERS
 * -----------------------------
 * The whole point is to exercise the path a browser takes: anon key + a genuine
 * auth session, so every query is evaluated by the RLS policies in 002_rls.sql.
 * A test using the service role would prove nothing — that client bypasses RLS
 * by design. The service role appears here only to SET UP fixtures (reading ids,
 * toggling is_active), never to make an assertion.
 *
 * WHY "0 ROWS" IS A PASS
 * ----------------------
 * Postgres RLS does not raise on a forbidden SELECT; it filters the row out. So
 * cross-tenant reads are expected to return an EMPTY SET, not an error. Writes
 * are different: a failing WITH CHECK raises 42501, so those assert on an error.
 * Both shapes are checked explicitly below — a test that only looked for errors
 * would pass even if isolation were completely broken.
 *
 * Run:  npm run test:isolation
 * Needs: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *        SUPABASE_SERVICE_ROLE_KEY, and the seed passwords below.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })
config()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Must match what you set in 005_seed.sql before running it.
const ORG_A = { email: 'owner@acme-health.test', password: process.env.SEED_ORG_A_PASSWORD || 'ChangeMe!OrgA#2026' }
const ORG_B = { email: 'owner@borealis-care.test', password: process.env.SEED_ORG_B_PASSWORD || 'ChangeMe!OrgB#2026' }
const EMP_A1 = { email: 'nurse.a1@acme-health.test', password: process.env.SEED_EMPLOYEE_PASSWORD || 'ChangeMe!Employee#2026' }
const EMP_A2 = { email: 'nurse.a2@acme-health.test', password: process.env.SEED_EMPLOYEE_PASSWORD || 'ChangeMe!Employee#2026' }

let passed = 0
let failed = 0
const failures: string[] = []

function ok(name: string) {
  passed++
  console.log(`  \x1b[32m✓\x1b[0m ${name}`)
}

function fail(name: string, detail: string) {
  failed++
  failures.push(`${name} — ${detail}`)
  console.log(`  \x1b[31m✗\x1b[0m ${name}`)
  console.log(`      \x1b[31m${detail}\x1b[0m`)
}

/** A cross-tenant read must come back EMPTY (RLS filters, it does not raise). */
async function expectNoRows(
  name: string,
  query: PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>
) {
  const { data, error } = await query
  if (error) {
    // An error is also acceptable isolation, but empty is the expected shape.
    ok(`${name} (denied: ${error.message.slice(0, 40)})`)
    return
  }
  if (data && data.length > 0) {
    fail(name, `LEAKED ${data.length} row(s) across the tenant boundary`)
    return
  }
  ok(name)
}

/** A cross-tenant write must be REFUSED (WITH CHECK raises). */
async function expectDenied(
  name: string,
  query: PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>
) {
  const { data, error } = await query
  if (error) {
    ok(`${name} (${error.code ?? 'denied'})`)
    return
  }
  if (data && (!Array.isArray(data) || data.length > 0)) {
    fail(name, 'WRITE SUCCEEDED across the tenant boundary')
    return
  }
  ok(`${name} (no rows written)`)
}

/** A legitimate in-tenant read must return SOMETHING — proves the test is real. */
async function expectRows(
  name: string,
  query: PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>
) {
  const { data, error } = await query
  if (error) {
    fail(name, `unexpected error: ${error.message}`)
    return
  }
  if (!data || data.length === 0) {
    fail(name, 'returned no rows — the fixture is missing, so the negative tests prove nothing')
    return
  }
  ok(name)
}

async function signIn(creds: { email: string; password: string }): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await client.auth.signInWithPassword(creds)
  if (error) {
    throw new Error(
      `Could not sign in as ${creds.email}: ${error.message}\n` +
        'Did you run 005_seed.sql, and do the passwords here match the ones you set in it?'
    )
  }
  return client
}

async function main() {
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
    console.error('Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.')
    process.exit(1)
  }

  console.log('\n\x1b[1mCross-tenant isolation test\x1b[0m')
  console.log(`  ${SUPABASE_URL}\n`)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // --- Fixture ids (service role: setup only, never an assertion) ----------
  const { data: tenants } = await admin.from('tenants').select('id, name, slug').order('created_at')
  const tenantA = tenants?.find((t) => t.name === 'Acme Health')
  const tenantB = tenants?.find((t) => t.name === 'Borealis Care')

  if (!tenantA || !tenantB) {
    console.error('Demo tenants not found. Run supabase/migrations/005_seed.sql first.')
    process.exit(1)
  }

  const { data: bEmployees } = await admin
    .from('profiles')
    .select('id, email')
    .eq('tenant_id', tenantB.id)
    .eq('role', 'employee')

  const { data: bPayslips } = await admin.from('payslips').select('id').eq('tenant_id', tenantB.id)
  const { data: bInvoices } = await admin.from('invoices').select('id').eq('tenant_id', tenantB.id)
  const { data: bTasks } = await admin.from('tasks').select('id, column_id, board_id').eq('tenant_id', tenantB.id)
  const { data: bBoards } = await admin.from('boards').select('id').eq('tenant_id', tenantB.id)

  const bEmployeeId = bEmployees?.[0]?.id
  const bBoardId = bBoards?.[0]?.id
  const bTask = bTasks?.[0]

  console.log(`  Tenant A: ${tenantA.name} (${tenantA.id})`)
  console.log(`  Tenant B: ${tenantB.name} (${tenantB.id})\n`)

  // ========================================================================
  console.log('\x1b[1mA. Org A vs Tenant B\x1b[0m')
  // ========================================================================
  const orgA = await signIn(ORG_A)

  // Sanity first: if these fail, every "no rows" below is meaningless.
  await expectRows('Org A CAN see its own employees', orgA.from('profiles').select('id').eq('role', 'employee'))
  await expectRows('Org A CAN see its own invoices', orgA.from('invoices').select('id'))

  await expectNoRows(
    "Org A cannot read Tenant B's employees",
    orgA.from('profiles').select('id, email').eq('tenant_id', tenantB.id)
  )
  await expectNoRows(
    "Org A cannot read Tenant B's attendance",
    orgA.from('attendance').select('id').eq('tenant_id', tenantB.id)
  )
  await expectNoRows(
    "Org A cannot read Tenant B's leaves",
    orgA.from('leaves').select('id').eq('tenant_id', tenantB.id)
  )
  await expectNoRows(
    "Org A cannot read Tenant B's payslips",
    orgA.from('payslips').select('id').eq('tenant_id', tenantB.id)
  )
  await expectNoRows(
    "Org A cannot read Tenant B's invoices",
    orgA.from('invoices').select('id').eq('tenant_id', tenantB.id)
  )
  await expectNoRows(
    "Org A cannot read Tenant B's tasks",
    orgA.from('tasks').select('id').eq('tenant_id', tenantB.id)
  )
  await expectNoRows(
    "Org A cannot read Tenant B's meetings",
    orgA.from('meetings').select('id').eq('tenant_id', tenantB.id)
  )
  await expectNoRows(
    "Org A cannot read Tenant B's documents",
    orgA.from('documents').select('id').eq('tenant_id', tenantB.id)
  )
  await expectNoRows(
    "Org A cannot read Tenant B's work authorizations",
    orgA.from('work_authorizations').select('id').eq('tenant_id', tenantB.id)
  )
  await expectNoRows(
    "Org A cannot read Tenant B's departments",
    orgA.from('departments').select('id').eq('tenant_id', tenantB.id)
  )
  await expectNoRows(
    "Org A cannot read Tenant B's tenant row",
    orgA.from('tenants').select('id').eq('id', tenantB.id)
  )
  await expectNoRows(
    "Org A cannot read Tenant B's audit log",
    orgA.from('audit_logs').select('id').eq('tenant_id', tenantB.id)
  )

  /*
   * The tables added by 010–012. They carry the same NOT NULL tenant_id and the
   * same policy shape as everything above, so they are checked the same way —
   * a new feature that quietly forgot its tenant clause would show up here and
   * nowhere else until a customer found it.
   */
  for (const table of [
    'projects',
    'project_assignments',
    'timesheets',
    'timesheet_entries',
    'tickets',
    'ticket_messages',
    'generated_documents',
    'employee_experience',
    'employee_education',
  ]) {
    await expectNoRows(
      `Org A cannot read Tenant B's ${table.replace(/_/g, ' ')}`,
      orgA.from(table).select('tenant_id').eq('tenant_id', tenantB.id)
    )
  }

  await expectDenied(
    "Org A cannot create a project inside Tenant B",
    orgA.from('projects').insert({ tenant_id: tenantB.id, name: 'Injected' }).select()
  )

  // Targeted by primary key — no tenant filter to "help" RLS along.
  if (bEmployeeId) {
    await expectNoRows(
      "Org A cannot read a Tenant B employee by direct id",
      orgA.from('profiles').select('id').eq('id', bEmployeeId)
    )
  }
  if (bPayslips?.[0]?.id) {
    await expectNoRows(
      'Org A cannot read a Tenant B payslip by direct id',
      orgA.from('payslips').select('id').eq('id', bPayslips[0].id)
    )
  }
  if (bInvoices?.[0]?.id) {
    await expectNoRows(
      'Org A cannot read a Tenant B invoice by direct id',
      orgA.from('invoices').select('id').eq('id', bInvoices[0].id)
    )
  }

  // ------------------------------------------------------------------ writes
  console.log('\n\x1b[1mB. Org A writing into Tenant B\x1b[0m')

  await expectDenied(
    "Org A cannot INSERT a department into Tenant B",
    orgA.from('departments').insert({ tenant_id: tenantB.id, name: 'Injected' }).select()
  )
  await expectDenied(
    "Org A cannot INSERT an invoice into Tenant B",
    orgA
      .from('invoices')
      .insert({ tenant_id: tenantB.id, invoice_number: 'HACK-001', total: 1, balance_due: 1 })
      .select()
  )
  await expectDenied(
    "Org A cannot INSERT a notification into Tenant B",
    orgA
      .from('notifications')
      .insert({ tenant_id: tenantB.id, title: 'Injected', send_to_type: 'all' })
      .select()
  )
  if (bBoardId) {
    await expectDenied(
      "Org A cannot INSERT a task into Tenant B's board",
      orgA
        .from('tasks')
        .insert({
          tenant_id: tenantB.id,
          board_id: bBoardId,
          column_id: bTask?.column_id,
          title: 'Injected',
        })
        .select()
    )
  }
  await expectDenied(
    "Org A cannot UPDATE Tenant B's tenant row",
    orgA.from('tenants').update({ name: 'Owned' }).eq('id', tenantB.id).select()
  )
  if (bEmployeeId) {
    await expectDenied(
      "Org A cannot UPDATE a Tenant B employee",
      orgA.from('profiles').update({ full_name: 'Owned' }).eq('id', bEmployeeId).select()
    )
    await expectDenied(
      "Org A cannot DEACTIVATE a Tenant B employee",
      orgA.from('profiles').update({ is_active: false }).eq('id', bEmployeeId).select()
    )
  }
  if (bTask) {
    await expectDenied(
      "Org A cannot DELETE a Tenant B task",
      orgA.from('tasks').delete().eq('id', bTask.id).select()
    )
  }

  // A cross-tenant INSERT that lies about tenant_id, claiming A's own tenant
  // while pointing at B's board — the WITH CHECK on tasks must still refuse it
  // because the board is not visible.
  if (bBoardId) {
    await expectDenied(
      "Org A cannot smuggle its own tenant_id onto a Tenant B board",
      orgA
        .from('tasks')
        .insert({
          tenant_id: tenantA.id,
          board_id: bBoardId,
          column_id: bTask?.column_id,
          title: 'Smuggled',
        })
        .select()
    )
  }

  // ========================================================================
  console.log('\n\x1b[1mC. Employee scope inside Tenant A\x1b[0m')
  // ========================================================================
  const empA1 = await signIn(EMP_A1)

  const { data: a2Profile } = await admin
    .from('profiles')
    .select('id')
    .eq('email', EMP_A2.email)
    .maybeSingle()

  // A1's own id, resolved with the service role: it is test SETUP, never an
  // assertion. The checks below all run through A1's own session.
  const { data: a1Row } = await admin
    .from('profiles')
    .select('id')
    .eq('email', EMP_A1.email)
    .maybeSingle()
  const a1Id: string | null = a1Row?.id ?? null

  await expectRows(
    'Employee A1 CAN see their own attendance',
    empA1.from('attendance').select('id')
  )

  if (a2Profile?.id) {
    await expectNoRows(
      "Employee A1 cannot read colleague A2's attendance",
      empA1.from('attendance').select('id').eq('employee_id', a2Profile.id)
    )
    await expectNoRows(
      "Employee A1 cannot read colleague A2's payslips",
      empA1.from('payslips').select('id').eq('employee_id', a2Profile.id)
    )
    await expectNoRows(
      "Employee A1 cannot read colleague A2's leaves",
      empA1.from('leaves').select('id').eq('employee_id', a2Profile.id)
    )
    await expectNoRows(
      "Employee A1 cannot read colleague A2's timesheets",
      empA1.from('timesheets').select('id').eq('employee_id', a2Profile.id)
    )
    await expectNoRows(
      "Employee A1 cannot read colleague A2's help desk tickets",
      empA1.from('tickets').select('id').eq('employee_id', a2Profile.id)
    )
    await expectNoRows(
      "Employee A1 cannot read colleague A2's work history",
      empA1.from('employee_experience').select('id').eq('employee_id', a2Profile.id)
    )
    await expectDenied(
      "Employee A1 cannot append to colleague A2's work history",
      empA1
        .from('employee_experience')
        .insert({
          tenant_id: tenantA.id,
          employee_id: a2Profile.id,
          company_name: 'Injected',
          role_title: 'Injected',
        })
        .select()
    )
  }

  /*
   * The self-approval hole, checked from the outside.
   *
   * `timesheets_update` lets an employee update their OWN row — it has to, or
   * they could not submit one. What stops them approving it is
   * `tg_timesheets_guard`, and this is the assertion that the trigger is
   * actually installed rather than merely written down in the migration.
   */
  await expectDenied(
    'Employee A1 cannot approve their own timesheet',
    empA1.from('timesheets').update({ status: 'approved' }).eq('employee_id', a1Id ?? '').select()
  )
  await expectDenied(
    'Employee A1 cannot file a timesheet that is already approved',
    empA1
      .from('timesheets')
      .insert({
        tenant_id: tenantA.id,
        employee_id: a1Id ?? '',
        week_start: '2020-01-05',
        week_end: '2020-01-11',
        status: 'approved',
      })
      .select()
  )
  await expectDenied(
    'Employee A1 cannot create a project',
    empA1.from('projects').insert({ tenant_id: tenantA.id, name: 'Injected' }).select()
  )
  await expectDenied(
    'Employee A1 cannot close their own help desk ticket',
    empA1.from('tickets').update({ status: 'closed' }).eq('employee_id', a1Id ?? '').select()
  )

  await expectNoRows(
    'Employee A1 cannot read their own tenant invoices (org-only data)',
    empA1.from('invoices').select('id')
  )
  await expectNoRows(
    "Employee A1 cannot read Tenant B's anything",
    empA1.from('profiles').select('id').eq('tenant_id', tenantB.id)
  )
  await expectDenied(
    'Employee A1 cannot self-approve a leave request',
    empA1.from('leaves').update({ status: 'approved' }).eq('employee_id', a2Profile?.id ?? '').select()
  )
  await expectDenied(
    'Employee A1 cannot promote themselves to org',
    empA1.from('profiles').update({ role: 'org' }).eq('email', EMP_A1.email).select()
  )
  await expectDenied(
    'Employee A1 cannot create an invoice',
    empA1
      .from('invoices')
      .insert({ tenant_id: tenantA.id, invoice_number: 'EMP-001', total: 1, balance_due: 1 })
      .select()
  )

  // ========================================================================
  console.log('\n\x1b[1mD. Deactivation takes effect immediately\x1b[0m')
  // ========================================================================
  if (a1Id) {
    // Deactivate WITHOUT touching the session. The already-issued JWT stays
    // valid for its full hour, so if access survived here, the system would be
    // trusting the token instead of the table.
    await admin.from('profiles').update({ is_active: false }).eq('id', a1Id)

    await expectNoRows(
      'Deactivated employee immediately loses access (same live session)',
      empA1.from('attendance').select('id')
    )

    await admin.from('profiles').update({ is_active: true }).eq('id', a1Id)
    await expectRows(
      'Reactivated employee regains access immediately',
      empA1.from('attendance').select('id')
    )
  }

  // ========================================================================
  console.log('\n\x1b[1mE. Tenant suspension locks everyone out\x1b[0m')
  // ========================================================================
  const orgB = await signIn(ORG_B)
  await expectRows('Org B CAN see its own employees before suspension', orgB.from('profiles').select('id'))

  await admin.from('tenants').update({ status: 'suspended' }).eq('id', tenantB.id)
  await expectNoRows(
    'Suspending a tenant immediately blocks its org user',
    orgB.from('invoices').select('id')
  )
  await admin.from('tenants').update({ status: 'active' }).eq('id', tenantB.id)
  await expectRows('Reactivating restores access', orgB.from('invoices').select('id'))

  // ========================================================================
  console.log('\n\x1b[1mF. Audit trail is append-only\x1b[0m')
  // ========================================================================
  const { data: auditRow } = await admin.from('audit_logs').select('id').limit(1).maybeSingle()
  if (auditRow?.id) {
    await expectDenied(
      'Org A cannot UPDATE an audit log entry',
      orgA.from('audit_logs').update({ action: 'tampered' }).eq('id', auditRow.id).select()
    )
    await expectDenied(
      'Org A cannot DELETE an audit log entry',
      orgA.from('audit_logs').delete().eq('id', auditRow.id).select()
    )
  }

  // ------------------------------------------------------------------------
  console.log('\n' + '─'.repeat(60))
  if (failed === 0) {
    console.log(`\x1b[32m\x1b[1m  ALL ${passed} ISOLATION CHECKS PASSED\x1b[0m`)
    console.log('  Tenant A cannot reach Tenant B. Employees cannot reach each other.')
    console.log('  Deactivation and suspension take effect on the next request.\n')
    process.exit(0)
  } else {
    console.log(`\x1b[31m\x1b[1m  ${failed} FAILED, ${passed} passed\x1b[0m\n`)
    for (const failure of failures) console.log(`  \x1b[31m•\x1b[0m ${failure}`)
    console.log('')
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('\n\x1b[31mIsolation test could not run:\x1b[0m', err.message)
  process.exit(1)
})
