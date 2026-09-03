/**
 * The words a generated document starts with.
 *
 * Every string here is a DEFAULT, not a rule: the generator form loads them into
 * editable fields and the PDF renders whatever comes back. That is the whole
 * point of keeping them in one module — the org can rewrite a clause without a
 * deploy, and the next document still starts from the same known-good baseline.
 *
 * No `server-only` import: this is shared by the form (a client component) and
 * by the PDF writer (also client-side).
 */
import type { GeneratedDocumentType } from '@/types/db'

export const DOCUMENT_TYPE_LABELS: Record<GeneratedDocumentType, string> = {
  offer_letter: 'Offer letter',
  employment_agreement: 'Employment agreement',
  internship_offer: 'Internship offer',
}

export const DOCUMENT_TYPE_DESCRIPTIONS: Record<GeneratedDocumentType, string> = {
  offer_letter:
    'A short, two-page offer: position details, responsibilities and an acceptance block.',
  employment_agreement:
    'The full agreement — seventeen numbered clauses, signature blocks and page numbers.',
  internship_offer:
    'An internship or short-form offer with a training focus and an acknowledgement block.',
}

/** The values every template interpolates. Empty strings simply print nothing. */
export interface TemplateVars {
  companyName: string
  employeeName: string
  jobTitle: string
  employmentType: string
  startDate: string
  salaryText: string
  workLocation: string
  governingState: string
  visaType: string
  hoursPerWeek: string
  /** Who the offer says the employee reports to — usually the signatory. */
  reportingManagerName: string
  reportingManagerTitle: string
  registrationNumber: string
}

export const EMPLOYMENT_TYPE_OPTIONS = [
  'Full-Time',
  'Full-Time (Remote)',
  'Part-Time',
  'Contract',
  'Internship',
] as const

/**
 * Generic duties, used when an org has not written its own.
 *
 * Deliberately about HOW the work is done rather than what it is: a made-up list
 * of technologies on a real offer letter is worse than a short honest one, and
 * the org is expected to replace these.
 */
export function defaultResponsibilities(jobTitle: string): string[] {
  const role = jobTitle.trim() || 'employee'
  return [
    `Perform the duties customarily associated with the role of ${role}.`,
    'Design, build and maintain the systems and deliverables assigned to you.',
    'Collaborate with engineering, analytics and product teams to deliver reliable solutions.',
    'Participate in code review, testing and release processes.',
    'Document designs, workflows and business logic for long-term maintainability.',
    'Report progress and raise risks to your manager in good time.',
  ]
}

/**
 * The opening paragraph of the short offer letter.
 *
 * Modelled on a real, signed offer letter rather than a form-letter summary:
 * one flowing paragraph that states the position, the hours, who the hire
 * reports to and where they'll work — the same information a "Position
 * Details" bullet list would have carried, but read the way an employer
 * actually writes it.
 */
export function defaultOfferIntro(vars: TemplateVars): string {
  const managerLine = vars.reportingManagerName
    ? ` You will be reporting to ${vars.reportingManagerName}` +
      `${vars.reportingManagerTitle ? ` (${vars.reportingManagerTitle})` : ''}.`
    : ''
  const locationLine = vars.workLocation
    ? ` Your primary work location will be ${vars.workLocation}.`
    : ''

  return (
    `On behalf of ${vars.companyName}, we are pleased to offer you the position of ` +
    `${vars.jobTitle || 'the role'}. As a ${(vars.employmentType || 'full-time').toLowerCase()} ` +
    `employee you will be working ${vars.hoursPerWeek || '40'} hours per week for ` +
    `${vars.companyName}.${managerLine}${locationLine}`
  )
}

/** The second paragraph — start date, stated the way an offer letter states it. */
export function defaultStartDateText(vars: TemplateVars): string {
  return `Your start date with our company is ${vars.startDate || 'to be confirmed'}.`
}

/** The third paragraph — compensation, in prose rather than a bullet. */
export function defaultCompensationText(vars: TemplateVars): string {
  return (
    `You will be working on ${vars.salaryText}. Your compensation will be evaluated and paid ` +
    `to you in accordance with the company's current payroll policies and will be subject to ` +
    `periodic review based on your experience and duration with the company.`
  )
}

