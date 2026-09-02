/**
 * The onboarding wizard's shape, in ONE place.
 *
 * Six steps × ~60 fields is exactly the kind of surface where a form and its
 * read-only review drift apart — someone adds "home phone" to step 1 and the
 * review card silently never shows it. So the steps are DATA here: the form
 * renders from this config, the review grid renders from this config, and the
 * sidebar counts its error badges from this config. Adding a field is one entry.
 *
 * Client-safe on purpose (no `server-only`): the wizard is a client component
 * and the API handlers both import it, and the camelCase ⇄ snake_case mapping
 * has to agree across that boundary or a save silently drops a column.
 */
import {
  ACCOUNT_TYPES, EMPLOYMENT_STATUSES, EMPLOYMENT_TYPES, GENDERS, ID_PROOF_TYPES,
  NON_VISA_STATUSES, PAY_FREQUENCIES, PAY_TYPES, PRONOUNS, WORK_AUTH_STATUSES,
  ONBOARDING_STEP_SCHEMAS, type AdditionalDoc,
} from '@/lib/schemas'

export type { AdditionalDoc }

/** The wizard's working copy of a draft. Strings throughout — form values. */
export interface OnboardingDraft {
  // Step 1
  firstName: string
  middleName: string
  lastName: string
  dateOfBirth: string
  gender: string
  preferredFirstName: string
  preferredLastName: string
  pronouns: string
  streetAddress: string
  apartment: string
  city: string
  stateProvince: string
  zipPostal: string
  country: string
  phone: string
  homePhone: string
  personalEmail: string
  internalNotes: string
  // Step 2
  workAuthStatus: string
  visaType: string
  visaNumber: string
  visaStartDate: string
  visaExpiryDate: string
  authDocumentUrl: string
  // Step 3
  workPhone: string
  workEmail: string
  hireDate: string
  employmentStatus: string
  employeeCode: string
  departmentId: string
  designation: string
  reportingManagerId: string
  // Step 4
  payType: string
  payRate: string
  payFrequency: string
  employmentType: string
  bankName: string
  accountHolderName: string
  /** Plaintext, client-side only. Cleared once saved; the stored value is AES-GCM. */
  accountNumber: string
  routingCode: string
  accountType: string
  emergencyContactName: string
  emergencyRelationship: string
  emergencyPhone: string
  emergencyEmail: string
  // Step 5
  photoUrl: string
  resumeUrl: string
  offerLetterUrl: string
  idProofType: string
  idProofUrl: string
  additionalDocs: AdditionalDoc[]
  complianceNotes: string
}

export type DraftFieldKey = Exclude<keyof OnboardingDraft, 'additionalDocs'>

/**
 * camelCase ⇄ snake_case. `accountNumber` is deliberately ABSENT: it never
 * round-trips, because what the column holds is ciphertext, not the number.
 */
export const DRAFT_COLUMNS: Record<DraftFieldKey, string> = {
  firstName: 'first_name',
  middleName: 'middle_name',
  lastName: 'last_name',
  dateOfBirth: 'date_of_birth',
  gender: 'gender',
  preferredFirstName: 'preferred_first_name',
  preferredLastName: 'preferred_last_name',
  pronouns: 'pronouns',
  streetAddress: 'street_address',
  apartment: 'apartment',
  city: 'city',
  stateProvince: 'state_province',
  zipPostal: 'zip_postal',
  country: 'country',
  phone: 'phone',
  homePhone: 'home_phone',
  personalEmail: 'personal_email',
  internalNotes: 'internal_notes',
  workAuthStatus: 'work_auth_status',
  visaType: 'visa_type',
  visaNumber: 'visa_number',
  visaStartDate: 'visa_start_date',
  visaExpiryDate: 'visa_expiry_date',
  authDocumentUrl: 'auth_document_url',
  workPhone: 'work_phone',
  workEmail: 'work_email',
  hireDate: 'hire_date',
  employmentStatus: 'employment_status',
  employeeCode: 'employee_code',
  departmentId: 'department_id',
  designation: 'designation',
  reportingManagerId: 'reporting_manager_id',
  payType: 'pay_type',
  payRate: 'pay_rate',
  payFrequency: 'pay_frequency',
  employmentType: 'employment_type',
  bankName: 'bank_name',
  accountHolderName: 'account_holder_name',
  accountNumber: 'account_number_enc',
  routingCode: 'routing_code',
  accountType: 'account_type',
  emergencyContactName: 'emergency_contact_name',
  emergencyRelationship: 'emergency_relationship',
  emergencyPhone: 'emergency_phone',
  emergencyEmail: 'emergency_email',
  photoUrl: 'photo_url',
  resumeUrl: 'resume_url',
  offerLetterUrl: 'offer_letter_url',
  idProofType: 'id_proof_type',
  idProofUrl: 'id_proof_url',
  complianceNotes: 'compliance_notes',
}

