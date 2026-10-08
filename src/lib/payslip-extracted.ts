/**
 * The SHAPE of a parsed payslip (059) — what the extract route answers with.
 *
 * DELIBERATELY FREE OF BOTH DIRECTIVES — no `'use client'`, no `server-only`.
 * The parser itself is server-only (it reads PDF bytes), but the payroll dialog
 * is a client component and has to describe the response it gets back. Putting
 * the types here means the dialog never imports the server module at all, even
 * for a type — see the note at the top of src/lib/job-form.ts for what happens
 * when a client file reaches into a server one.
 */

/** One row of a payslip's earnings or deductions table. */
export interface ExtractedLine {
  label: string
  /** THIS PERIOD — the first numeric column on the row. */
  amount: number
  /**
   * Year to date, when the row carried a second column. Undefined on a
   * single-column layout, which is not the same as zero — one means "the slip
   * did not say" and the other means "nothing yet this year".
   */
  ytd?: number
}

/**
 * How much of the slip the parse was sure about. `low` means the admin still
 * has typing to do, and the dialog says so rather than implying the form is
 * ready to issue.
 */
export type ExtractConfidence = 'high' | 'low'

export interface ExtractedPayslip {
  /** '' when the field was not found — never a guess. */
  employeeName: string
  designation: string
  employeeCode: string
  /** ISO-4217, when a symbol or code was recognisable. */
  currency: string
  /** 1-12, when a month name or numeric period was found. */
  month: number | null
  year: number | null
  /** ISO dates, for the US statement's period fields. */
  periodStart: string
  periodEnd: string
  payDate: string
  dateOfJoining: string
  pfNumber: string
  bankDetails: string
  earnings: ExtractedLine[]
  deductions: ExtractedLine[]
  /** As PRINTED on the slip, which is what makes the cross-check possible. */
  grossPay: number | null
  netPay: number | null
  /**
   * What the admin is told. Empty means the parse agreed with itself; anything
   * here is a specific thing to look at before issuing.
   */
  warnings: string[]
  confidence: ExtractConfidence
}
