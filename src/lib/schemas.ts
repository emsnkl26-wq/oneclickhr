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
  /**
   * What a NEW employee inherits (025). Changing it never moves anybody who
   * already exists — their mode is their own column, set when they were added.
   *
   * `''` is "not set", and it is the DEFAULT. An org that has never opened this
   * screen has expressed no preference, and inventing one for them would hand
   * every new employee a restriction nobody asked for — see the header of 025.
   */
  defaultTrackingMode: z
    .enum(['clock_in', 'timesheet', 'none', ''])
    .optional()
    .transform((v) => (v ? v : null)),
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
  .extend({
    isActive: z.boolean().optional(),
    /**
     * How this person tracks time (025). Org-set; see `tg_profiles_guard`.
     *
     * `''` clears it back to "not set", which is what restores their full
     * sidebar. Without a way back, assigning a mode by accident would be a
     * one-way door.
     */
    trackingMode: z
      .enum(['clock_in', 'timesheet', 'none', ''])
      .optional()
      .transform((v) => (v === undefined ? undefined : v || null)),
  })

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

/**
 * What an extra onboarding document usually is. Free text stays possible via
 * "Other" — the point of the list is that a folder of `scan_002.pdf` files is
 * useless to whoever opens the profile later.
 */
export const DOCUMENT_LABELS = [
  'Degree certificate',
  'Experience letter',
  'Relieving letter',
  'Payslip',
  'Visa copy',
  'Work permit',
  'Address proof',
  'Certification',
  'Other',
] as const

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

/**
 * Step 5 — uploading a document is optional, but naming one you DID upload is
 * not: an unlabelled file is unidentifiable once it is sitting on the profile.
 */
export const onboardingStep5Schema = z.object({
  additionalDocs: z
    .array(additionalDocSchema)
    .default([])
    .refine((docs) => docs.every((d) => d.label), {
      message: 'Say what each uploaded document is',
    }),
})

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

export const taskPriority = z.enum(['low', 'medium', 'high', 'urgent'])
export const taskStatus = z.enum([
  'todo', 'in_progress', 'blocked', 'in_review', 'done', 'cancelled',
])

/**
 * A stage on the board.
 *
 * `appliesStatus` is what makes a column more than a heading: dropping a card
 * here sets that status. Nullable, because a team's "Waiting on client" column
 * genuinely has no equivalent in the product's vocabulary and should not be
 * forced into one.
 */
export const boardColumnSchema = z.object({
  name: z.string().trim().min(1, 'Name the column').max(60),
  color: hexColor.nullable().optional(),
  wipLimit: z
    .number()
    .int('Use a whole number')
    .min(1, 'A limit of zero would refuse every card')
    .max(999)
    .nullable()
    .optional(),
  appliesStatus: taskStatus.nullable().optional(),
  isBacklog: z.boolean().optional(),
})

/** Reordering the columns themselves. Fractional, like a card move. */
export const moveColumnSchema = z.object({
  position: z.number().finite(),
})

export const taskLabelSchema = z.object({
  name: z.string().trim().min(1, 'Name the label').max(40),
  color: hexColor.default('#64748B'),
})

/**
 * The date order is cross-checked here as well as by a table constraint. The
 * constraint is what BINDS; this is what produces a sentence the person can act
 * on instead of a generic 400.
 *
 * ISO dates compare correctly as strings — that is the whole point of the
 * format — so no parsing is needed to order them.
 */
const datesInOrder = {
  check: (v: { startDate?: string | null; dueDate?: string | null }) =>
    !v.startDate || !v.dueDate || v.startDate <= v.dueDate,
  message: {
    message: 'The start date cannot be after the due date',
    path: ['startDate'],
  },
}

export const taskSchema = z.object({
  boardId: uuid,
  columnId: uuid,
  title: z.string().trim().min(2, 'Give the task a title').max(200),
  description: optionalText(20000),
  priority: taskPriority.default('medium'),
  // Omitted means "whatever the column implies" — resolved by the insert
  // trigger, not guessed here.
  status: taskStatus.optional(),
  dueDate: isoDate.nullable().optional(),
  startDate: isoDate.nullable().optional(),
  estimateHours: z.number().min(0).max(10000).nullable().optional(),
  assigneeIds: z.array(uuid).max(20).default([]),
  labelIds: z.array(uuid).max(20).default([]),
  checklist: z.array(z.string().trim().min(1).max(300)).max(50).default([]),
}).refine(datesInOrder.check, datesInOrder.message)

