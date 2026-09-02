import 'server-only'

/**
 * Server-side half of the onboarding wizard: the draft patch → column mapping,
 * and the bank-account encryption boundary.
 *
 * THE ACCOUNT NUMBER RULE
 * -----------------------
 * A bank account number exists in plaintext for exactly one hop: inside the
 * request body of the save that carries it. `toColumns` encrypts it on the way
 * in (AES-256-GCM, same scheme and key as the stored Google refresh token), and
 * nothing ever decrypts it back to a browser — the wizard is told only the last
 * four digits, so a compromised session cannot read a number out of the UI.
 */
import { encryptToken, decryptToken, isEncryptionConfigured } from '@/lib/crypto'
import {
  DRAFT_COLUMNS, EMPLOYEE_EDITABLE_KEYS,
  type DraftFieldKey, type OnboardingDraft,
} from '@/lib/onboarding'
import type { OnboardingDraftInput } from '@/lib/schemas'

export class OnboardingPatchError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'OnboardingPatchError'
    this.status = status
  }
}

/**
 * A validated patch → the columns to write. ONLY keys the caller actually sent
 * appear in the result: a step-3 save must not blank out step 1, and an autosave
 * of one field must not resurrect a value the user just cleared elsewhere.
 */
export function toColumns(input: OnboardingDraftInput): Record<string, unknown> {
  const patch: Record<string, unknown> = {}

  for (const [key, column] of Object.entries(DRAFT_COLUMNS) as [DraftFieldKey, string][]) {
    if (key === 'accountNumber') continue // handled below — it is encrypted
    const value = (input as Record<string, unknown>)[key]
    // `undefined` is "not sent", which is not the same as "cleared" (null).
    if (!(key in input) || value === undefined) continue
    patch[column] = value ?? null
  }

  if ('accountNumber' in input) {
    const raw = input.accountNumber
    if (!raw) {
      patch.account_number_enc = null
    } else {
      if (!isEncryptionConfigured()) {
        // Fail loudly rather than store a bank account number in the clear.
        throw new OnboardingPatchError(
          'Bank details cannot be saved: encryption is not configured on this server.',
          503
        )
      }
      patch.account_number_enc = encryptToken(raw)
    }
  }

  if (input.additionalDocs !== undefined) patch.additional_docs = input.additionalDocs
  if (input.currentStep !== undefined) patch.current_step = input.currentStep
  if (input.completedSteps !== undefined) {
    patch.completed_steps = Array.from(new Set(input.completedSteps)).sort((a, b) => a - b)
  }
  if (input.employeeStep !== undefined) patch.employee_step = input.employeeStep
  if (input.employeeCompletedSteps !== undefined) {
    patch.employee_completed_steps = Array.from(new Set(input.employeeCompletedSteps)).sort(
      (a, b) => a - b
    )
  }

  return patch
}

/**
 * The last four digits of a stored account number, or null.
 *
 * A failed decrypt is not an error worth surfacing: it means the key rotated or
 * the value is corrupt, and the only consequence is that the masked hint is
 * missing. The number itself is still there for whoever holds the right key.
 */
export function accountLast4(ciphertext: string | null | undefined): string | null {
  if (!ciphertext) return null
  try {
    const plain = decryptToken(ciphertext)
    return plain.length >= 4 ? plain.slice(-4) : null
  } catch {
    return null
  }
}

/**
 * A unique employee code for this tenant, e.g. `EMP-0007`.
 *
 * Called only when the org left the field blank. The uniqueness index on
 * (tenant_id, employee_code) is the real guarantee — this just picks a
 * candidate that is very likely free, and the caller retries on conflict.
 */
export function suggestEmployeeCode(existingCount: number): string {
  return `EMP-${String(existingCount + 1).padStart(4, '0')}`
}

