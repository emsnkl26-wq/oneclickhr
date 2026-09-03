/**
 * Every mutation's input contract, in one place.
 *
 * Shared by the client forms and the server handlers, so a field's rules exist
 * once. The server ALWAYS re-parses — client-side validation is a courtesy to
 * the user, never a control.
 */
import { z } from 'zod'
import { normalizeDomain, domainProblem } from '@/lib/domain'

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const emailSchema = z
  .string()
  .trim()
  .min(3, 'Enter an email address')
  .max(254)
  .email('Enter a valid email address')
  .transform((v) => v.toLowerCase())

/**
 * Password floor. Length does far more work than a character-class zoo, so the
 * rule is 10+ characters with at least one letter and one digit — enough to stop
 * `password` and `12345678` without pushing people toward `P@ssw0rd!`.
 */
export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128, 'That password is too long')
  .refine((v) => /[a-zA-Z]/.test(v), 'Include at least one letter')
  .refine((v) => /[0-9]/.test(v), 'Include at least one number')

export const uuid = z.string().uuid('Invalid identifier')
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker')
export const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use a 6-digit hex colour, e.g. #C41E33')

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null))

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/**
 * A company website, normalized to the bare host we store and compare on.
 *
 * The transform runs AFTER the check on purpose: `Acme.COM/careers`,
 * `https://www.acme.com` and `acme.com` are the same organization, and if the
 * form and the server disagreed about that by one character, the domain someone
 * verified would stop matching the one recorded against their workspace.
 */
export const domainSchema = z
  .string()
  .trim()
  .min(1, 'Enter your company website')
  .max(300)
  .superRefine((value, ctx) => {
    const problem = domainProblem(value)
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem })
  })
  .transform((value) => normalizeDomain(value) as string)

export const signupSchema = z.object({
  orgName: z.string().trim().min(2, 'Enter your organization name').max(120),
  fullName: z.string().trim().min(2, 'Enter your name').max(120),
  email: emailSchema,
  password: passwordSchema,
  /**
   * Required, and required at SIGNUP rather than at verification: it is what
   * makes "does this company already have a workspace?" answerable BEFORE the
   * second one exists. Proving it is a separate, later, optional-feeling step —
   * see 013_domain_verification.sql.
   */
  domain: domainSchema,
})
export type SignupInput = z.infer<typeof signupSchema>

/** Setting or correcting the claimed website from the verification page. */
export const setDomainSchema = z.object({ domain: domainSchema })

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password').max(128),
  // Which sign-in page the request came from. The server refuses an account
  // whose role does not belong to that portal. Defaulted so an older client (or
  // a curl) still works, and defaulted to the ADMIN door because that is the
  // stricter of the two — an employee cannot slip in by omitting the field.
  portal: z.enum(['org', 'employee']).default('org'),
})

export const forgotPasswordSchema = z.object({ email: emailSchema })

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    message: 'Choose a password you have not used here before',
    path: ['newPassword'],
  })

// ---------------------------------------------------------------------------
// Organization settings / onboarding
// ---------------------------------------------------------------------------

export const tenantSettingsSchema = z.object({
  name: z.string().trim().min(2, 'Enter your organization name').max(120),
  primaryColor: hexColor,
  timezone: z.string().trim().min(3).max(64),
  workStartTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM, e.g. 09:30'),
})

export const onboardingSchema = z.object({
  primaryColor: hexColor,
  timezone: z.string().trim().min(3).max(64),
  departmentName: z.string().trim().min(2, 'Enter a department name').max(80),
})

export const departmentSchema = z.object({
  name: z.string().trim().min(2, 'Enter a department name').max(80),
})

// ---------------------------------------------------------------------------
// Employees — editing an existing account
// ---------------------------------------------------------------------------

export const employeeStep1Schema = z.object({
  fullName: z.string().trim().min(2, 'Enter the full name').max(120),
  email: emailSchema,
  phone: optionalText(32),
  photoKey: optionalText(300),
})

export const employeeStep2Schema = z.object({
  employeeCode: optionalText(40),
  designation: optionalText(80),
  departmentId: uuid.nullable().optional(),
  dateOfJoining: isoDate.nullable().optional(),
  timezone: z.string().trim().min(3).max(64).default('Asia/Kolkata'),
})

