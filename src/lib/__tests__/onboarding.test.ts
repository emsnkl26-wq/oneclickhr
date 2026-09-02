import { describe, it, expect } from 'vitest'
import {
  draftFromRow, emptyDraft, errorCountsFor, needsVisaDetail, validateStep, visibleSections,
  ONBOARDING_STEPS, DRAFT_COLUMNS,
  EMPLOYEE_STEPS, EMPLOYEE_EDITABLE_KEYS, ORG_ONLY_FIELDS,
  validateEmployeeStep, employeeStepsComplete,
} from '@/lib/onboarding'
import { toColumns, employeeToColumns } from '@/lib/onboarding-server'
import { onboardingDraftSchema } from '@/lib/schemas'

/** A draft that satisfies every required field, as a starting point to break. */
function completeDraft() {
  return emptyDraft({
    firstName: 'Alice',
    lastName: 'Nguyen',
    dateOfBirth: '1992-04-11',
    gender: 'Female',
    streetAddress: '14 Bell Street',
    city: 'Austin',
    stateProvince: 'TX',
    zipPostal: '78701',
    country: 'US',
    phone: '+1 555 0100',
    personalEmail: 'alice@example.com',
    workAuthStatus: 'US Citizen',
    hireDate: '2026-09-01',
    employmentStatus: 'Active',
    departmentId: '3f6b1a5e-6c2c-4a2f-9f0a-1a2b3c4d5e6f',
    designation: 'Staff Nurse',
    payType: 'Salaried',
    payRate: '72000',
    payFrequency: 'Monthly',
    employmentType: 'Full-time',
    emergencyContactName: 'Minh Nguyen',
    emergencyRelationship: 'Spouse',
    emergencyPhone: '+1 555 0111',
  })
}

describe('step validation', () => {
  it('passes every step for a fully filled draft', () => {
    expect(errorCountsFor(completeDraft())).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 })
  })

  it('reports one error per missing required field, keyed by field name', () => {
    const draft = completeDraft()
    draft.lastName = ''
    draft.zipPostal = ''
    const errors = validateStep(1, draft)
    expect(Object.keys(errors).sort()).toEqual(['lastName', 'zipPostal'])
  })

  it('treats a blank optional field as fine', () => {
    const draft = completeDraft()
    draft.middleName = ''
    draft.homePhone = ''
    draft.internalNotes = ''
    expect(validateStep(1, draft)).toEqual({})
  })

  it('rejects a malformed login email', () => {
    const draft = completeDraft()
    draft.personalEmail = 'alice@'
    expect(validateStep(1, draft)).toHaveProperty('personalEmail')
  })

  it('never blocks on documents — step 5 is entirely optional', () => {
    expect(validateStep(5, emptyDraft())).toEqual({})
  })
})

describe('conditional visa detail', () => {
  it('hides the visa section for statuses that carry no paperwork', () => {
    for (const status of ['US Citizen', 'Permanent Resident', 'Not Applicable']) {
      expect(needsVisaDetail(status)).toBe(false)
    }
  })

  it('shows it for every visa-bearing status', () => {
    for (const status of ['H-1B', 'L-1', 'EAD', 'OPT', 'Other Visa']) {
      expect(needsVisaDetail(status)).toBe(true)
    }
  })

  it('drops the section from step 2 when the status implies no visa', () => {
    const step2 = ONBOARDING_STEPS[1]
    const citizen = visibleSections(step2, emptyDraft({ workAuthStatus: 'US Citizen' }))
    const holder = visibleSections(step2, emptyDraft({ workAuthStatus: 'H-1B' }))
    expect(citizen).toHaveLength(1)
    expect(holder).toHaveLength(2)
  })
})

describe('row ⇄ draft mapping', () => {
  it('turns nulls into empty strings and never surfaces the ciphertext', () => {
    const draft = draftFromRow({
      first_name: 'Alice',
      last_name: null,
      pay_rate: 72000,
      account_number_enc: 'v1:aaa:bbb:ccc',
      additional_docs: [{ key: 'k', fileName: 'contract.pdf', label: null }],
    })
    expect(draft.firstName).toBe('Alice')
    expect(draft.lastName).toBe('')
    expect(draft.payRate).toBe('72000')
    expect(draft.accountNumber).toBe('')
    expect(draft.additionalDocs).toHaveLength(1)
  })

  it('maps every draft field to a column', () => {
    for (const step of ONBOARDING_STEPS) {
      for (const section of step.sections) {
        for (const field of section.fields) {
          if (field.key === 'additionalDocs') continue
          expect(DRAFT_COLUMNS[field.key]).toBeTypeOf('string')
        }
      }
    }
  })
})