/**
 * Editing a card.
 *
 * Every field is optional and every one distinguishes "absent" from "null":
 * absent leaves the column alone, null clears it. A PATCH that cannot express
 * "remove the due date" makes the field one-way, and a PATCH that treats absent
 * as null wipes whatever the form did not happen to render.
 */
export const updateTaskSchema = z.object({
  title: z.string().trim().min(2, 'Give the task a title').max(200).optional(),
  description: z.string().trim().max(20000).nullable().optional(),
  priority: taskPriority.optional(),
  status: taskStatus.optional(),
  columnId: uuid.optional(),
  position: z.number().finite().optional(),
  dueDate: isoDate.nullable().optional(),
  startDate: isoDate.nullable().optional(),
  estimateHours: z.number().min(0).max(10000).nullable().optional(),
  assigneeIds: z.array(uuid).max(20).optional(),
  labelIds: z.array(uuid).max(20).optional(),
  archived: z.boolean().optional(),
}).refine(datesInOrder.check, datesInOrder.message)

export const taskCommentSchema = z.object({
  body: z.string().trim().min(1, 'Write something first').max(8000),
  /** Present = a reply. The database refuses a parent that is itself a reply. */
  parentId: uuid.nullable().optional(),
})

export const updateCommentSchema = z.object({
  body: z.string().trim().min(1, 'Write something first').max(8000),
})

export const checklistItemSchema = z.object({
  content: z.string().trim().min(1, 'Describe the step').max(300),
})

export const updateChecklistItemSchema = z
  .object({
    content: z.string().trim().min(1).max(300).optional(),
    isDone: z.boolean().optional(),
    position: z.number().finite().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' })

// ---------------------------------------------------------------------------
// Uploads (two-phase: presign then finalize)
// ---------------------------------------------------------------------------

export const presignSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(160),
  sizeBytes: z.number().int().positive().max(50 * 1024 * 1024),
  purpose: z.enum(['photo', 'payslip', 'payment_proof', 'employee_doc', 'work_auth', 'logo', 'general']),
})

export const finalizeUploadSchema = z.object({
  key: z.string().trim().min(1).max(300),
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(160),
  purpose: z.enum(['photo', 'payslip', 'payment_proof', 'employee_doc', 'work_auth', 'logo', 'general']),
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
  /**
   * Who the week was worked for. Omitted means "use my primary assignment",
   * which is what someone on a single placement always wants.
   */
  assignmentId: uuid.nullable().optional(),
})