// Account CREATION now runs through the onboarding wizard below — there is one
// path to a new employee account, and it is the one that validates six steps
// and rolls back. What remains here is the EDIT contract for an existing
// employee (/api/org/employees/[id]).
export const updateEmployeeSchema = employeeStep1Schema
  .omit({ email: true })
  .merge(employeeStep2Schema)
  .extend({ isActive: z.boolean().optional() })

// ---------------------------------------------------------------------------
// Employee onboarding — the six-step wizard
//
// TWO CONTRACTS PER STEP, and the split is the whole design:
//
//   • `onboardingDraftSchema`  — everything optional. This is what "Save for
//     later" and the 30-second autosave post. A draft is by definition
//     incomplete, so requiring anything here would make the feature impossible.
//   • `onboardingStepNSchema` — the REQUIRED fields for that step. Run by the
//     client on "Next" (a courtesy) and by the server on "Complete Onboarding"
//     (the control). Completion re-validates all six, so a draft edited past the
//     UI — or a stale tab — still cannot mint a half-populated account.
//
// Field names are camelCase throughout and mapped to the snake_case columns in
// one place (src/lib/onboarding.ts), so the wire format never leaks the schema.
// ---------------------------------------------------------------------------

/**
 * A free-text draft field.
 *
 * `''` and `null` mean CLEAR IT; a key that was never sent means LEAVE IT
 * ALONE, and must therefore stay `undefined` all the way through — a transform
 * that folded undefined into null would make every partial save rewrite the
 * whole row, quietly wiping the five steps the caller did not touch.
 */
const draftText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v === undefined ? undefined : v || null))

const draftDate = z
  .union([isoDate, z.literal('')])
  .nullish()
  .transform((v) => (v === undefined ? undefined : v || null))

/** The same undefined-preserving rule for an id that may be cleared. */
const draftUuid = uuid.nullish().transform((v) => (v === undefined ? undefined : (v ?? null)))

export const WORK_AUTH_STATUSES = [
  'US Citizen',
  'Permanent Resident',
  'H-1B',
  'L-1',
  'EAD',
  'OPT',
  'Other Visa',
  'Not Applicable',
] as const

/** The statuses that carry no visa paperwork — step 2 hides its detail fields. */
export const NON_VISA_STATUSES: readonly string[] = [
  'US Citizen',
  'Permanent Resident',
  'Not Applicable',
]

export const GENDERS = ['Male', 'Female', 'Non-binary', 'Prefer not to say'] as const
export const PRONOUNS = ['He/Him', 'She/Her', 'They/Them', 'Other'] as const
export const EMPLOYMENT_STATUSES = ['Active', 'Probation', 'Leave of Absence'] as const
export const PAY_TYPES = ['Hourly', 'Salaried'] as const
export const PAY_FREQUENCIES = ['Weekly', 'Bi-weekly', 'Semi-monthly', 'Monthly'] as const
export const EMPLOYMENT_TYPES = ['Full-time', 'Part-time', 'Contract', 'Intern'] as const
export const ACCOUNT_TYPES = ['Checking', 'Savings'] as const
export const ID_PROOF_TYPES = ['Passport', "Driver's License", 'National ID', 'Other'] as const

export const additionalDocSchema = z.object({
  key: z.string().trim().min(1).max(300),
  fileName: z.string().trim().min(1).max(255),
  label: z.string().trim().max(120).nullish().transform((v) => (v ? v : null)),
  sizeBytes: z.number().int().nonnegative().optional(),
})
export type AdditionalDoc = z.infer<typeof additionalDocSchema>

/**
 * A partial save. Every key optional, so a PATCH carries only what changed and
 * an untouched step is never overwritten with nulls.
 */