/**
 * Columns a browser session may read. `account_number_enc` is excluded because
 * 008 revokes the column privilege outright — naming it here would 403 the
 * whole query, which is precisely the guardrail working.
 */
export const DRAFT_SELECT = [
  'id', 'status', 'current_step', 'completed_steps', 'created_at', 'updated_at',
  'employee_profile_id', 'completed_at', 'additional_docs',
  ...Object.entries(DRAFT_COLUMNS)
    .filter(([key]) => key !== 'accountNumber')
    .map(([, column]) => column),
].join(', ')

export function emptyDraft(overrides: Partial<OnboardingDraft> = {}): OnboardingDraft {
  const base = {} as OnboardingDraft
  for (const key of Object.keys(DRAFT_COLUMNS) as DraftFieldKey[]) base[key] = ''
  base.additionalDocs = []
  return { ...base, ...overrides }
}

/** A database row (snake_case, nulls) → the wizard's string-shaped draft. */
export function draftFromRow(row: Record<string, unknown>): OnboardingDraft {
  const draft = emptyDraft()
  for (const [key, column] of Object.entries(DRAFT_COLUMNS) as [DraftFieldKey, string][]) {
    if (key === 'accountNumber') continue // ciphertext never comes back
    const value = row[column]
    draft[key] = value === null || value === undefined ? '' : String(value)
  }
  draft.additionalDocs = Array.isArray(row.additional_docs)
    ? (row.additional_docs as AdditionalDoc[])
    : []
  return draft
}

// ---------------------------------------------------------------------------
// Step / field configuration
// ---------------------------------------------------------------------------

export type FieldType =
  | 'text' | 'email' | 'tel' | 'date' | 'select' | 'textarea' | 'currency'
  | 'account' | 'photo' | 'file' | 'files' | 'department' | 'manager'

export interface FieldDef {
  key: DraftFieldKey | 'additionalDocs'
  label: string
  type: FieldType
  required?: boolean
  options?: readonly string[]
  placeholder?: string
  hint?: string
  /** Sits in the two-column grid on desktop. Long fields stay full width. */
  half?: boolean
  /** Never shown to the employee — flagged in the UI so the org knows. */
  adminOnly?: boolean
}

export interface SectionDef {
  title: string
  hint?: string
  /** Muted info banner above the fields. */
  banner?: string
  /** Hidden unless the chosen work-authorization status implies a visa. */
  visaOnly?: boolean
  fields: FieldDef[]
}

export interface StepDef {
  /** 1-based, matching `current_step` in the database. */
  index: number
  title: string
  hint: string
  sections: SectionDef[]
}