/**
 * A draft → the `profiles` columns it becomes.
 *
 * ONE definition, used by both writes that ever land a draft on a profile:
 * `invite` (early, when most of it is still blank) and `complete` (at the end,
 * when it is not). They used to be one function because there was only one
 * write; keeping them one function is what stops a column collected by the
 * wizard from reaching the profile on one path and not the other.
 *
 * `account_number_enc` is taken from the ROW, not the draft: it is already
 * ciphertext, and this copies it across without ever decrypting it.
 */
export function profilePatchFromDraft(
  draft: OnboardingDraft,
  row: { account_number_enc?: string | null },
  opts: { fullName: string; email: string; employeeCode: string; timezone: string }
): Record<string, unknown> {
  return {
    full_name: opts.fullName,
    email: opts.email,
    phone: draft.phone || null,
    employee_code: opts.employeeCode,
    designation: draft.designation || null,
    department_id: draft.departmentId || null,
    date_of_joining: draft.hireDate || null,
    photo_url: draft.photoUrl || null,
    timezone: opts.timezone,
    is_active: true,

    preferred_first_name: draft.preferredFirstName || null,
    preferred_last_name: draft.preferredLastName || null,
    pronouns: draft.pronouns || null,
    date_of_birth: draft.dateOfBirth || null,
    gender: draft.gender || null,
    street_address: draft.streetAddress || null,
    apartment: draft.apartment || null,
    city: draft.city || null,
    state_province: draft.stateProvince || null,
    zip_postal: draft.zipPostal || null,
    country: draft.country || null,
    home_phone: draft.homePhone || null,
    work_phone: draft.workPhone || null,
    work_email: draft.workEmail || null,
    hire_date: draft.hireDate || null,
    employment_status: draft.employmentStatus || 'Active',
    reporting_manager_id: draft.reportingManagerId || null,
    pay_type: draft.payType || null,
    pay_rate: draft.payRate === '' ? null : Number(draft.payRate),
    pay_frequency: draft.payFrequency || null,
    employment_type: draft.employmentType || null,
    bank_name: draft.bankName || null,
    account_holder_name: draft.accountHolderName || null,
    // Already ciphertext on the draft — copied across, never re-encrypted and
    // never decrypted on this path.
    account_number_enc: row.account_number_enc ?? null,
    routing_code: draft.routingCode || null,
    account_type: draft.accountType || null,
    emergency_contact_name: draft.emergencyContactName || null,
    emergency_relationship: draft.emergencyRelationship || null,
    emergency_phone: draft.emergencyPhone || null,
    emergency_email: draft.emergencyEmail || null,
    resume_url: draft.resumeUrl || null,
    offer_letter_url: draft.offerLetterUrl || null,
    id_proof_type: draft.idProofType || null,
    id_proof_url: draft.idProofUrl || null,
    additional_docs: draft.additionalDocs,
    internal_notes: draft.internalNotes || null,
    compliance_notes: draft.complianceNotes || null,
  }
}

/**
 * The keys an EMPLOYEE may write to their own draft, as a patch.
 *
 * The client is told which fields it may show (`EMPLOYEE_STEPS`); this is the
 * server refusing everything else regardless of what the client sends. Pay,
 * department, hire date and the admin-only notes are dropped silently rather
 * than rejected — a stale tab posting a field it used to be allowed should save
 * the rest of the form, not fail it.
 */
export function employeeToColumns(input: OnboardingDraftInput): Record<string, unknown> {
  const patch = toColumns(input)
  const allowed: Record<string, unknown> = {}
  for (const [key, column] of Object.entries(DRAFT_COLUMNS) as [DraftFieldKey, string][]) {
    if (!EMPLOYEE_EDITABLE_KEYS.has(key)) continue
    if (column in patch) allowed[column] = patch[column]
  }
  if ('additional_docs' in patch) allowed.additional_docs = patch.additional_docs
  // Their own position in their own wizard. `current_step` is the org's and is
  // deliberately not reachable from here.
  if ('employee_step' in patch) allowed.employee_step = patch.employee_step
  if ('employee_completed_steps' in patch) {
    allowed.employee_completed_steps = patch.employee_completed_steps
  }
  return allowed
}