describe('draft patches', () => {
  it('writes only the keys the caller sent', () => {
    const input = onboardingDraftSchema.parse({ city: 'Austin' })
    const patch = toColumns(input)
    expect(patch).toEqual({ city: 'Austin' })
    expect(patch).not.toHaveProperty('first_name')
  })

  it('clears a field when it is sent empty', () => {
    const patch = toColumns(onboardingDraftSchema.parse({ city: '' }))
    expect(patch).toEqual({ city: null })
  })

  it('encrypts the account number rather than storing the digits', () => {
    // 32 bytes of base64 — the documented key format (see src/lib/crypto.ts).
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
    const patch = toColumns(onboardingDraftSchema.parse({ accountNumber: '12345678' }))
    expect(String(patch.account_number_enc)).toMatch(/^v1:/)
    expect(String(patch.account_number_enc)).not.toContain('12345678')
  })

  it('refuses to save bank details when encryption is not configured', () => {
    delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY
    expect(() => toColumns(onboardingDraftSchema.parse({ accountNumber: '12345678' }))).toThrow(
      /encryption is not configured/i
    )
  })

  it('clears the stored number when an empty one is sent', () => {
    delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY
    expect(toColumns(onboardingDraftSchema.parse({ accountNumber: '' }))).toEqual({
      account_number_enc: null,
    })
  })

  it('deduplicates and sorts completed steps', () => {
    const patch = toColumns(onboardingDraftSchema.parse({ completedSteps: [3, 1, 3] }))
    expect(patch.completed_steps).toEqual([1, 3])
  })
})

/**
 * The employee's view of the wizard (014).
 *
 * These tests exist because the view is DERIVED. A field added to
 * `ONBOARDING_STEPS` silently joins or does not join the employee's form
 * depending on where it lands, and the consequence of getting that wrong is
 * either an employee editing their own pay or an org chasing a field nobody was
 * ever shown.
 */
describe('employee onboarding view', () => {
  it('drops every organization-owned field', () => {
    const shown = new Set(
      EMPLOYEE_STEPS.flatMap((s) => s.sections.flatMap((sec) => sec.fields.map((f) => f.key)))
    )
    for (const key of ORG_ONLY_FIELDS) expect(shown.has(key)).toBe(false)
  })

  it('never shows an admin-only field', () => {
    const fields = EMPLOYEE_STEPS.flatMap((s) => s.sections.flatMap((sec) => sec.fields))
    expect(fields.some((f) => f.adminOnly)).toBe(false)
  })

  it('drops the employment step entirely, since it is nothing but the offer', () => {
    expect(EMPLOYEE_STEPS.map((s) => s.sourceIndex)).toEqual([1, 2, 4, 5])
    expect(EMPLOYEE_STEPS.map((s) => s.index)).toEqual([1, 2, 3, 4])
  })

  it('keeps the fields that are genuinely the employee to answer', () => {
    for (const key of ['streetAddress', 'workAuthStatus', 'emergencyPhone', 'idProofUrl']) {
      expect(EMPLOYEE_EDITABLE_KEYS.has(key)).toBe(true)
    }
  })

  it('reports only errors for fields the employee can see', () => {
    // Their step 3 comes from the org's step 4, which also requires pay — and
    // pay is not on their form, so it must not be held against them.
    const errors = validateEmployeeStep(3, emptyDraft())
    expect(Object.keys(errors).sort()).toEqual([
      'emergencyContactName',
      'emergencyPhone',
      'emergencyRelationship',
    ])
  })

  it('addresses the person filling it in, not the person being described', () => {
    expect(validateEmployeeStep(1, emptyDraft()).firstName).toBe('Enter your first name')
  })

  it('accepts a draft the employee has completed, pay and department still blank', () => {
    const draft = emptyDraft({
      firstName: 'Alice',
      lastName: 'Nguyen',
      dateOfBirth: '1992-04-11',
      gender: 'Female',
      streetAddress: '14 Bell Street',
      city: 'Austin',
      stateProvince: 'TX',
      zipPostal: '78701',
      country: 'US',
      phone: '+1 555 0100',
      workAuthStatus: 'US Citizen',
      emergencyContactName: 'Minh Nguyen',
      emergencyRelationship: 'Spouse',
      emergencyPhone: '+1 555 0111',
    })
    expect(employeeStepsComplete(draft)).toBe(true)
    // The ORG's checks still fail on the same draft — that is the point of the
    // review step, and why submitting is not completing.
    expect(errorCountsFor(draft)[3]).toBeGreaterThan(0)
  })
})

describe('employeeToColumns', () => {
  it('drops organization-owned columns whatever the request claims', () => {
    const patch = employeeToColumns(
      onboardingDraftSchema.parse({
        city: 'Austin',
        payRate: 999999,
        designation: 'CEO',
        internalNotes: 'promote me',
        employeeStep: 2,
      })
    )
    expect(patch).toEqual({ city: 'Austin', employee_step: 2 })
  })

  it('never lets an employee move the organization through its own wizard', () => {
    const patch = employeeToColumns(onboardingDraftSchema.parse({ currentStep: 6 }))
    expect(patch).toEqual({})
  })
})