export const ONBOARDING_STEPS: StepDef[] = [
  {
    index: 1,
    title: 'Personal information',
    hint: 'Who they are',
    sections: [
      {
        title: 'Legal identity',
        hint: 'As it appears on their government ID.',
        fields: [
          { key: 'firstName', label: 'First name', type: 'text', required: true, half: true },
          { key: 'middleName', label: 'Middle name', type: 'text', half: true },
          { key: 'lastName', label: 'Last name', type: 'text', required: true, half: true },
          { key: 'dateOfBirth', label: 'Date of birth', type: 'date', required: true, half: true },
          { key: 'gender', label: 'Gender', type: 'select', required: true, options: GENDERS, half: true },
        ],
      },
      {
        title: 'Preferred identity',
        banner: 'Optional — visible to the employee in their profile and directory.',
        fields: [
          { key: 'preferredFirstName', label: 'Preferred first name', type: 'text', half: true },
          { key: 'preferredLastName', label: 'Preferred last name', type: 'text', half: true },
          { key: 'pronouns', label: 'Pronouns', type: 'select', options: PRONOUNS, half: true },
        ],
      },
      {
        title: 'Home address',
        fields: [
          { key: 'streetAddress', label: 'Street address', type: 'text', required: true },
          { key: 'apartment', label: 'Apartment / suite / floor', type: 'text', half: true },
          { key: 'city', label: 'City', type: 'text', required: true, half: true },
          { key: 'stateProvince', label: 'State / province', type: 'text', required: true, half: true },
          { key: 'zipPostal', label: 'ZIP / postal code', type: 'text', required: true, half: true },
          { key: 'country', label: 'Country', type: 'select', required: true, options: COUNTRIES(), half: true },
        ],
      },
      {
        title: 'Contact',
        fields: [
          {
            key: 'phone', label: 'Phone number', type: 'tel', required: true, half: true,
            placeholder: '+1 555 0100',
          },
          { key: 'homePhone', label: 'Home phone', type: 'tel', half: true },
          {
            key: 'personalEmail', label: 'Personal email', type: 'email', required: true,
            hint: 'This becomes their sign-in email. It cannot be changed later.',
          },
        ],
      },
      {
        title: 'Additional',
        fields: [
          {
            key: 'internalNotes', label: 'Internal notes', type: 'textarea', adminOnly: true,
            hint: 'Only administrators can see this. The employee never does.',
          },
        ],
      },
    ],
  },
  {
    index: 2,
    title: 'Work authorization',
    hint: 'Visa and right to work',
    sections: [
      {
        title: 'Authorization status',
        fields: [
          {
            key: 'workAuthStatus', label: 'Work authorization status', type: 'select',
            required: true, options: WORK_AUTH_STATUSES,
          },
        ],
      },
      {
        title: 'Visa details',
        visaOnly: true,
        banner:
          'Visa expiry is tracked automatically. Admins receive reminders at 90, 30, 7 and 0 days before expiry.',
        fields: [
          { key: 'visaType', label: 'Visa type', type: 'text', half: true, placeholder: 'H-1B' },
          { key: 'visaNumber', label: 'Visa number', type: 'text', half: true },
          { key: 'visaStartDate', label: 'Visa start date', type: 'date', half: true },
          { key: 'visaExpiryDate', label: 'Visa expiry date', type: 'date', half: true },
          {
            key: 'authDocumentUrl', label: 'Authorization document', type: 'file',
            hint: 'PDF or image, up to 25MB.',
          },
        ],
      },
    ],
  },
  {
    index: 3,
    title: 'Employment details',
    hint: 'Role and department',
    sections: [
      {
        title: 'Work contact',
        hint: 'Optional — leave blank if it is not issued yet.',
        fields: [
          { key: 'workPhone', label: 'Work phone', type: 'tel', half: true },
          { key: 'workEmail', label: 'Work email', type: 'email', half: true },
        ],
      },
      {
        title: 'Hiring',
        fields: [
          { key: 'hireDate', label: 'Hire date', type: 'date', required: true, half: true },
          {
            key: 'employmentStatus', label: 'Employment status', type: 'select', required: true,
            options: EMPLOYMENT_STATUSES, half: true,
          },
          {
            key: 'employeeCode', label: 'Employee ID / code', type: 'text', half: true,
            hint: 'Must be unique in your workspace. Left blank, we generate one.',
          },
        ],
      },
      {
        title: 'Role',
        fields: [
          { key: 'departmentId', label: 'Department', type: 'department', required: true, half: true },
          {
            key: 'designation', label: 'Designation / job title', type: 'text', required: true,
            half: true, placeholder: 'Staff Nurse',
          },
          { key: 'reportingManagerId', label: 'Reporting manager', type: 'manager' },
        ],
      },
    ],
  },
  {
    index: 4,
    title: 'Compensation & banking',
    hint: 'Pay, bank and next of kin',
    sections: [
      {
        title: 'Compensation',
        fields: [
          { key: 'payType', label: 'Pay type', type: 'select', required: true, options: PAY_TYPES, half: true },
          { key: 'payRate', label: 'Pay rate', type: 'currency', required: true, half: true },
          {
            key: 'payFrequency', label: 'Pay frequency', type: 'select', required: true,
            options: PAY_FREQUENCIES, half: true,
          },
          {
            key: 'employmentType', label: 'Employment type', type: 'select', required: true,
            options: EMPLOYMENT_TYPES, half: true,
          },
        ],
      },
      {
        title: 'Bank details',
        banner: 'Bank details are encrypted and stored securely. Only admins can view them.',
        fields: [
          { key: 'bankName', label: 'Bank name', type: 'text', half: true },
          { key: 'accountHolderName', label: 'Account holder name', type: 'text', half: true },
          { key: 'accountNumber', label: 'Account number', type: 'account' },
          { key: 'routingCode', label: 'Routing / IFSC / SWIFT code', type: 'text', half: true },
          { key: 'accountType', label: 'Account type', type: 'select', options: ACCOUNT_TYPES, half: true },
        ],
      },
      {
        title: 'Emergency contact',
        fields: [
          { key: 'emergencyContactName', label: 'Contact name', type: 'text', required: true, half: true },
          {
            key: 'emergencyRelationship', label: 'Relationship', type: 'text', required: true,
            half: true, placeholder: 'Spouse',
          },
          { key: 'emergencyPhone', label: 'Phone', type: 'tel', required: true, half: true },
          { key: 'emergencyEmail', label: 'Email', type: 'email', half: true },
        ],
      },
    ],
  },
  {
    index: 5,
    title: 'Documents',
    hint: 'Photo, résumé and ID',
    sections: [
      {
        title: 'Photo',
        fields: [{ key: 'photoUrl', label: 'Profile photo', type: 'photo' }],
      },
      {
        title: 'Files',
        banner: 'PDFs are indexed for search once uploaded. Up to 25MB each.',
        fields: [
          { key: 'resumeUrl', label: 'Résumé / CV', type: 'file' },
          { key: 'offerLetterUrl', label: 'Offer letter', type: 'file' },
          { key: 'idProofType', label: 'ID proof type', type: 'select', options: ID_PROOF_TYPES, half: true },
          { key: 'idProofUrl', label: 'ID proof', type: 'file' },
          { key: 'additionalDocs', label: 'Additional documents', type: 'files' },
        ],
      },
      {
        title: 'Compliance',
        fields: [
          {
            key: 'complianceNotes', label: 'Compliance notes', type: 'textarea', adminOnly: true,
            hint: 'Only administrators can see this.',
          },
        ],
      },
    ],
  },
]