export const onboardingDraftSchema = z.object({
  // Step 1
  firstName: draftText(80),
  middleName: draftText(80),
  lastName: draftText(80),
  dateOfBirth: draftDate,
  gender: draftText(40),
  preferredFirstName: draftText(80),
  preferredLastName: draftText(80),
  pronouns: draftText(40),
  streetAddress: draftText(200),
  apartment: draftText(80),
  city: draftText(80),
  stateProvince: draftText(80),
  zipPostal: draftText(20),
  country: draftText(80),
  phone: draftText(32),
  homePhone: draftText(32),
  personalEmail: draftText(254),
  internalNotes: draftText(4000),

  // Step 2
  workAuthStatus: draftText(40),
  visaType: draftText(40),
  visaNumber: draftText(80),
  visaStartDate: draftDate,
  visaExpiryDate: draftDate,
  authDocumentUrl: draftText(300),

  // Step 3
  workPhone: draftText(32),
  workEmail: draftText(254),
  hireDate: draftDate,
  employmentStatus: draftText(40),
  employeeCode: draftText(40),
  departmentId: draftUuid,
  designation: draftText(80),
  reportingManagerId: draftUuid,

  // Step 4. `accountNumber` is PLAINTEXT and lives only for the length of the
  // request — the handler encrypts it into `account_number_enc` and it is never
  // read back to a browser (only its last four digits are).
  payType: draftText(20),
  payRate: z
    .coerce.number()
    .min(0)
    .max(1_000_000_000)
    .nullish()
    .transform((v) => (v === undefined ? undefined : (v ?? null))),
  payFrequency: draftText(30),
  employmentType: draftText(30),
  bankName: draftText(120),
  accountHolderName: draftText(120),
  accountNumber: z
    .string()
    .trim()
    .max(40)
    .regex(/^[0-9A-Za-z-]*$/, 'Use digits and letters only')
    .nullish()
    .transform((v) => (v === undefined ? undefined : v || null)),
  routingCode: draftText(40),
  accountType: draftText(20),
  emergencyContactName: draftText(120),
  emergencyRelationship: draftText(80),
  emergencyPhone: draftText(32),
  emergencyEmail: draftText(254),

  // Step 5
  photoUrl: draftText(300),
  resumeUrl: draftText(300),
  offerLetterUrl: draftText(300),
  idProofType: draftText(40),
  idProofUrl: draftText(300),
  additionalDocs: z.array(additionalDocSchema).max(15).optional(),
  complianceNotes: draftText(4000),

  // Wizard state. The org's position and the employee's are tracked apart (014)
  // so an admin resuming their side does not shunt the employee around theirs.
  currentStep: z.coerce.number().int().min(1).max(6).optional(),
  completedSteps: z.array(z.coerce.number().int().min(1).max(6)).max(6).optional(),
  employeeStep: z.coerce.number().int().min(1).max(6).optional(),
  employeeCompletedSteps: z.array(z.coerce.number().int().min(1).max(6)).max(6).optional(),
})
export type OnboardingDraftInput = z.infer<typeof onboardingDraftSchema>

const requiredText = (label: string, max: number) =>
  z.string({ required_error: label }).trim().min(1, label).max(max)

/** Step 1 — legal identity, address and the login email. */
export const onboardingStep1Schema = z.object({
  firstName: requiredText('Enter their first name', 80),
  lastName: requiredText('Enter their last name', 80),
  dateOfBirth: isoDate,
  gender: z.enum(GENDERS, { errorMap: () => ({ message: 'Choose an option' }) }),
  streetAddress: requiredText('Enter the street address', 200),
  city: requiredText('Enter the city', 80),
  stateProvince: requiredText('Enter the state or province', 80),
  zipPostal: requiredText('Enter the ZIP or postal code', 20),
  country: requiredText('Choose a country', 80),
  phone: requiredText('Enter a phone number', 32),
  personalEmail: emailSchema,
})

/** Step 2 — status is required; the visa detail behind it is not. */
export const onboardingStep2Schema = z.object({
  workAuthStatus: z.enum(WORK_AUTH_STATUSES, {
    errorMap: () => ({ message: 'Choose a work authorization status' }),
  }),
})

/** Step 3 — the employment facts the rest of the app keys off. */
export const onboardingStep3Schema = z.object({
  hireDate: isoDate,
  employmentStatus: z.enum(EMPLOYMENT_STATUSES, {
    errorMap: () => ({ message: 'Choose an employment status' }),
  }),
  departmentId: uuid,
  designation: requiredText('Enter a job title', 80),
})

/** Step 4 — pay and the emergency contact. Bank details stay optional. */
export const onboardingStep4Schema = z.object({
  payType: z.enum(PAY_TYPES, { errorMap: () => ({ message: 'Choose a pay type' }) }),
  payRate: z.coerce.number({ invalid_type_error: 'Enter an amount' }).min(0, 'Enter an amount'),
  payFrequency: z.enum(PAY_FREQUENCIES, {
    errorMap: () => ({ message: 'Choose a pay frequency' }),
  }),
  employmentType: z.enum(EMPLOYMENT_TYPES, {
    errorMap: () => ({ message: 'Choose an employment type' }),
  }),
  emergencyContactName: requiredText('Enter a contact name', 120),
  emergencyRelationship: requiredText('Enter the relationship', 80),
  emergencyPhone: requiredText('Enter a phone number', 32),
})