export const saveTimesheetSchema = z
  .object({
    entries: z.array(timesheetEntrySchema).max(60, 'That is too many lines for one week'),
    /**
     * Renamed from `comments` in 023, and required at submit — see the refine
     * below. The column, the API and the label all had to move together, so
     * this is a rename rather than a second field.
     */
    weeklyLearnings: optionalText(4000),
    /** Who the week was worked for. Changeable while the sheet is still open. */
    vendorId: uuid.nullable().optional(),
    clientId: uuid.nullable().optional(),
    assignmentId: uuid.nullable().optional(),
    attachmentKey: optionalText(300),
    attachmentName: optionalText(255),
    /** True turns the draft in. The status change is re-checked server-side. */
    submit: z.boolean().default(false),
  })
  /*
   * Weekly learnings are mandatory to SUBMIT, and irrelevant until then.
   *
   * Tying it to `submit` rather than making the field required outright is what
   * keeps an ordinary mid-week save working: nobody has anything to write on
   * Monday morning, and a form that refuses to save until they invent something
   * teaches people to type "n/a".
   *
   * The database says the same thing in the 023 guard trigger. This copy exists
   * to put the message under the box instead of returning a constraint error.
   */
  .refine((v) => !v.submit || !!v.weeklyLearnings?.trim(), {
    message: 'Add your learnings for the week before submitting',
    path: ['weeklyLearnings'],
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

/**
 * A generated letter names a RECIPIENT, and only sometimes an employee.
 *
 * Offer letters are sent before the person exists in the system — they accept,
 * then they onboard — so `employeeId` is optional and only carries a value when
 * the document was generated from an existing employee's page.
 */
export const generatedDocumentSchema = z.object({
  employeeId: uuid.nullable().optional(),
  recipientName: z.string().trim().min(1).max(160),
  recipientEmail: z.string().trim().email().max(200).optional().or(z.literal('')),
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

/**
 * A number field that arrives from a form as '' when the user left it blank.
 *
 * `z.literal('')` comes FIRST for the reason spelled out on `optionalMoney`
 * below: `z.coerce.number()` turns `''` into `0`, so with the branches the
 * other way round a blank salary box was stored as a salary of zero — and
 * `salaryDisclosed`'s "you may not advertise a band you have not entered" check
 * then passed on a posting with no band in it.
 */
const optionalNumber = (max: number, message: string) =>
  z
    .union([z.literal(''), z.coerce.number()])
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
    /*
     * The structured location (021). `location` itself is NOT accepted from the
     * client any more: it is the one-line display string, and the server derives
     * it from these four so that two postings with the same parts can never read
     * differently. A stale tab that still sends `location` has it ignored.
     */
    country: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, 'Choose a country')
      .nullish()
      .transform((v) => v || null),
    state: optionalText(100),
    city: optionalText(100),
    address: optionalText(200),
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

// ---------------------------------------------------------------------------
// Vendors, clients and placements (022)
//
// `billRate` appears in the ASSIGNMENT schema and nowhere else an employee can
// reach. Every endpoint accepting this shape is org-guarded; see the header of
// 022 for why that matters more here than elsewhere.
// ---------------------------------------------------------------------------

export const PARTY_STATUSES = ['active', 'inactive'] as const
export const RATE_UNITS = ['hour', 'day', 'month', 'year'] as const
export const ASSIGNMENT_STATUSES = ['active', 'ended'] as const

const currencyCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code, e.g. USD')

/**
 * A money figure typed into a form, where an empty box means "not set".
 *
 * `z.literal('')` COMES FIRST, and the order is the whole correctness of this.
 * A union returns its first successful branch, and `z.coerce.number()` happily
 * coerces `''` to `0` — so with the branches the other way round an empty bill
 * rate becomes a rate of zero, and the next invoice is raised for nothing at
 * all. Putting the literal first means "" stays "" and reaches the transform,
 * which is the only place that decides what empty means.
 */
const optionalMoney = (message: string) =>
  z
    .union([z.literal(''), z.coerce.number()])
    .optional()
    .transform((v) => (v === '' || v === undefined || Number.isNaN(v) ? null : Number(v)))
    .refine((v) => v === null || (v >= 0 && v <= 100_000_000), message)

const partyAddressSchema = z
  .object({
    line1: optionalText(160),
    line2: optionalText(160),
    city: optionalText(80),
    state: optionalText(80),
    postalCode: optionalText(20),
    country: optionalText(80),
  })
  .partial()
  .default({})

const optionalEmail = z
  .union([emailSchema, z.literal('')])
  .optional()
  .transform((v) => v || null)

export const vendorSchema = z.object({
  name: z.string().trim().min(1, 'Enter the vendor name').max(160),
  contactName: optionalText(120),
  email: optionalEmail,
  phone: optionalText(40),
  address: partyAddressSchema,
  paymentTermsDays: z.coerce
    .number()
    .int()
    .min(0, 'Payment terms cannot be negative')
    .max(365, 'That is more than a year')
    .default(30),
  notes: optionalText(4000),
  status: z.enum(PARTY_STATUSES).default('active'),
})
export type VendorInput = z.infer<typeof vendorSchema>

export const clientSchema = z.object({
  name: z.string().trim().min(1, 'Enter the client name').max(160),
  contactName: optionalText(120),
  email: optionalEmail,
  address: partyAddressSchema,
  notes: optionalText(4000),
  status: z.enum(PARTY_STATUSES).default('active'),
})
export type ClientInput = z.infer<typeof clientSchema>

export const assignmentSchema = z
  .object({
    employeeId: uuid,
    vendorId: uuid,
    clientId: uuid.nullable().optional(),
    projectId: uuid.nullable().optional(),
    /** What the VENDOR is invoiced. Never leaves an org-guarded route. */
    billRate: optionalMoney('Enter a bill rate of 0 or more'),
    billCurrency: currencyCode.default('USD'),
    /** What the EMPLOYEE is paid. */
    payRate: optionalMoney('Enter a pay rate of 0 or more'),
    payCurrency: currencyCode.default('USD'),
    rateUnit: z.enum(RATE_UNITS).default('hour'),
    startDate: isoDate.nullable().optional(),
    endDate: isoDate.nullable().optional(),
    isPrimary: z.boolean().default(false),
    status: z.enum(ASSIGNMENT_STATUSES).default('active'),
    notes: optionalText(4000),
  })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, {
    message: 'The end date cannot be before the start date',
    path: ['endDate'],
  })
  /*
   * Paying someone more than we bill for them is not forbidden — a trainee
   * placement can genuinely run at a loss — but it is almost always a typo, and
   * finding out at invoice time is expensive. Only checked when the two rates
   * share a currency, because comparing 40 USD to 3000 INR means nothing.
   */
  .refine(
    (v) =>
      v.billRate === null ||
      v.payRate === null ||
      v.billCurrency !== v.payCurrency ||
      v.payRate <= v.billRate,
    {
      message: 'The pay rate is above the bill rate. Check both figures.',
      path: ['payRate'],
    }
  )
export type AssignmentInput = z.infer<typeof assignmentSchema>

// ---------------------------------------------------------------------------
// Invoicing from approved timesheets (024)
// ---------------------------------------------------------------------------

export const invoiceFromTimesheetsSchema = z.object({
  timesheetIds: z
    .array(uuid)
    .min(1, 'Choose at least one timesheet')
    .max(100, 'That is too many weeks for one invoice'),
  invoiceNumber: optionalText(40),
  issueDate: isoDate.optional(),
  dueDate: isoDate.nullable().optional(),
  taxPercent: z.coerce.number().min(0).max(100).default(0),
  notes: optionalText(4000),
})
export type InvoiceFromTimesheetsInput = z.infer<typeof invoiceFromTimesheetsSchema>

// ---------------------------------------------------------------------------
// Payroll — the employee confirms they were paid (026)
// ---------------------------------------------------------------------------

export const paymentConfirmationSchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
  amount: optionalMoney('Enter an amount of 0 or more'),
  currency: z.union([currencyCode, z.literal('')]).optional().transform((v) => v || null),
  paidOn: isoDate.nullable().optional(),
  fileKey: z.string().trim().min(1, 'Attach the payment confirmation').max(300),
  fileName: optionalText(255),
  note: optionalText(2000),
})
export type PaymentConfirmationInput = z.infer<typeof paymentConfirmationSchema>