/** E-Verify registration statement. Blank — and so omitted — without an EIN on file. */
export function defaultEVerifyText(vars: TemplateVars): string {
  if (!vars.registrationNumber) return ''
  return (
    `We certify that our organization is registered with E-Verify. Employer name listed in ` +
    `E-Verify as ${vars.companyName}. Employer Identification Number: ${vars.registrationNumber}.`
  )
}

/** The contingent-upon-signing / at-will paragraph most US offer letters carry. */
export function defaultContingencyText(): string {
  return (
    `This offer of employment is contingent upon your signing of this offer letter and the ` +
    `successful and satisfactory completion of any reference checks. The term of your ` +
    `employment with the company shall be at will. Therefore, both you and the company reserve ` +
    `the right to terminate the employment relationship for any reason, or no reason, and ` +
    `without any notice.`
  )
}

export function defaultOfferClosing(vars: TemplateVars): string {
  const name = vars.employeeName || 'We'
  return (
    `${name}, we are delighted to have you join us. If the foregoing terms are acceptable to ` +
    `you, please sign and date the original and the enclosed copy of this letter; return the ` +
    `original to the company and retain the copy for your records.`
  )
}

/** The opening paragraph of the internship / short-form letter. */
export function defaultInternshipIntro(vars: TemplateVars): string {
  const managerLine = vars.reportingManagerName
    ? ` You will be reporting to ${vars.reportingManagerName}` +
      `${vars.reportingManagerTitle ? ` (${vars.reportingManagerTitle})` : ''}.`
    : ''

  return (
    `On behalf of ${vars.companyName}, we are pleased to offer you the position of ` +
    `${vars.jobTitle || 'the role'}. This is a ${(vars.employmentType || 'full-time').toLowerCase()} ` +
    `internship, working ${vars.hoursPerWeek || '40'} hours per week, with responsibilities ` +
    `focused on the design, development and maintenance of software applications and ` +
    `data-driven solutions.${managerLine}`
  )
}

export function defaultAgreementIntro(vars: TemplateVars): string {
  return (
    `${vars.companyName} (hereinafter referred to as "the Company") is pleased to offer you ` +
    `employment as "${vars.jobTitle || 'Employee'}" on the following terms and conditions.`
  )
}

/**
 * One clause of the long agreement.
 *
 * `optional` marks the clauses an org routinely turns off — the visa clause has
 * no business on a letter to a citizen, and printing an empty section is worse
 * than printing none.
 */
export interface AgreementSectionDef {
  key: string
  heading: string
  optional?: boolean
  body: (vars: TemplateVars) => string
}

/**
 * The seventeen default clauses, in the order they are numbered on the page.
 *
 * They are ordinary US employment boilerplate. They are a STARTING POINT that
 * the org edits and its own counsel approves — this module makes no claim to be
 * legal advice, and the generator says so on screen.
 */