/** Step 5 — documents are all optional; nothing here blocks completion. */
export const onboardingStep5Schema = z.object({})

export const ONBOARDING_STEP_SCHEMAS = [
  onboardingStep1Schema,
  onboardingStep2Schema,
  onboardingStep3Schema,
  onboardingStep4Schema,
  onboardingStep5Schema,
] as const

/** Send the credential email? The only choice completion asks for. */
export const completeOnboardingSchema = z.object({
  sendCredentialsEmail: z.boolean().default(true),
})

/**
 * Create the account NOW and hand the rest of the form to the employee (014).
 *
 * Only what an account cannot exist without: a name to address them by and the
 * email that becomes their sign-in. Everything else the wizard collects is
 * exactly what the employee is being invited to fill in, so requiring any of it
 * here would defeat the point.
 */
export const inviteOnboardingSchema = z.object({
  sendCredentialsEmail: z.boolean().default(true),
})

/** Send a submitted onboarding back with a note saying what to fix. */
export const requestChangesSchema = z.object({
  notes: z
    .string()
    .trim()
    .min(1, 'Say what needs changing')
    .max(2000, 'Keep this under 2000 characters'),
})

/**
 * The three fields an invite cannot do without — checked against the draft the
 * org has typed so far, not against a separate form.
 */
export const inviteReadySchema = z.object({
  firstName: requiredText('Enter their first name', 80),
  lastName: requiredText('Enter their last name', 80),
  personalEmail: emailSchema,
})

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

export const clockActionSchema = z.object({
  action: z.enum(['in', 'out']),
})

// ---------------------------------------------------------------------------
// Leaves
// ---------------------------------------------------------------------------

export const applyLeaveSchema = z
  .object({
    startDate: isoDate,
    endDate: isoDate,
    reason: z.string().trim().min(5, 'Tell your manager why').max(2000),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: 'The end date cannot be before the start date',
    path: ['endDate'],
  })

export const decideLeaveSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  note: optionalText(500),
})

// ---------------------------------------------------------------------------
// Payroll
// ---------------------------------------------------------------------------

export const payslipSchema = z.object({
  employeeId: uuid,
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2200),
  key: z.string().trim().min(1).max(300),
  fileName: z.string().trim().min(1).max(255),
})

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

export const invoiceItemSchema = z.object({
  description: z.string().trim().min(1, 'Describe the line item').max(300),
  quantity: z.coerce.number().min(0).max(1_000_000),
  rate: z.coerce.number().min(0).max(100_000_000),
})

export const invoiceSchema = z.object({
  invoiceNumber: z.string().trim().min(1, 'Enter an invoice number').max(60),
  billTo: z.object({
    name: z.string().trim().min(1, 'Who is this invoice for?').max(160),
    email: z.string().trim().max(254).optional().or(z.literal('')),
    address: z.string().trim().max(500).optional().or(z.literal('')),
  }),
  items: z.array(invoiceItemSchema).min(1, 'Add at least one line item').max(100),
  currency: z.string().trim().length(3).toUpperCase().default('USD'),
  taxPercent: z.coerce.number().min(0).max(100).default(0),
  amountPaid: z.coerce.number().min(0).default(0),
  status: z.enum(['draft', 'sent', 'paid', 'overdue', 'cancelled']).default('draft'),
  issueDate: isoDate,
  dueDate: isoDate.nullable().optional(),
  notes: optionalText(2000),
})
export type InvoiceInput = z.infer<typeof invoiceSchema>

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const notificationSchema = z
  .object({
    title: z.string().trim().min(2, 'Give it a title').max(200),
    description: optionalText(4000),
    sendToType: z.enum(['all', 'department', 'employee']),
    targetId: uuid.nullable().optional(),
  })
  .refine((v) => v.sendToType === 'all' || !!v.targetId, {
    message: 'Choose who this goes to',
    path: ['targetId'],
  })

// ---------------------------------------------------------------------------
// Work authorization (H-1B)
// ---------------------------------------------------------------------------

export const workAuthSchema = z.object({
  employeeId: uuid,
  visaType: z.string().trim().min(1).max(40).default('H-1B'),
  visaNumber: optionalText(80),
  startDate: isoDate.nullable().optional(),
  expiryDate: isoDate,
  documentKey: optionalText(300),
  notes: optionalText(1000),
})