export const reviewPaymentSchema = z
  .object({
    status: z.enum(['verified', 'rejected']),
    note: optionalText(2000),
  })
  .refine((v) => v.status !== 'rejected' || !!v.note, {
    message: 'Tell them what is wrong with it',
    path: ['note'],
  })

// ---------------------------------------------------------------------------
// How an employee's time is tracked (025)
// ---------------------------------------------------------------------------

export const TRACKING_MODES = ['clock_in', 'timesheet', 'none'] as const
export const trackingModeSchema = z.enum(TRACKING_MODES)

// ---------------------------------------------------------------------------
// Organization admins (027)
// ---------------------------------------------------------------------------

export const inviteAdminSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter their name').max(120),
  email: emailSchema,
  sendCredentialsEmail: z.boolean().default(true),
})
export type InviteAdminInput = z.infer<typeof inviteAdminSchema>

// ---------------------------------------------------------------------------
// Platform support (028)
// ---------------------------------------------------------------------------

export const SUPPORT_CATEGORIES = ['bug', 'feature', 'billing', 'account', 'other'] as const
export const SUPPORT_STATUSES = ['new', 'in_progress', 'resolved'] as const

export const supportRequestSchema = z.object({
  category: z.enum(SUPPORT_CATEGORIES).default('other'),
  subject: z.string().trim().min(1, 'Give it a subject').max(200),
  message: z.string().trim().min(5, 'Tell us a little more').max(5000),
  /**
   * Where they were when they hit it. Client-supplied and therefore untrusted:
   * bounded here, and only ever RENDERED AS TEXT in the super-admin console —
   * never turned into a link, because a support form that can plant a clickable
   * URL in an admin's browser is a phishing vector aimed at us.
   */
  pageUrl: optionalText(500),
})
export type SupportRequestInput = z.infer<typeof supportRequestSchema>

export const supportStatusSchema = z.object({
  status: z.enum(SUPPORT_STATUSES),
  resolutionNote: optionalText(5000),
})