export const AGREEMENT_SECTIONS: AgreementSectionDef[] = [
  {
    key: 'visa',
    heading: 'NONIMMIGRANT VISA',
    optional: true,
    body: (v) =>
      `Your employment as "${v.jobTitle}" is subject to approval of your ${v.visaType || 'H1B'} ` +
      `Petition that will be filed by ${v.companyName}, and issue of a Non-immigrant Visa to ` +
      `you, and the term of your employment is limited to the validity date of that approval.`,
  },
  {
    key: 'services',
    heading: 'SERVICES',
    body: (v) =>
      `You shall serve ${v.companyName} as a ${(v.employmentType || 'full-time').toLowerCase()} ` +
      `employee and shall render all duties customarily performed by a ${v.jobTitle}, together ` +
      `with such other ancillary duties as may be assigned to you from time to time by your ` +
      `Project Manager or such other person appointed for this purpose by ${v.companyName}. ` +
      `Your services will be governed by the service rules and regulations of ${v.companyName}.`,
  },
  {
    key: 'work_instructions',
    heading: 'WORK INSTRUCTIONS',
    body: (v) =>
      `As a professional employee, though you exercise some independent judgment and discretion ` +
      `on the job in accomplishing the work, you shall comply with all work-related instructions ` +
      `issued to you from time to time by your superiors, including but not limited to the manner ` +
      `in which the work is to be performed, coordination with other team members, priority of ` +
      `work, delivery deadlines, work reports and presentation of work. In addition, you shall ` +
      `follow all work policies and procedural instructions given by ${v.companyName} during your ` +
      `service. Failure to follow the instructions issued to you by your supervisors and managers ` +
      `shall be deemed a material breach of this Agreement.`,
  },
  {
    key: 'performance',
    heading: 'PERFORMANCE',
    body: (v) =>
      `You shall devote your full time and attention to the performance of all of your work ` +
      `assignments diligently, and work with a cooperative spirit with your team members and ` +
      `co-employees. Your performance is subject to ${v.companyName}'s periodical review and ` +
      `appraisal. In the event ${v.companyName} finds that your performance is unsatisfactory or ` +
      `lacking in competence or skills on the job, ${v.companyName} reserves the right to ` +
      `terminate your services, without notice, at any time.`,
  },
  {
    key: 'non_assignment',
    heading: 'NON ASSIGNMENT',
    body: () =>
      `All work and assignments given to you are non-assignable and are to be performed ` +
      `personally by you, in a professional manner and to the best of your ability.`,
  },
  {
    key: 'compensation',
    heading: 'COMPENSATION AND BENEFITS',
    body: (v) =>
      `You will be paid ${v.salaryText}, after deducting statutory deductions, federal and state ` +
      `withholding tax and any other deductions permitted under applicable state or federal law. ` +
      `You will be issued a pay slip showing the statutory deductions, and a W-2 statement of the ` +
      `salary paid to you.`,
  },
  {
    key: 'workplace',
    heading: 'WORKPLACE',
    body: (v) =>
      `You will be posted to work at ${v.workLocation || 'the location assigned to you'}. You ` +
      `shall refrain from any conduct which is prejudicial to the interest of ${v.companyName} ` +
      `and shall perform your services to the highest professional standards.`,
  },
  {
    key: 'property',
    heading: 'SAFE RETURN OF ALL PROPERTY',
    body: (v) =>
      `During your employment you may be provided with a computer or laptop, software, ` +
      `confidential documents, records and other property of ${v.companyName} that are required ` +
      `for the performance of your assigned work. You shall return all such property in good ` +
      `condition on termination of your employment, or as and when required to be returned by ` +
      `${v.companyName}.`,
  },
  {
    key: 'confidentiality',
    heading: 'CONFIDENTIALITY',
    body: (v) =>
      `In the course of your employment with ${v.companyName} you may be entrusted with ` +
      `proprietary or confidential information and records of ${v.companyName} or its clients or ` +
      `customers. You shall maintain the confidential nature of all such information and shall not ` +
      `discuss or divulge it to anyone. This includes, without limitation, access procedures and ` +
      `passwords, program and user manuals, run books, screens, files and documentation relating ` +
      `to the design or implementation of any computer programs, and any other information ` +
      `relating to research, development, inventions, prototypes, purchasing, accounting, project ` +
      `pricing, engineering, marketing, selling, trade practices, policies and trade secrets. This ` +
      `provision shall survive the termination of your employment. In the event you breach or ` +
      `threaten to breach this provision, ${v.companyName} shall have the right to seek injunctive ` +
      `relief in addition to damages or any other relief at law or in equity.`,
  },
  {
    key: 'ip',
    heading: 'INTELLECTUAL PROPERTY RIGHTS',
    body: (v) =>
      `All work performed by you shall be work for hire, and ${v.companyName} or its clients shall ` +
      `have sole ownership and proprietary rights in all such work. You agree to disclose and ` +
      `assign any invention, development, process, plan, design, formula, specification, program ` +
      `or other matter whatsoever created, developed or discovered by you, either alone or with ` +
      `others, in the course of your employment, and the same shall be the absolute property of ` +
      `${v.companyName} or its client. Any intellectual property rights and rights to inventions ` +
      `arising out of your activities — or, where ownership rights cannot be transferred under ` +
      `applicable law, any exploitation rights relating thereto — shall be transferred to ` +
      `${v.companyName} in accordance with applicable law. You shall, as and when requested and at ` +
      `${v.companyName}'s cost and expense, assist in perfecting those rights in any manner ` +
      `${v.companyName} deems fit.`,
  },
  {
    key: 'termination',
    heading: 'TERMINATION AND ABANDONMENT OF SERVICE',
    body: (v) =>
      `You may terminate your services at any time on giving one month's advance written notice ` +
      `to ${v.companyName}, or by paying ${v.companyName} a sum equivalent to one month's pay in ` +
      `lieu of notice. ${v.companyName} may terminate your services at any time, with or without ` +
      `reason, on giving two days' written notice. In the event you abandon your service without ` +
      `leave or notice for more than seven continuous days, you shall be deemed to have terminated ` +
      `your services and shall be liable to pay ${v.companyName} a sum equivalent to one month's ` +
      `notice pay.`,
  },
  {
    key: 'arbitration',
    heading: 'ARBITRATION',
    body: () =>
      `You agree that any controversy or claim arising out of or relating to this contract of ` +
      `employment, or the breach thereof, will be settled by arbitration before one arbitrator in ` +
      `accordance with the rules of the American Arbitration Association then in effect, and that ` +
      `judgment upon the award rendered by the arbitrator may be entered in any court having ` +
      `jurisdiction. You further agree that the arbitrator will be selected by the parties from a ` +
      `panel of attorney arbitrators.`,
  },
  {
    key: 'law',
    heading: 'APPLICABLE LAW AND TIME LIMITATION',
    body: (v) =>
      `The formation, interpretation and performance of this Agreement shall be governed by the ` +
      `laws of the State of ${v.governingState || 'the employer'}, excluding its choice-of-law ` +
      `rules.`,
  },
  {
    key: 'address',
    heading: 'NOTIFICATION OF CHANGE OF ADDRESS',
    body: (v) =>
      `You shall promptly notify ${v.companyName} of your contact information and the full address ` +
      `of your place of residence. Any change in that contact information or address during the ` +
      `term of this Agreement, and for one year after termination of service, shall be notified to ` +
      `${v.companyName} by email within two days of such change, and that address shall be the ` +
      `address for service of notice on record.`,
  },
  {
    key: 'supersede',
    heading: 'SUPERSEDE PRIOR AGREEMENTS',
    body: () =>
      `This Agreement supersedes all prior oral and written agreements and understandings between ` +
      `the parties with respect to the subject matter hereof. This Agreement may not be modified, ` +
      `nor the parties released from their obligations hereunder, except by an instrument ` +
      `subsequent in time and in writing signed by the parties.`,
  },
  {
    key: 'counterparts',
    heading: 'EXECUTION AND COUNTERPARTS',
    body: () =>
      `This Agreement has been executed in two original counterparts, each of which shall be an ` +
      `original for all purposes, and each party shall hold one counterpart.`,
  },
  {
    key: 'acceptance',
    heading: 'ACCEPTANCE',
    body: () =>
      `If this offer is agreeable to you, please signify your acceptance of the above terms and ` +
      `conditions of your employment by signing below.`,
  },
]