// ---------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------

export const meetingSchema = z
  .object({
    title: z.string().trim().min(2, 'Give the meeting a title').max(200),
    description: optionalText(4000),
    location: optionalText(300),
    startTime: z.string().datetime({ offset: true }),
    endTime: z.string().datetime({ offset: true }),
    attendees: z
      .array(z.object({ email: emailSchema, name: z.string().trim().max(120).optional() }))
      .max(50)
      .default([]),
  })
  .refine((v) => new Date(v.endTime) > new Date(v.startTime), {
    message: 'The meeting must end after it starts',
    path: ['endTime'],
  })

// ---------------------------------------------------------------------------
// Kanban
// ---------------------------------------------------------------------------

export const boardColumnSchema = z.object({
  name: z.string().trim().min(1, 'Name the column').max(60),
})

export const taskSchema = z.object({
  boardId: uuid,
  columnId: uuid,
  title: z.string().trim().min(2, 'Give the task a title').max(200),
  description: optionalText(4000),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  dueDate: isoDate.nullable().optional(),
  assigneeIds: z.array(uuid).max(20).default([]),
})

/** A drag-drop persist. `position` is fractional so a move writes one row. */
export const moveTaskSchema = z.object({
  columnId: uuid,
  position: z.number().finite(),
})

// ---------------------------------------------------------------------------
// Uploads (two-phase: presign then finalize)
// ---------------------------------------------------------------------------

export const presignSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(160),
  sizeBytes: z.number().int().positive().max(50 * 1024 * 1024),
  purpose: z.enum(['photo', 'payslip', 'employee_doc', 'work_auth', 'logo', 'general']),
})

export const finalizeUploadSchema = z.object({
  key: z.string().trim().min(1).max(300),
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(160),
  purpose: z.enum(['photo', 'payslip', 'employee_doc', 'work_auth', 'logo', 'general']),
  employeeId: uuid.nullable().optional(),
})

// ---------------------------------------------------------------------------
// Super admin
// ---------------------------------------------------------------------------

export const tenantStatusSchema = z.object({
  status: z.enum(['active', 'suspended']),
  reason: optionalText(500),
})

export const userActivationSchema = z.object({
  isActive: z.boolean(),
  reason: optionalText(500),
})

// ---------------------------------------------------------------------------
// Projects
//
// `code` is absent on purpose: PRJ-001 is minted by a database trigger from a
// per-tenant counter, so there is no request shape that can choose its own id or
// collide with another project's.
// ---------------------------------------------------------------------------

export const PROJECT_STATUSES = ['active', 'inactive', 'completed'] as const

export const projectSchema = z
  .object({
    name: z.string().trim().min(2, 'Name the project').max(160),
    clientName: optionalText(160),
    endClientName: optionalText(160),
    description: optionalText(2000),
    startDate: isoDate.nullable().optional(),
    endDate: isoDate.nullable().optional(),
    status: z.enum(PROJECT_STATUSES).default('active'),
    employeeIds: z.array(uuid).max(200).default([]),
  })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, {
    message: 'The end date cannot be before the start date',
    path: ['endDate'],
  })
export type ProjectInput = z.infer<typeof projectSchema>

// ---------------------------------------------------------------------------
// Timesheets
//
// The grid is posted as a WHOLE WEEK, not cell by cell. One save is one
// request: the entry rows are replaced with exactly what the form holds, so a
// deleted line disappears instead of lingering as an orphan the totals would
// still count.
// ---------------------------------------------------------------------------

/**
 * A single day's hours.
 *
 * Rounded to two decimals here rather than left to the column. `hours_sun` is
 * `numeric(5,2)`, so 2.555 would be stored as 2.56 and the grid would come back
 * showing a figure nobody typed. Rounding on the way in makes what is saved and
 * what is displayed the same number.
 */
const dayHours = z.coerce
  .number({ invalid_type_error: 'Enter a number of hours' })
  .min(0, 'Hours cannot be negative')
  .max(24, 'A day has 24 hours')
  .default(0)
  .transform((v) => Math.round(v * 100) / 100)

/** Sunday-first, matching the grid and `week_start`. Used for the daily caps. */
export const TIMESHEET_DAY_KEYS = [
  'hoursSun', 'hoursMon', 'hoursTue', 'hoursWed', 'hoursThu', 'hoursFri', 'hoursSat',
] as const