/** The review step is a seventh screen but not a data step — kept apart. */
export const REVIEW_STEP = 6
export const TOTAL_STEPS = 6

/** Does this status imply visa paperwork? Drives the conditional step-2 fields. */
export function needsVisaDetail(status: string): boolean {
  return !!status && !NON_VISA_STATUSES.includes(status)
}

/** Sections visible for the current draft (step 2 hides its detail conditionally). */
export function visibleSections(step: StepDef, draft: OnboardingDraft): SectionDef[] {
  return step.sections.filter((s) => !s.visaOnly || needsVisaDetail(draft.workAuthStatus))
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type StepErrors = Record<string, string>

/**
 * Validate ONE step against its Zod contract and return field-keyed messages.
 *
 * The same schemas run on the server at completion — this is the courtesy copy
 * that puts a message under the field while someone is typing.
 */
export function validateStep(stepIndex: number, draft: OnboardingDraft): StepErrors {
  const schema = ONBOARDING_STEP_SCHEMAS[stepIndex - 1]
  if (!schema) return {}

  const result = schema.safeParse(candidateFor(stepIndex, draft))
  if (result.success) return {}

  const errors: StepErrors = {}
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? '_')
    if (!errors[key]) errors[key] = issue.message
  }
  return errors
}

/**
 * The subset of the draft a step's schema sees, with empty strings turned into
 * `undefined` so "not filled in" reads as missing rather than as an empty
 * string that would trip a format rule and produce a confusing message.
 */
function candidateFor(stepIndex: number, draft: OnboardingDraft): Record<string, unknown> {
  const step = ONBOARDING_STEPS[stepIndex - 1]
  if (!step) return {}
  const out: Record<string, unknown> = {}
  for (const section of step.sections) {
    for (const field of section.fields) {
      if (field.key === 'additionalDocs') continue
      const value = draft[field.key]
      out[field.key] = value === '' ? undefined : value
    }
  }
  return out
}

