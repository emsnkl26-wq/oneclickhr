/**
 * Domain row types mirroring supabase/migrations/001_schema.sql.
 *
 * Hand-written rather than generated so the shapes stay readable and reviewable.
 * If you prefer generated types, run:
 *   npx supabase gen types typescript --project-id <ref> > src/types/supabase.ts
 * and pass `Database` as the generic to the clients in src/lib/supabase/.
 */

export type UserRole = 'super_admin' | 'org' | 'employee'
export type TenantStatus = 'active' | 'suspended'
export type LeaveStatus = 'pending' | 'approved' | 'rejected'
export type NotificationTarget = 'all' | 'department' | 'employee'
export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled'
export type CalendarStatus = 'connected' | 'needs_reauth' | 'revoked'
export type MeetingSource = 'app' | 'google'
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'
export type DocumentKind = 'general' | 'employee_doc' | 'work_auth' | 'payslip'

export interface Tenant {
  id: string
  name: string
  slug: string
  logo_url: string | null
  primary_color: string
  status: TenantStatus
  timezone: string
  work_start_time: string
  onboarded_at: string | null
  /**
   * The company website this workspace claims — bare host, already normalized
   * (013_domain_verification.sql). A CLAIM: unverified ones may collide.
   */
  domain: string | null
  /** When the claim was PROVEN. Unique across the platform while non-null. */
  domain_verified_at: string | null
  domain_verification_method: 'meta' | 'dns' | null
  /** The secret the org publishes. Server-side reads only — never in a payload. */
  domain_token: string
  /** Deadline for the banner's tone. Nothing is gated when it passes. */
  domain_verify_due_at: string
  created_at: string
  updated_at: string
}

export interface Profile extends Partial<ProfileOnboardingFields> {
  id: string
  tenant_id: string | null
  role: UserRole
  full_name: string | null
  email: string | null
  phone: string | null
  employee_code: string | null
  designation: string | null
  department_id: string | null
  photo_url: string | null
  is_active: boolean
  must_change_password: boolean
  timezone: string
  date_of_joining: string | null
  /** Free-text skill tags, editable by the employee (012_profiles_and_letters). */
  skills: string[]
  created_at: string
  updated_at: string
}

/**
 * The columns 008_employee_onboarding.sql adds to `profiles`.
 *
 * Kept as a separate interface merged into `Profile` so the original 001 shape
 * stays readable — this is the onboarding wizard's payload, not core identity.
 * `account_number_enc` is AES-256-GCM ciphertext and is not selectable by an
 * ordinary session at all; it appears here for service-role code only.
 */
export interface ProfileOnboardingFields {
  preferred_first_name: string | null
  preferred_last_name: string | null
  pronouns: string | null
  date_of_birth: string | null
  gender: string | null
  street_address: string | null
  apartment: string | null
  city: string | null
  state_province: string | null
  zip_postal: string | null
  country: string | null
  home_phone: string | null
  work_phone: string | null
  work_email: string | null
  hire_date: string | null
  employment_status: string | null
  reporting_manager_id: string | null
  pay_type: string | null
  pay_rate: number | null
  pay_frequency: string | null
  employment_type: string | null
  bank_name: string | null
  account_holder_name: string | null
  account_number_enc: string | null
  routing_code: string | null
  account_type: string | null
  emergency_contact_name: string | null
  emergency_relationship: string | null
  emergency_phone: string | null
  emergency_email: string | null
  resume_url: string | null
  offer_letter_url: string | null
  id_proof_type: string | null
  id_proof_url: string | null
  additional_docs: OnboardingAdditionalDoc[]
  internal_notes: string | null
  compliance_notes: string | null
}

export interface OnboardingAdditionalDoc {
  key: string
  fileName: string
  label?: string | null
  sizeBytes?: number
}

/**
 * Where an onboarding has got to.
 *
 * `invited` and `submitted` (014) are the self-service path: the account exists
 * and the employee is filling in their own details, or has finished and is
 * waiting on an org admin to review them. Both always carry an
 * `employee_profile_id` — the constraint in 014 makes that a database fact.
 */
export type OnboardingStatus =
  | 'draft'
  | 'invited'
  | 'submitted'
  | 'completed'
  | 'cancelled'

/** A row of `employee_onboarding` — the resumable draft behind the wizard. */
export interface EmployeeOnboarding extends ProfileOnboardingFields {
  id: string
  tenant_id: string
  created_by: string
  status: OnboardingStatus
  first_name: string | null
  middle_name: string | null
  last_name: string | null
  personal_email: string | null
  phone: string | null
  work_auth_status: string | null
  visa_type: string | null
  visa_number: string | null
  visa_start_date: string | null
  visa_expiry_date: string | null
  auth_document_url: string | null
  employee_code: string | null
  department_id: string | null
  designation: string | null
  photo_url: string | null
  current_step: number
  completed_steps: number[]
  employee_profile_id: string | null
  completed_at: string | null
  /** 014 — the self-service timeline. */
  invited_at: string | null
  submitted_at: string | null
  reviewed_at: string | null
  /** What the org asked the employee to fix. Shown to the employee. */
  review_notes: string | null
  employee_step: number
  employee_completed_steps: number[]
  created_at: string
  updated_at: string
}