/** Build the editable section list the generator form starts from. */
export function buildAgreementSections(vars: TemplateVars) {
  return AGREEMENT_SECTIONS.map((section) => ({
    key: section.key,
    heading: section.heading,
    body: section.body(vars),
    // The visa clause is the one that is off by default: most hires do not need
    // it, and an org that does need it turns it on deliberately.
    enabled: section.key !== 'visa',
    optional: !!section.optional,
  }))
}

export type AgreementSectionValue = ReturnType<typeof buildAgreementSections>[number]

/**
 * "$72,800 per annum, payable in 12 monthly instalments" — the sentence clause 6
 * needs, assembled from the two fields the form actually asks for.
 */
export function composeSalaryText(amount: string, cadence: string): string {
  const value = amount.trim()
  if (!value) return 'the agreed compensation'
  const money = /^[\d.,]+$/.test(value) ? `$${value}` : value
  switch (cadence) {
    case 'monthly':
      return `${money} per month, payable on or before the 15th of every month`
    case 'hourly':
      return `${money} per hour, payable on the Company's regular payroll schedule`
    default:
      return `${money} per annum, payable in 12 monthly payments on or before the 15th of every month`
  }
}

export const SALARY_CADENCES = [
  { value: 'annual', label: 'Per year' },
  { value: 'monthly', label: 'Per month' },
  { value: 'hourly', label: 'Per hour' },
] as const