/** Error counts per step — what the sidebar badges render. */
export function errorCountsFor(draft: OnboardingDraft): Record<number, number> {
  const counts: Record<number, number> = {}
  for (const step of ONBOARDING_STEPS) {
    counts[step.index] = Object.keys(validateStep(step.index, draft)).length
  }
  return counts
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/**
 * A short, sane country list with the US first.
 *
 * A function rather than a constant so the step config above can call it before
 * the module's const bindings are initialised (hoisting).
 */
export function COUNTRIES(): readonly string[] {
  return [
    'US', 'CA', 'GB', 'IE', 'IN', 'AU', 'NZ', 'DE', 'FR', 'ES', 'IT', 'NL', 'SE',
    'AE', 'SG', 'PH', 'ZA', 'MX', 'BR', 'JP',
  ]
}

const COUNTRY_NAMES: Record<string, string> = {
  US: 'United States', CA: 'Canada', GB: 'United Kingdom', IE: 'Ireland', IN: 'India',
  AU: 'Australia', NZ: 'New Zealand', DE: 'Germany', FR: 'France', ES: 'Spain',
  IT: 'Italy', NL: 'Netherlands', SE: 'Sweden', AE: 'United Arab Emirates',
  SG: 'Singapore', PH: 'Philippines', ZA: 'South Africa', MX: 'Mexico', BR: 'Brazil',
  JP: 'Japan',
}

export function countryLabel(code: string): string {
  return COUNTRY_NAMES[code] ?? code
}

/** The display name a draft has earned so far. Never an empty string. */
export function draftDisplayName(
  draft: Pick<OnboardingDraft, 'firstName' | 'lastName' | 'personalEmail'>
): string {
  const name = [draft.firstName, draft.lastName].filter(Boolean).join(' ').trim()
  return name || draft.personalEmail || 'Unnamed draft'
}

/** "Hourly rate" vs "Annual salary" — the label follows the pay type. */
export function payRateLabel(payType: string): string {
  return payType === 'Hourly' ? 'Hourly rate' : payType === 'Salaried' ? 'Annual salary' : 'Pay rate'
}

// ---------------------------------------------------------------------------
// The employee's half of the wizard (014)
// ---------------------------------------------------------------------------

/**
 * WHY THERE ARE TWO VIEWS OF ONE FORM
 * -----------------------------------
 * Most of what onboarding collects is the employee's own information — their
 * address, their visa, their bank account, their next of kin — and the org has
 * to chase it out of them by email before it can type it in here. So the org
 * can hand over the account early and let the person fill their own share in.
 *
 * The two views are DERIVED FROM THE SAME CONFIG above rather than written out
 * again, for exactly the reason the config exists at all: a field added to step
 * 1 must not silently go missing from whichever view nobody remembered to
 * update. What the employee sees is `ONBOARDING_STEPS` minus the things that
 * are the org's to decide.
 */

/**
 * Fields an employee may never write, whatever a request body claims.
 *
 * Three kinds, and the reasons differ:
 *   • IDENTITY   — `personalEmail` IS their sign-in. Changing it here would
 *     desynchronise the draft from `auth.users`, so it is shown in the page
 *     header instead and never rendered as an input.
 *   • ADMIN-ONLY — the notes columns, which the subject of the row must not
 *     even read.
 *   • THE OFFER  — role, department, hire date, pay. These are the org's side
 *     of the employment relationship; an employee editing their own pay rate is
 *     not a form, it is a vulnerability.
 */
export const ORG_ONLY_FIELDS: ReadonlySet<DraftFieldKey> = new Set<DraftFieldKey>([
  'personalEmail',
  'internalNotes',
  'complianceNotes',
  'workPhone',
  'workEmail',
  'hireDate',
  'employmentStatus',
  'employeeCode',
  'departmentId',
  'designation',
  'reportingManagerId',
  'payType',
  'payRate',
  'payFrequency',
  'employmentType',
])

/** An employee step, plus which org step it was cut from. */
export interface EmployeeStepDef extends StepDef {
  /** The `ONBOARDING_STEPS` index this view was derived from. */
  sourceIndex: number
}

/**
 * The employee's steps: the org's, with the org's own fields removed and any
 * section (or whole step) that empties out as a result dropped.
 *
 * Step 3 disappears entirely — it is nothing but the offer — so the employee
 * sees four steps where the org sees five, renumbered 1..4 so the progress
 * indicator reads honestly.
 */
/**
 * Where the org's wording does not survive the change of audience.
 *
 * "Compensation & banking" is the org's step; the employee's version of it has
 * no compensation in it at all, and a heading that promises one is worse than
 * no heading. Only the few that actually mislead are overridden — the rest read
 * the same from either side of the table.
 */
const EMPLOYEE_STEP_COPY: Record<number, { title: string; hint: string }> = {
  4: { title: 'Bank & emergency contact', hint: 'Where you are paid, and who to call' },
}

/**
 * Section copy that the pronoun rewrite below cannot save, keyed by title.
 *
 * "Visible to the employee in their profile" is written ABOUT the employee;
 * swapping the pronoun gives "visible to the employee in your profile", which
 * is worse than the original. When a sentence has the wrong subject, not just
 * the wrong pronoun, it needs replacing rather than patching.
 */
const EMPLOYEE_SECTION_COPY: Record<string, { banner?: string; hint?: string }> = {
  'Preferred identity': {
    banner: 'Optional — this is the name shown to your colleagues across the app.',
  },
}

export const EMPLOYEE_STEPS: EmployeeStepDef[] = ONBOARDING_STEPS.map((step) => {
  const sections = step.sections
    .map((section) => ({
      ...section,
      // Same guidance, addressed to the person it is about — see `secondPerson`.
      hint: EMPLOYEE_SECTION_COPY[section.title]?.hint ?? (section.hint && secondPerson(section.hint)),
      banner:
        EMPLOYEE_SECTION_COPY[section.title]?.banner ??
        (section.banner && secondPerson(section.banner)),
      fields: section.fields
        .filter(
          (field) =>
            !field.adminOnly &&
            (field.key === 'additionalDocs' || !ORG_ONLY_FIELDS.has(field.key as DraftFieldKey))
        )
        .map((field) => (field.hint ? { ...field, hint: secondPerson(field.hint) } : field)),
    }))
    .filter((section) => section.fields.length > 0)
  return { ...step, ...EMPLOYEE_STEP_COPY[step.index], sourceIndex: step.index, sections }
})
  .filter((step) => step.sections.length > 0)
  .map((step, i) => ({ ...step, index: i + 1 }))

export const EMPLOYEE_REVIEW_STEP = EMPLOYEE_STEPS.length + 1
export const EMPLOYEE_TOTAL_STEPS = EMPLOYEE_REVIEW_STEP

/**
 * Every key an employee is allowed to send.
 *
 * Derived from the steps they are actually shown, so the server allowlist and
 * the rendered form cannot disagree — the failure mode that allowlist exists to
 * prevent is a field that quietly stops being writable, or quietly starts.
 */
export const EMPLOYEE_EDITABLE_KEYS: ReadonlySet<string> = new Set(
  EMPLOYEE_STEPS.flatMap((step) => step.sections.flatMap((s) => s.fields.map((f) => String(f.key))))
)

/** Employee step 1..N → the org step whose Zod schema governs it. */
export function employeeStepSource(index: number): number {
  return EMPLOYEE_STEPS.find((s) => s.index === index)?.sourceIndex ?? index
}

/**
 * Validate one EMPLOYEE step.
 *
 * Runs the org step's schema — there is only one definition of "required" and
 * this is it — then keeps only the messages for fields this view actually
 * shows. Without that filter an employee would be told to fill in a pay rate
 * they cannot see, on a step that has no such box.
 */
export function validateEmployeeStep(index: number, draft: OnboardingDraft): StepErrors {
  const step = EMPLOYEE_STEPS.find((s) => s.index === index)
  if (!step) return {}
  const visible = new Set(
    visibleSections(step, draft).flatMap((s) => s.fields.map((f) => String(f.key)))
  )
  const all = validateStep(step.sourceIndex, draft)
  const errors: StepErrors = {}
  for (const [key, message] of Object.entries(all)) {
    if (visible.has(key)) errors[key] = secondPerson(message)
  }
  return errors
}

/**
 * "Enter their first name" → "Enter your first name"; "their government ID" →
 * "your government ID".
 *
 * The step schemas are written for the org, who is describing someone else. The
 * employee is describing themselves, and being told to enter "their" name is
 * the kind of small wrongness that makes a form feel like it was not meant for
 * you. Rewriting the pronoun here keeps ONE definition of every rule and every
 * message — the alternative is a parallel set of schemas that drift.
 */
function secondPerson(message: string): string {
  return message.replace(/\btheir\b/g, 'your').replace(/\bTheir\b/g, 'Your')
}

/** Error counts per employee step — the sidebar badges, their side. */
export function employeeErrorCountsFor(draft: OnboardingDraft): Record<number, number> {
  const counts: Record<number, number> = {}
  for (const step of EMPLOYEE_STEPS) {
    counts[step.index] = Object.keys(validateEmployeeStep(step.index, draft)).length
  }
  return counts
}

/** Is every employee-owned step complete? What "Submit" is gated on. */
export function employeeStepsComplete(draft: OnboardingDraft): boolean {
  return EMPLOYEE_STEPS.every((s) => Object.keys(validateEmployeeStep(s.index, draft)).length === 0)
}