export interface Department {
  id: string
  tenant_id: string
  name: string
  created_at: string
}

export interface Attendance {
  id: string
  tenant_id: string
  employee_id: string
  date: string
  login_time: string
  logout_time: string | null
  total_hours: number | null
  is_late: boolean
  created_at: string
}

export interface Leave {
  id: string
  tenant_id: string
  employee_id: string
  start_date: string
  end_date: string
  days: number
  reason: string
  status: LeaveStatus
  approver_id: string | null
  decision_note: string | null
  decided_at: string | null
  created_at: string
}

export interface Payslip {
  id: string
  tenant_id: string
  employee_id: string
  month: number
  year: number
  file_url: string
  file_name: string | null
  uploaded_by: string | null
  created_at: string
}

export interface InvoiceItem {
  description: string
  quantity: number
  rate: number
  amount: number
}

export interface Invoice {
  id: string
  tenant_id: string
  invoice_number: string
  bill_to: { name?: string; email?: string; address?: string }
  items: InvoiceItem[]
  currency: string
  subtotal: number
  tax_percent: number
  total: number
  amount_paid: number
  balance_due: number
  status: InvoiceStatus
  issue_date: string
  due_date: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface AppNotification {
  id: string
  tenant_id: string
  title: string
  description: string | null
  send_to_type: NotificationTarget
  target_id: string | null
  created_by: string | null
  created_at: string
}

export interface WorkAuthorization {
  id: string
  tenant_id: string
  employee_id: string
  visa_type: string
  visa_number: string | null
  start_date: string | null
  expiry_date: string
  document_url: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type VisaMilestone = 90 | 30 | 7 | 0

export interface VisaReminderLog {
  id: string
  tenant_id: string
  employee_id: string
  work_auth_id: string
  milestone: VisaMilestone
  sent_at: string
}

export interface CalendarConnection {
  id: string
  tenant_id: string
  connected_by: string | null
  google_email: string | null
  google_channel_id: string | null
  google_resource_id: string | null
  channel_expires_at: string | null
  sync_token: string | null
  last_synced_at: string | null
  status: CalendarStatus
  expires_at: string | null
  created_at: string
  updated_at: string
}

export interface MeetingAttendee {
  email: string
  name?: string
  responseStatus?: string
}

export interface Meeting {
  id: string
  tenant_id: string
  title: string
  description: string | null
  location: string | null
  meet_link: string | null
  start_time: string
  end_time: string
  google_event_id: string | null
  organizer_id: string | null
  attendees: MeetingAttendee[]
  source: MeetingSource
  read_only: boolean
  cancelled_at: string | null
  created_at: string
  updated_at: string
}

export interface Board {
  id: string
  tenant_id: string
  name: string
  created_by: string | null
  created_at: string
}

export interface BoardColumn {
  id: string
  tenant_id: string
  board_id: string
  name: string
  position: number
  created_at: string
}

export interface Task {
  id: string
  tenant_id: string
  board_id: string
  column_id: string
  title: string
  description: string | null
  position: number
  priority: TaskPriority
  due_date: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface TaskWithAssignees extends Task {
  assignees: Array<Pick<Profile, 'id' | 'full_name' | 'email' | 'photo_url'>>
}

export interface AppDocument {
  id: string
  tenant_id: string
  owner_id: string | null
  employee_id: string | null
  kind: DocumentKind
  file_url: string
  file_name: string | null
  mime_type: string | null
  size_bytes: number | null
  extracted_text: string | null
  created_at: string
}

export interface AuditLog {
  id: string
  tenant_id: string | null
  actor_id: string | null
  actor_email: string | null
  action: string
  entity: string | null
  entity_id: string | null
  ip: string | null
  meta: Record<string, unknown>
  created_at: string
}

export interface CronRun {
  id: string
  job: string
  ok: boolean
  duration_ms: number | null
  detail: Record<string, unknown>
  created_at: string
}

/** Shape returned by the `current_profile()` RPC (003_auth_hook_and_triggers.sql). */
export interface CurrentProfile {
  id: string
  tenant_id: string | null
  role: UserRole
  full_name: string | null
  email: string | null
  is_active: boolean
  must_change_password: boolean
  tenant_name: string | null
  tenant_slug: string | null
  tenant_status: TenantStatus | null
  tenant_logo_url: string | null
  tenant_primary_color: string | null
  tenant_timezone: string | null
  tenant_domain: string | null
  tenant_domain_verified: boolean | null
  tenant_domain_due_at: string | null
}

// ---------------------------------------------------------------------------
// Projects & timesheets (010_projects_timesheets.sql)
// ---------------------------------------------------------------------------

export type ProjectStatus = 'active' | 'inactive' | 'completed'
export type TimesheetStatus = 'open' | 'submitted' | 'approved' | 'rejected'

export interface Project {
  id: string
  tenant_id: string
  /** `PRJ-001`. Generated per tenant by a trigger — never sent by the client. */
  code: string
  name: string
  client_name: string | null
  /** The client's client. Common in staffing, and the timesheet has to name it. */
  end_client_name: string | null
  description: string | null
  start_date: string | null
  end_date: string | null
  status: ProjectStatus
  created_by: string | null
  created_at: string
  updated_at: string
}

/** A person on a project, as the assignment picker and avatar stack need them. */
export interface ProjectMember {
  id: string
  full_name: string | null
  email: string | null
  photo_url: string | null
  designation: string | null
}

export interface ProjectWithMembers extends Project {
  members: ProjectMember[]
  /** Approved hours only — see `project_hour_totals()`. */
  totalHours: number
}

export interface Timesheet {
  id: string
  tenant_id: string
  employee_id: string
  /** `TS-00001`. */
  code: string
  /** Sunday of the week, in the org's calendar. */
  week_start: string
  /** Saturday. Always `week_start + 6`; a DB constraint enforces it. */
  week_end: string
  status: TimesheetStatus
  total_hours: number
  billable_hours: number
  non_billable_hours: number
  comments: string | null
  /** R2 object key of the client's own timesheet export, when one is required. */
  attachment_url: string | null
  attachment_name: string | null
  submitted_at: string | null
  reviewed_by: string | null
  review_note: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
}

/** One task/project line of the weekly grid. */
export interface TimesheetEntry {
  id: string
  tenant_id: string
  timesheet_id: string
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
  created_at: string
}

export interface TimesheetWithEntries extends Timesheet {
  entries: TimesheetEntry[]
}

// ---------------------------------------------------------------------------
// Help desk (011_helpdesk.sql)
// ---------------------------------------------------------------------------

export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed'
export type TicketPriority = 'low' | 'medium' | 'high'

export interface Ticket {
  id: string
  tenant_id: string
  employee_id: string
  /** `TKT-001`. */
  code: string
  subject: string
  description: string
  priority: TicketPriority
  status: TicketStatus
  attachment_url: string | null
  attachment_name: string | null
  last_activity_at: string
  created_at: string
  updated_at: string
}

export interface TicketMessage {
  id: string
  tenant_id: string
  ticket_id: string
  author_id: string | null
  /** Denormalised so the thread still reads right after an account is closed. */
  author_role: UserRole
  body: string
  attachment_url: string | null
  attachment_name: string | null
  created_at: string
}

// ---------------------------------------------------------------------------
// Employee profile & generated documents (012_profiles_and_letters.sql)
// ---------------------------------------------------------------------------

export interface EmployeeExperience {
  id: string
  tenant_id: string
  employee_id: string
  company_name: string
  role_title: string
  start_date: string | null
  end_date: string | null
  is_current: boolean
  summary: string | null
  created_at: string
  updated_at: string
}

export interface EmployeeEducation {
  id: string
  tenant_id: string
  employee_id: string
  institution: string
  degree: string
  field_of_study: string | null
  completion_year: number | null
  created_at: string
  updated_at: string
}

export type GeneratedDocumentType =
  | 'offer_letter'
  | 'employment_agreement'
  | 'internship_offer'

export interface GeneratedDocument {
  id: string
  tenant_id: string
  employee_id: string
  doc_type: GeneratedDocumentType
  title: string
  /** R2 object key. Read through `/api/files/view`, never linked directly. */
  file_url: string
  file_name: string | null
  document_id: string | null
  payload: Record<string, unknown>
  created_by: string | null
  created_at: string
  updated_at: string
}

/**
 * The letterhead block a generated document prints.
 *
 * Every field is optional because a document must never invent one: an org that
 * has not entered a registration number gets a letterhead without that line, not
 * a placeholder and certainly not ours.
 */
export interface CompanyDetails {
  name: string
  logoUrl: string | null
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  stateProvince: string | null
  postalCode: string | null
  country: string | null
  registrationNumber: string | null
  companyEmail: string | null
  companyPhone: string | null
  website: string | null
  signatoryName: string | null
  signatoryTitle: string | null
  signatoryPhone: string | null
}