export const TIMESHEET_DAY_LABELS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
] as const

export const timesheetEntrySchema = z
  .object({
    projectId: uuid.nullable().optional(),
    taskName: optionalText(200),
    billable: z.boolean().default(true),
    hoursSun: dayHours,
    hoursMon: dayHours,
    hoursTue: dayHours,
    hoursWed: dayHours,
    hoursThu: dayHours,
    hoursFri: dayHours,
    hoursSat: dayHours,
  })
  /*
   * A line has to say what the hours were FOR. Unlabelled hours cannot be
   * approved by anyone — the reviewer has nothing to agree with — and cannot be
   * billed to a client afterwards. The employee may satisfy this either way, so
   * someone with no project assignments can still file a week by describing the
   * work.
   *
   * An ENTIRELY empty line is exempt, and that exemption is load-bearing: the
   * grid always keeps one blank row at the bottom so adding work never starts
   * with a click on "Add a line". Refusing it here would make an untouched grid
   * unsaveable, and the route that drops blank lines before writing them would
   * never get the chance to run.
   */
  .refine((v) => isBlankEntry(v) || !!v.projectId || !!v.taskName, {
    message: 'Pick a project or describe the task for this line',
    path: ['taskName'],
  })

/** No project, no task, no hours — the form's trailing placeholder row. */
export function isBlankEntry(entry: {
  projectId?: string | null
  taskName?: string | null
  hoursSun: number; hoursMon: number; hoursTue: number; hoursWed: number
  hoursThu: number; hoursFri: number; hoursSat: number
}): boolean {
  return (
    !entry.projectId &&
    !entry.taskName &&
    TIMESHEET_DAY_KEYS.every((key) => !entry[key])
  )
}

export const createTimesheetSchema = z.object({
  /** Any date inside the week; the server normalises it to that week's Sunday. */
  weekStart: isoDate,
})

export const saveTimesheetSchema = z
  .object({
    entries: z.array(timesheetEntrySchema).max(60, 'That is too many lines for one week'),
    comments: optionalText(4000),
    attachmentKey: optionalText(300),
    attachmentName: optionalText(255),
    /** True turns the draft in. The status change is re-checked server-side. */
    submit: z.boolean().default(false),
  })
  /*
   * A DAY cannot exceed 24 hours across the whole grid.
   *
   * The column check only bounds one cell of one line, so six lines of five
   * hours on the same Tuesday passes every per-cell rule and still claims thirty
   * hours in a day. The cap belongs here because it is the only place that sees
   * the whole week at once, and the error is pinned to the first offending cell
   * so the grid can point at it.
   */
  .superRefine((value, ctx) => {
    TIMESHEET_DAY_KEYS.forEach((key, dayIndex) => {
      const total = value.entries.reduce((sum, entry) => sum + (entry[key] || 0), 0)
      if (total > 24) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${TIMESHEET_DAY_LABELS[dayIndex]} adds up to ${total} hours — a day cannot exceed 24.`,
          path: ['entries', 0, key],
        })
      }
    })
  })
export type SaveTimesheetInput = z.infer<typeof saveTimesheetSchema>

export const reviewTimesheetSchema = z
  .object({
    status: z.enum(['approved', 'rejected']),
    note: optionalText(2000),
  })
  .refine((v) => v.status !== 'rejected' || !!v.note, {
    message: 'Tell them what needs changing',
    path: ['note'],
  })

// ---------------------------------------------------------------------------
// Help desk
// ---------------------------------------------------------------------------

export const TICKET_PRIORITIES = ['low', 'medium', 'high'] as const
export const TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const

export const ticketSchema = z.object({
  subject: z.string().trim().min(3, 'Give it a subject').max(200),
  description: z.string().trim().min(5, 'Describe what you need').max(8000),
  priority: z.enum(TICKET_PRIORITIES).default('medium'),
  attachmentKey: optionalText(300),
  attachmentName: optionalText(255),
})

export const ticketMessageSchema = z.object({
  body: z.string().trim().min(1, 'Write a reply').max(8000),
  attachmentKey: optionalText(300),
  attachmentName: optionalText(255),
})

export const ticketStatusSchema = z.object({
  status: z.enum(TICKET_STATUSES),
})

// ---------------------------------------------------------------------------
// Employee profile — experience, education, skills
// ---------------------------------------------------------------------------

export const experienceSchema = z
  .object({
    companyName: z.string().trim().min(1, 'Enter the company').max(160),
    roleTitle: z.string().trim().min(1, 'Enter the role').max(160),
    startDate: isoDate.nullable().optional(),
    endDate: isoDate.nullable().optional(),
    isCurrent: z.boolean().default(false),
    summary: optionalText(2000),
  })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, {
    message: 'The end date cannot be before the start date',
    path: ['endDate'],
  })

export const educationSchema = z.object({
  institution: z.string().trim().min(1, 'Enter the institution').max(160),
  degree: z.string().trim().min(1, 'Enter the degree').max(160),
  fieldOfStudy: optionalText(160),
  completionYear: z.coerce
    .number()
    .int()
    .min(1900, 'Enter a four-digit year')
    .max(2200, 'Enter a four-digit year')
    .nullable()
    .optional(),
})

/** Tags are deduplicated and trimmed here so the pill row cannot show twins. */
export const skillsSchema = z.object({
  skills: z
    .array(z.string().trim().min(1).max(40))
    .max(50, 'Keep it to fifty skills')
    .default([])
    .transform((tags) => {
      const seen = new Set<string>()
      const out: string[] = []
      for (const tag of tags) {
        const key = tag.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        out.push(tag)
      }
      return out
    }),
})

// ---------------------------------------------------------------------------
// Company details — what a generated letterhead prints
// ---------------------------------------------------------------------------

export const companyDetailsSchema = z.object({
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  city: optionalText(80),
  stateProvince: optionalText(80),
  postalCode: optionalText(20),
  country: optionalText(80),
  registrationNumber: optionalText(60),
  companyEmail: z
    .string()
    .trim()
    .max(254)
    .optional()
    .transform((v) => (v ? v.toLowerCase() : null))
    .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Enter a valid email address'),
  companyPhone: optionalText(40),
  website: optionalText(200),
  signatoryName: optionalText(120),
  signatoryTitle: optionalText(120),
  signatoryPhone: optionalText(40),
})

// ---------------------------------------------------------------------------
// Generated documents (offer letters / agreements)
//
// The PDF itself is built in the browser and uploaded through the ordinary
// two-phase pipeline; this records the RESULT. `payload` is the form that
// produced it, kept so a letter can be reissued with one field changed rather
// than retyped from scratch.
// ---------------------------------------------------------------------------

export const GENERATED_DOCUMENT_TYPES = [
  'offer_letter',
  'employment_agreement',
  'internship_offer',
] as const

export const generatedDocumentSchema = z.object({
  employeeId: uuid,
  docType: z.enum(GENERATED_DOCUMENT_TYPES),
  title: z.string().trim().min(1).max(200),
  key: z.string().trim().min(1).max(300),
  fileName: z.string().trim().min(1).max(255),
  documentId: uuid.nullable().optional(),
  payload: z.record(z.unknown()).default({}),
})

// ---------------------------------------------------------------------------
// Jobs
//
// `status` is absent from `jobSchema` on purpose. Publishing is a decision, not
// a field: it moves through PATCH /api/org/jobs/[id] with its own schema, so a
// create form cannot accidentally push a half-written posting onto a public page
// by sending one extra key.
// ---------------------------------------------------------------------------

export const JOB_TYPES = ['full_time', 'part_time', 'contract', 'internship', 'temporary'] as const
export const JOB_WORKPLACES = ['onsite', 'remote', 'hybrid'] as const
export const JOB_STATUSES = ['draft', 'published', 'closed'] as const
export const SALARY_PERIODS = ['hour', 'day', 'month', 'year'] as const

export const APPLICATION_STATUSES = [
  'new', 'reviewing', 'shortlisted', 'interviewing', 'offered', 'hired', 'rejected',
] as const

/** A number field that arrives from a form as '' when the user left it blank. */
const optionalNumber = (max: number, message: string) =>
  z
    .union([z.coerce.number(), z.literal('')])
    .optional()
    .transform((v) => (v === '' || v === undefined || Number.isNaN(v) ? null : Number(v)))
    .refine((v) => v === null || (v >= 0 && v <= max), message)

export const jobSchema = z
  .object({
    title: z.string().trim().min(2, 'Give the role a title').max(160),
    description: z
      .string()
      .trim()
      .min(20, 'Describe the role in at least a couple of sentences')
      .max(20000),
    responsibilities: optionalText(10000),
    requirements: optionalText(10000),
    departmentId: uuid.nullable().optional(),
    employmentType: z.enum(JOB_TYPES).default('full_time'),
    workplace: z.enum(JOB_WORKPLACES).default('onsite'),
    location: optionalText(160),
    experienceMin: optionalNumber(60, 'Enter years of experience between 0 and 60'),
    experienceMax: optionalNumber(60, 'Enter years of experience between 0 and 60'),
    salaryMin: optionalNumber(1_000_000_000, 'Enter a salary of 0 or more'),
    salaryMax: optionalNumber(1_000_000_000, 'Enter a salary of 0 or more'),
    salaryCurrency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code, e.g. INR')
      .default('INR'),
    salaryPeriod: z.enum(SALARY_PERIODS).default('year'),
    salaryDisclosed: z.boolean().default(false),
    openings: z.coerce.number().int().min(1, 'There is at least one opening').max(999).default(1),
    skills: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
    closesAt: isoDate.nullable().optional(),
  })
  .refine((v) => v.experienceMin === null || v.experienceMax === null || v.experienceMax >= v.experienceMin, {
    message: 'The maximum experience cannot be below the minimum',
    path: ['experienceMax'],
  })
  .refine((v) => v.salaryMin === null || v.salaryMax === null || v.salaryMax >= v.salaryMin, {
    message: 'The maximum salary cannot be below the minimum',
    path: ['salaryMax'],
  })
  /*
   * You may not advertise a band you have not entered. Without this, ticking
   * "show the salary" on an empty pair publishes a posting whose salary line
   * reads as blank — which candidates read as "they are hiding it", the exact
   * impression the tick box was meant to avoid.
   */
  .refine((v) => !v.salaryDisclosed || v.salaryMin !== null || v.salaryMax !== null, {
    message: 'Enter a salary range, or turn off showing it on the posting',
    path: ['salaryMin'],
  })
export type JobInput = z.infer<typeof jobSchema>

export const jobStatusSchema = z.object({
  status: z.enum(JOB_STATUSES),
})

// ---------------------------------------------------------------------------
// Applications
//
// This is the ONLY schema in this file parsed on behalf of someone who is not a
// user of this product and may never become one. Everything about it is
// therefore stricter than the org-facing shapes above: bounded lengths on every
// free-text field, and a URL check that refuses anything but http(s) so a
// `javascript:` link cannot be stored and later rendered into an org's inbox.
// ---------------------------------------------------------------------------

const httpUrl = (message: string) =>
  z
    .string()
    .trim()
    .max(400)
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^https?:\/\/\S+$/i.test(v), message)

export const jobApplicationSchema = z.object({
  jobId: uuid,
  fullName: z.string().trim().min(2, 'Enter your full name').max(120),
  email: emailSchema,
  phone: optionalText(40),
  location: optionalText(160),
  linkedinUrl: httpUrl('Enter a full LinkedIn address starting with https://'),
  portfolioUrl: httpUrl('Enter a full web address starting with https://'),
  coverLetter: optionalText(8000),
  yearsExperience: optionalNumber(60, 'Enter years of experience between 0 and 60'),
  currentCompany: optionalText(160),
  noticePeriod: optionalText(80),
  resumeKey: optionalText(300),
  resumeName: optionalText(255),
  /*
   * The honeypot. Rendered off-screen and unlabelled, so a person never sees it
   * and a form-filling bot cannot resist it. Anything here means the submission
   * is discarded — silently, with a 200, because telling a bot why it failed is
   * how it learns to pass.
   */
  website: z.string().max(200).optional(),
})
export type JobApplicationInput = z.infer<typeof jobApplicationSchema>

export const applicationReviewSchema = z.object({
  status: z.enum(APPLICATION_STATUSES).optional(),
  notes: optionalText(8000),
})

/**
 * The anonymous presign request.
 *
 * Narrower than `presignSchema` in every dimension, because the caller is
 * unauthenticated: one purpose rather than six, a 10MB ceiling rather than 50,
 * and a `jobId` so an upload URL is only ever minted against a real posting.
 */
export const resumePresignSchema = z.object({
  jobId: uuid,
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(160),
  sizeBytes: z.number().int().positive().max(10 * 1024 * 1024, 'Keep your CV under 10MB'),
})
