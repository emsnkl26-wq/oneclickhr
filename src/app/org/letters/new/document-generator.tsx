'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import {
  FileText, FileSignature, GraduationCap, Eye, Download, AlertCircle,
  ChevronDown, RotateCcw, Info, UserCheck, Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Textarea, Select, DateField, RadioCards, Checkbox } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/primitives'
import { apiPost, apiPatch, uploadFile, ApiClientError } from '@/lib/fetcher'
import { useProgressRouter } from '@/lib/use-progress-router'
import { formatDateLabel } from '@/lib/time'
import { cn } from '@/lib/utils'
import {
  DOCUMENT_TYPE_LABELS, DOCUMENT_TYPE_DESCRIPTIONS, EMPLOYMENT_TYPE_OPTIONS,
  SALARY_CADENCES, buildAgreementSections, composeSalaryText, defaultResponsibilities,
  defaultOfferIntro, defaultOfferClosing, defaultInternshipIntro, defaultAgreementIntro,
  defaultStartDateText, defaultCompensationText, defaultEVerifyText, defaultContingencyText,
  type AgreementSectionValue, type TemplateVars,
} from '@/lib/document-templates'
import { ROLE_GROUPS, ROLE_PRESETS, exactRolePreset, rolePresetFor } from '@/lib/role-presets'
import { phonePlaceholderFor } from '@/lib/geo'
import { currencyForCountry, currencySymbol } from '@/lib/currencies'
import {
  loadOrgLogo, renderDocument, documentFileName,
  type LetterheadOrg, type LogoAsset,
} from '@/lib/document-pdf'
import type { CompanyDetails, GeneratedDocumentType } from '@/types/db'
import { SignaturePad } from './signature-pad'

export interface GeneratorEmployee {
  id: string
  full_name: string | null
  email: string | null
  phone: string | null
  designation: string | null
  employment_type: string | null
  pay_rate: number | null
  pay_type: string | null
  pay_currency?: string | null
  hire_date: string | null
  date_of_joining: string | null
  street_address: string | null
  apartment: string | null
  city: string | null
  state_province: string | null
  zip_postal: string | null
  country: string | null
}

/** A saved letter being edited: its stored form refills the generator. */
export interface ExistingLetter {
  id: string
  recipientName: string
  recipientEmail: string
  payload: Record<string, unknown>
}

/** The dropdown value for "my position isn't listed". */
const OTHER_POSITION = '__other'

/** The paragraphs that write themselves from the details above them. */
type TextKey =
  | 'intro' | 'startDateText' | 'compensationText' | 'responsibilities'
  | 'eVerifyText' | 'contingencyText' | 'closing'

/** Paragraphs whose wording depends on the ROLE, re-written when it changes. */
const ROLE_TEXT_KEYS: TextKey[] = ['intro', 'responsibilities']
const ROLE_SECTION_KEYS = ['services', 'duties']

type SectionPatch = Partial<Pick<AgreementSectionValue, 'heading' | 'body' | 'enabled'>>

const TYPE_ICONS: Record<GeneratedDocumentType, React.ReactNode> = {
  offer_letter: <FileText className="size-4" />,
  employment_agreement: <FileSignature className="size-4" />,
  internship_offer: <GraduationCap className="size-4" />,
}

/**
 * Turn an employee, an org and a template into a PDF.
 *
 * WHERE THE PDF IS MADE. In the browser — see `@/lib/document-pdf` for why. The
 * bytes are then handed to the ORDINARY upload pipeline (`uploadFile`), so a
 * generated letter is sniffed, size-checked, stored under the tenant's prefix
 * and recorded in the document library exactly like an uploaded one. Only after
 * that does `/api/org/letters` write the row that links it to the employee.
 *
 * WHO IT IS FOR is typed, not picked. A letter of offer precedes the account it
 * eventually creates, so there is no employee to choose from at the moment it is
 * written. `employee` is non-null only when the page was opened from an existing
 * profile, in which case it prefills the form and files the PDF against that
 * record — a shortcut, never a requirement.
 *
 * THE WORDING WRITES ITSELF. Every paragraph (and every agreement clause) is
 * DERIVED from the details above it — the position picked from the dropdown
 * supplies the role summary and duties (src/lib/role-presets.ts), and the name,
 * dates, salary and location are interpolated — so it follows each change live.
 * What is stored is only what somebody has REWRITTEN by hand (`overrides`):
 * an edited paragraph stays exactly as they wrote it until they choose "use
 * automatic", and picking a different position re-writes the role-specific
 * paragraphs because the old role's duties would now be wrong.
 */
export function DocumentGenerator({
  company, employee, initialType, today, existing = null,
}: {
  company: CompanyDetails
  employee: GeneratorEmployee | null
  initialType: GeneratedDocumentType
  today: string
  /** Set when editing a saved letter rather than writing a new one. */
  existing?: ExistingLetter | null
}) {
  const router = useRouter()
  const progressRouter = useProgressRouter()

  // A saved field, or the new-letter default when absent (older letters stored less).
  const saved = existing?.payload ?? {}
  const savedText = (key: string, fallback: string): string =>
    typeof saved[key] === 'string' ? (saved[key] as string) : fallback

  const [docType, setDocType] = React.useState<GeneratedDocumentType>(initialType)

  // --- Recipient -----------------------------------------------------------
  const [employeeName, setEmployeeName] = React.useState(
    existing ? existing.recipientName : employee?.full_name || employee?.email || ''
  )
  const [recipientEmail, setRecipientEmail] = React.useState(
    existing ? existing.recipientEmail : employee?.email ?? ''
  )
  const employeeId = employee?.id ?? ''

  // --- Position details ----------------------------------------------------
  const [letterDate, setLetterDate] = React.useState(savedText('letterDate', today))
  const [jobTitle, setJobTitle] = React.useState(savedText('jobTitle', ''))
  // "Other" was chosen, so the title is typed rather than picked.
  const [customTitle, setCustomTitle] = React.useState(() => {
    const title = savedText('jobTitle', '').trim()
    return !!title && !exactRolePreset(title)
  })
  const [employmentType, setEmploymentType] = React.useState<string>(
    savedText('employmentType', 'Full-Time')
  )
  const [startDate, setStartDate] = React.useState(savedText('startDate', ''))
  const [salaryAmount, setSalaryAmount] = React.useState(savedText('salaryAmount', ''))
  const [salaryCadence, setSalaryCadence] = React.useState<string>(
    savedText('salaryCadence', 'annual')
  )
  const [workLocation, setWorkLocation] = React.useState(savedText('workLocation', ''))
  const [hoursPerWeek, setHoursPerWeek] = React.useState(savedText('hoursPerWeek', '40'))
  const [acceptanceDeadline, setAcceptanceDeadline] = React.useState(
    savedText('acceptanceDeadline', '')
  )
  const [honorific, setHonorific] = React.useState(savedText('honorific', ''))
  const [governingState, setGoverningState] = React.useState(savedText('governingState', ''))
  const [visaType, setVisaType] = React.useState(savedText('visaType', 'H1B'))
  const [addressLines, setAddressLines] = React.useState(savedText('addressLines', ''))

  // --- Content -------------------------------------------------------------
  // Only what somebody has rewritten by hand; everything else is derived below.
  // An edited letter restores its stored overrides; one saved before overrides
  // were stored keeps every paragraph exactly as it was printed.
  const [overrides, setOverrides] = React.useState<Partial<Record<TextKey, string>>>(() => {
    if (!existing) return {}
    if (saved.overrides && typeof saved.overrides === 'object') {
      return saved.overrides as Partial<Record<TextKey, string>>
    }
    const legacy: Partial<Record<TextKey, string>> = {}
    const keys: TextKey[] = [
      'intro', 'startDateText', 'compensationText', 'responsibilities',
      'eVerifyText', 'contingencyText', 'closing',
    ]
    for (const key of keys) {
      if (typeof saved[key] === 'string') legacy[key] = saved[key] as string
    }
    return legacy
  })
  const [sectionOverrides, setSectionOverrides] = React.useState<Record<string, SectionPatch>>(
    () =>
      existing && saved.sectionOverrides && typeof saved.sectionOverrides === 'object'
        ? (saved.sectionOverrides as Record<string, SectionPatch>)
        : {}
  )

  // --- Signature -----------------------------------------------------------
  const [signatoryName, setSignatoryName] = React.useState(
    savedText('signatoryName', company.signatoryName ?? '')
  )
  const [signatoryTitle, setSignatoryTitle] = React.useState(
    savedText('signatoryTitle', company.signatoryTitle ?? '')
  )
  const [signatoryPhone, setSignatoryPhone] = React.useState(
    savedText('signatoryPhone', company.signatoryPhone ?? '')
  )
  // Per-letter only: drawn, uploaded or typed, never stored outside the PDF.
  const [signatureImage, setSignatureImage] = React.useState<LogoAsset | null>(null)

  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<'preview' | 'generate' | null>(null)
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null)

  const companyAddress = React.useMemo(
    () =>
      [
        company.addressLine1,
        company.addressLine2,
        [company.city, company.stateProvince, company.postalCode].filter(Boolean).join(', '),
        company.country,
      ]
        .filter(Boolean)
        .join(', '),
    [company]
  )

  /** The letterhead is missing enough that a document would look unfinished. */
  const letterheadGaps = React.useMemo(() => {
    const gaps: string[] = []
    if (!company.addressLine1 && !company.city) gaps.push('a company address')
    if (!company.registrationNumber) gaps.push('a registration number')
    if (!company.companyEmail && !company.companyPhone) gaps.push('an email or phone number')
    if (!company.logoUrl) gaps.push('a logo')
    return gaps
  }, [company])

  // The salary's currency: the employee's own pay currency when the letter was
  // opened from their profile, else the one usual where the company is (₹ for an
  // Indian workspace), else $. Typing "USD 72,000" in the box still wins.
  const salarySymbol = currencySymbol(
    employee?.pay_currency || currencyForCountry(company.country) || 'USD'
  )

  const templateVars: TemplateVars = React.useMemo(
    () => ({
      companyName: company.name,
      employeeName,
      jobTitle,
      employmentType,
      startDate: formatDateLabel(startDate),
      salaryText: composeSalaryText(salaryAmount, salaryCadence, salarySymbol),
      workLocation,
      governingState,
      visaType,
      hoursPerWeek,
      // The letter's "you will be reporting to" line is, in practice, the
      // person who signs it — so the signature block doubles as the source.
      reportingManagerName: signatoryName,
      reportingManagerTitle: signatoryTitle,
      registrationNumber: company.registrationNumber ?? '',
    }),
    [
      company.name, company.registrationNumber, employeeName, jobTitle, employmentType, startDate,
      salaryAmount, salaryCadence, salarySymbol, workLocation, governingState, visaType,
      hoursPerWeek, signatoryName, signatoryTitle,
    ]
  )

  /*
   * Prefill from the employee's profile, and start every template from its
   * automatic wording. Runs on load and when the TEMPLATE changes — a new
   * template has different paragraphs, so wording rewritten for the old one
   * does not carry over.
   */
  // When editing, the form already holds the saved letter: skip the prefill for
  // the template it was saved as (a ref, so React's dev double-run is harmless),
  // and reset only if somebody switches template.
  const prefilledFor = React.useRef<GeneratedDocumentType | null>(existing ? initialType : null)
  React.useEffect(() => {
    if (prefilledFor.current === docType) return
    prefilledFor.current = docType
    const location = companyAddress || 'Remote'

    // Only the profile-derived fields are overwritten, and only when there IS a
    // profile. With no employee the position fields keep whatever is in them —
    // which on the first render is empty, and after a template switch is
    // whatever the person filling the form has already typed.
    if (employee) {
      const title = employee.designation ?? ''
      setJobTitle(title)
      setCustomTitle(!!title.trim() && !exactRolePreset(title))
      setEmploymentType(employee.employment_type || 'Full-Time')
      setStartDate(employee.hire_date || employee.date_of_joining || '')
      setSalaryAmount(employee.pay_rate != null ? String(employee.pay_rate) : '')
      setSalaryCadence(employee.pay_type?.toLowerCase() === 'hourly' ? 'hourly' : 'annual')
      setAddressLines(
        [
          employee.street_address,
          employee.apartment,
          [employee.city, employee.state_province, employee.zip_postal].filter(Boolean).join(', '),
          employee.country,
        ]
          .filter(Boolean)
          .join('\n')
      )
    }
    setWorkLocation(location)
    setGoverningState(company.stateProvince ?? '')
    setOverrides({})
    setSectionOverrides({})
  }, [docType, employee, companyAddress, company.stateProvince])

  /*
   * The automatic wording, re-derived whenever a detail it mentions changes:
   * the role (summary and duties), the name, the start date, the salary, the
   * location. Cheap string building, so it simply runs on every change.
   */
  const automatic = React.useMemo<Record<TextKey, string>>(
    () => ({
      intro:
        docType === 'internship_offer'
          ? defaultInternshipIntro(templateVars)
          : docType === 'employment_agreement'
            ? defaultAgreementIntro(templateVars)
            : defaultOfferIntro(templateVars),
      startDateText: defaultStartDateText(templateVars),
      compensationText: defaultCompensationText(templateVars),
      responsibilities: defaultResponsibilities(templateVars.jobTitle).join('\n'),
      eVerifyText: defaultEVerifyText(templateVars),
      contingencyText: defaultContingencyText(),
      closing: defaultOfferClosing(templateVars),
    }),
    [docType, templateVars]
  )

  const textOf = (key: TextKey) => overrides[key] ?? automatic[key]
  const intro = textOf('intro')
  const startDateText = textOf('startDateText')
  const compensationText = textOf('compensationText')
  const responsibilities = textOf('responsibilities')
  const eVerifyText = textOf('eVerifyText')
  const contingencyText = textOf('contingencyText')
  const closing = textOf('closing')

  const setText = (key: TextKey) => (value: string) =>
    setOverrides((current) => ({ ...current, [key]: value }))
  const revertText = (key: TextKey) =>
    setOverrides((current) => {
      const next = { ...current }
      delete next[key]
      return next
    })

  const sections = React.useMemo<AgreementSectionValue[]>(
    () =>
      buildAgreementSections(templateVars).map((section) => ({
        ...section,
        ...sectionOverrides[section.key],
      })),
    [templateVars, sectionOverrides]
  )

  const matchedRole = React.useMemo(() => rolePresetFor(jobTitle), [jobTitle])

  /**
   * A position picked from the dropdown. The role-specific paragraphs are
   * re-written for it even if they had been edited — the old role's duties
   * would now be wrong — and an internship role suggests the internship type.
   */
  function choosePosition(value: string) {
    if (value === OTHER_POSITION) {
      setCustomTitle(true)
      if (exactRolePreset(jobTitle)) setJobTitle('')
      return
    }
    setCustomTitle(false)
    setJobTitle(value)
    const preset = exactRolePreset(value)
    if (preset?.employmentType) setEmploymentType(preset.employmentType)
    setOverrides((current) => {
      const next = { ...current }
      for (const key of ROLE_TEXT_KEYS) delete next[key]
      return next
    })
    setSectionOverrides((current) => {
      const next = { ...current }
      for (const key of ROLE_SECTION_KEYS) {
        if (next[key]) {
          const { body: _body, ...rest } = next[key]
          next[key] = rest
        }
      }
      return next
    })
  }

  React.useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    },
    [previewUrl]
  )

  /** The letterhead block, assembled once for whichever template runs. */
  function letterhead(logo: LogoAsset | null): LetterheadOrg {
    return {
      name: company.name,
      logo,
      addressLines: [
        company.addressLine1 ?? '',
        company.addressLine2 ?? '',
        [company.city, company.stateProvince, company.postalCode].filter(Boolean).join(', '),
        company.country ?? '',
      ].filter(Boolean),
      registrationNumber: company.registrationNumber,
      email: company.companyEmail,
      phone: company.companyPhone,
      website: company.website,
    }
  }

  const documentTitle = React.useMemo(() => {
    switch (docType) {
      case 'employment_agreement':
        return `Employment Offer — ${employeeName || 'Employee'}`
      case 'internship_offer':
        return `Internship Offer${jobTitle ? ` – ${jobTitle}` : ''}`
      default:
        return `Offer of Employment${jobTitle ? ` – ${jobTitle}` : ''}`
    }
  }, [docType, jobTitle, employeeName])

  async function build(): Promise<Blob> {
    const org = letterhead(await loadOrgLogo(company.logoUrl))
    const bullets = responsibilities
      .split('\n')
      .map((line) => line.replace(/^[-•*]\s*/, '').trim())
      .filter(Boolean)

    const dateLabel = formatDateLabel(letterDate)
    const signatory = {
      name: signatoryName,
      title: signatoryTitle,
      phone: signatoryPhone,
      image: signatureImage,
      signedDate: signatureImage ? formatDateLabel(today) : undefined,
    }

    if (docType === 'employment_agreement') {
      return renderDocument({
        type: 'employment_agreement',
        data: {
          org,
          date: dateLabel,
          employeeName,
          honorific,
          employeeAddressLines: addressLines.split('\n').map((line) => line.trim()).filter(Boolean),
          intro,
          sections: sections
            .filter((section) => section.enabled)
            .map((section) => ({ heading: section.heading, body: section.body })),
          signatory,
        },
      })
    }

    const shared = {
      org,
      date: dateLabel,
      employeeName,
      jobTitle,
      employmentType,
      startDate: formatDateLabel(startDate),
      salary: composeSalaryText(salaryAmount, salaryCadence, salarySymbol),
      workLocation,
      intro,
      startDateText,
      compensationText,
      responsibilities: bullets,
      eVerifyText,
      contingencyText,
      closing,
      acceptanceDeadline: acceptanceDeadline ? formatDateLabel(acceptanceDeadline) : '',
      signatory,
    }

    return docType === 'internship_offer'
      ? renderDocument({ type: 'internship_offer', data: { ...shared, companyAddress } })
      : renderDocument({ type: 'offer_letter', data: shared })
  }

  function validate(): string | null {
    if (!employeeName.trim()) return 'Enter the name of the person this document is for.'
    if (docType !== 'employment_agreement' && !jobTitle.trim()) {
      return 'Enter the position title.'
    }
    return null
  }

  async function preview() {
    const problem = validate()
    if (problem) {
      setError(problem)
      return
    }
    setError(null)
    setBusy('preview')
    try {
      const blob = await build()
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      setPreviewUrl(URL.createObjectURL(blob))
    } catch (err) {
      console.error('[letters] preview failed', err)
      setError('The document could not be built. Please check the fields and try again.')
    } finally {
      setBusy(null)
    }
  }

  async function generate() {
    const problem = validate()
    if (problem) {
      setError(problem)
      return
    }
    setError(null)
    setBusy('generate')

    try {
      const blob = await build()
      const fileName = documentFileName(docType, employeeName, letterDate)
      const file = new File([blob], fileName, { type: 'application/pdf' })

      // Through the ordinary pipeline: presign, PUT to storage, finalize. The
      // finalize step writes the `documents` row, whose id links the letter to
      // the library so deleting one can remove the other.
      const uploaded = await uploadFile(
        file,
        'employee_doc',
        employeeId ? { employeeId } : {}
      )

      const body = {
        recipientName: employeeName.trim(),
        recipientEmail: recipientEmail.trim(),
        docType,
        title: documentTitle,
        key: uploaded.key,
        fileName,
        documentId: uploaded.documentId ?? null,
        payload: {
          letterDate, jobTitle, employmentType, startDate, salaryAmount, salaryCadence,
          workLocation, hoursPerWeek, acceptanceDeadline, honorific, governingState, visaType,
          addressLines,
          intro, startDateText, compensationText, responsibilities, eVerifyText, contingencyText,
          closing, signatoryName, signatoryTitle, signatoryPhone,
          // What was hand-written, so editing later restores those paragraphs as
          // "Edited" and leaves the rest automatic.
          overrides, sectionOverrides,
          signed: !!signatureImage,
        },
      }

      if (existing) {
        await apiPatch(`/api/org/letters/${existing.id}`, body)
      } else {
        await apiPost('/api/org/letters', { ...body, employeeId: employeeId || null })
      }

      toast.success(existing ? 'Document updated' : 'Document generated and saved')
      router.refresh()
      progressRouter.push('/org/letters')
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'The document could not be saved. Please try again.'
      )
      setBusy(null)
    }
  }

  const isAgreement = docType === 'employment_agreement'

  return (
    <div className="space-y-5">
      <FormError message={error} />

      {letterheadGaps.length ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            Your letterhead is missing {letterheadGaps.join(', ')}. The document will still
            generate, but it will read as unfinished — add the details in{' '}
            <a href="/org/settings" className="font-semibold underline">
              Settings
            </a>
            .
          </p>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Template</CardTitle>
          <CardDescription>
            These follow the standard US offer and agreement formats. Have your own counsel review
            the wording before you send one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RadioCards
            columns={3}
            value={docType}
            onChange={(value) => setDocType(value as GeneratedDocumentType)}
            options={(Object.keys(DOCUMENT_TYPE_LABELS) as GeneratedDocumentType[]).map((type) => ({
              value: type,
              label: DOCUMENT_TYPE_LABELS[type],
              description: DOCUMENT_TYPE_DESCRIPTIONS[type],
              icon: TYPE_ICONS[type],
            }))}
          />
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Who it is for</CardTitle>
            <CardDescription>
              {employee
                ? 'Prefilled from their profile — edit anything that has changed.'
                : 'The person you are writing to. They do not need an account yet.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {employee ? (
              <p className="flex items-start gap-2 rounded-lg bg-page px-3.5 py-2.5 text-[13px] text-ink-muted">
                <UserCheck className="mt-px size-4 shrink-0" aria-hidden />
                This document will be filed against {employee.full_name || employee.email}&apos;s
                employee record.
              </p>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Recipient name" required hint="Printed on the letter.">
                <Input
                  value={employeeName}
                  onChange={(event) => setEmployeeName(event.target.value)}
                  placeholder="Jordan Ellis"
                  autoComplete="off"
                />
              </FormField>
              <FormField label="Recipient email" hint="Optional — kept with the record.">
                <Input
                  type="email"
                  value={recipientEmail}
                  onChange={(event) => setRecipientEmail(event.target.value)}
                  placeholder="jordan@example.com"
                  autoComplete="off"
                />
              </FormField>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Document date" required>
                <DateField
                  value={letterDate}
                  onChange={(event) => setLetterDate(event.target.value)}
                />
              </FormField>
              {isAgreement ? (
                <FormField label="Salutation" hint="Printed as “Dear Mr. Smith,”.">
                  <Select value={honorific} onChange={(event) => setHonorific(event.target.value)}>
                    <option value="">No title</option>
                    <option value="Mr.">Mr.</option>
                    <option value="Ms.">Ms.</option>
                    <option value="Mx.">Mx.</option>
                    <option value="Dr.">Dr.</option>
                  </Select>
                </FormField>
              ) : (
                <FormField label="Reply by" hint="Optional acceptance deadline.">
                  <DateField
                    value={acceptanceDeadline}
                    min={letterDate}
                    onChange={(event) => setAcceptanceDeadline(event.target.value)}
                  />
                </FormField>
              )}
            </div>

            {isAgreement ? (
              <FormField
                label="Employee address"
                hint="One line each. Printed under the date, as on a formal letter."
              >
                <Textarea
                  rows={4}
                  value={addressLines}
                  onChange={(event) => setAddressLines(event.target.value)}
                  placeholder={'2100 Escorial Place\nApt 201, Palm Beach Gardens\nFlorida 33410'}
                />
              </FormField>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Position details</CardTitle>
            <CardDescription>What the document states about the role.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              label="Position title"
              required={!isAgreement}
              hint={
                customTitle
                  ? matchedRole
                    ? `Wording written like a ${matchedRole.title} — edit anything below.`
                    : 'Type the title; the wording below uses generic duties for it.'
                  : 'The duties and clauses below are written for the position you pick.'
              }
            >
              <Select
                value={customTitle ? OTHER_POSITION : exactRolePreset(jobTitle)?.title ?? ''}
                onChange={(event) => choosePosition(event.target.value)}
                placeholder="Choose a position"
                searchable
              >
                {ROLE_GROUPS.map((group) => (
                  <optgroup key={group} label={group}>
                    {ROLE_PRESETS.filter((role) => role.group === group).map((role) => (
                      <option key={role.title} value={role.title}>
                        {role.title}
                      </option>
                    ))}
                  </optgroup>
                ))}
                <optgroup label="Not listed">
                  <option value={OTHER_POSITION}>Other — type a custom title</option>
                </optgroup>
              </Select>
            </FormField>

            {customTitle ? (
              <FormField label="Custom position title" required={!isAgreement}>
                <Input
                  value={jobTitle}
                  onChange={(event) => setJobTitle(event.target.value)}
                  placeholder="Senior Data Engineer"
                  autoFocus
                />
              </FormField>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Employment type">
                <Select
                  value={employmentType}
                  onChange={(event) => setEmploymentType(event.target.value)}
                >
                  {EMPLOYMENT_TYPE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Start date">
                <DateField
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                />
              </FormField>
            </div>

            {!isAgreement ? (
              <FormField label="Hours per week" hint="Printed in the opening paragraph.">
                <Input
                  value={hoursPerWeek}
                  onChange={(event) => setHoursPerWeek(event.target.value)}
                  placeholder="40"
                  inputMode="numeric"
                />
              </FormField>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Compensation" hint="Just the number — the wording is added.">
                <Input
                  value={salaryAmount}
                  onChange={(event) => setSalaryAmount(event.target.value)}
                  placeholder="72,800"
                  inputMode="decimal"
                />
              </FormField>
              <FormField label="Paid">
                <Select
                  value={salaryCadence}
                  onChange={(event) => setSalaryCadence(event.target.value)}
                >
                  {SALARY_CADENCES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>

            <p className="rounded-lg bg-page px-3.5 py-2.5 text-[13px] text-ink-muted">
              Reads as: {composeSalaryText(salaryAmount, salaryCadence, salarySymbol)}
            </p>

            <FormField label="Work location">
              <Input
                value={workLocation}
                onChange={(event) => setWorkLocation(event.target.value)}
                placeholder="700 Universe Blvd, Juno Beach, Florida 33408"
              />
            </FormField>

            {isAgreement ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Governing state" hint="Used by the applicable-law clause.">
                  <Input
                    value={governingState}
                    onChange={(event) => setGoverningState(event.target.value)}
                    placeholder="Maryland"
                  />
                </FormField>
                <FormField label="Visa type" hint="Used by the nonimmigrant visa clause.">
                  <Input
                    value={visaType}
                    onChange={(event) => setVisaType(event.target.value)}
                    placeholder="H1B"
                  />
                </FormField>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {isAgreement ? (
        <AgreementSections
          sections={sections}
          intro={intro}
          introEdited={overrides.intro !== undefined}
          editedKeys={Object.keys(sectionOverrides).filter(
            (key) => sectionOverrides[key].body !== undefined || sectionOverrides[key].heading !== undefined
          )}
          onIntroChange={setText('intro')}
          onIntroRevert={() => revertText('intro')}
          onUpdate={(key, patch) =>
            setSectionOverrides((current) => ({ ...current, [key]: { ...current[key], ...patch } }))
          }
          onRevert={(key) =>
            setSectionOverrides((current) => {
              const { heading: _heading, body: _body, ...rest } = current[key] ?? {}
              return { ...current, [key]: rest }
            })
          }
          onReset={() => {
            setSectionOverrides({})
            revertText('intro')
            toast.success('Clauses reset to the automatic wording')
          }}
        />
      ) : (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Wording</CardTitle>
              <CardDescription>
                Written for you from the position and details above, and kept in step as they
                change. Edit any paragraph to take it over.
              </CardDescription>
            </div>
            <Button
              size="sm"
              variant="ghost"
              disabled={Object.keys(overrides).length === 0}
              onClick={() => {
                setOverrides({})
                toast.success('Wording reset to the automatic text')
              }}
            >
              <RotateCcw />
              Reset all
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <AutoTextField
              label="Opening paragraph"
              rows={4}
              value={intro}
              edited={overrides.intro !== undefined}
              onChange={setText('intro')}
              onRevert={() => revertText('intro')}
            />

            <AutoTextField
              label="Start date paragraph"
              rows={2}
              value={startDateText}
              edited={overrides.startDateText !== undefined}
              onChange={setText('startDateText')}
              onRevert={() => revertText('startDateText')}
            />

            <AutoTextField
              label="Compensation paragraph"
              rows={3}
              value={compensationText}
              edited={overrides.compensationText !== undefined}
              onChange={setText('compensationText')}
              onRevert={() => revertText('compensationText')}
            />

            <AutoTextField
              label={
                docType === 'internship_offer'
                  ? 'Training focus & responsibilities'
                  : 'Job duties and responsibilities'
              }
              hint="One bullet per line."
              rows={9}
              value={responsibilities}
              edited={overrides.responsibilities !== undefined}
              onChange={setText('responsibilities')}
              onRevert={() => revertText('responsibilities')}
            />

            <AutoTextField
              label="E-Verify statement"
              hint="Leave blank to omit it entirely."
              rows={2}
              value={eVerifyText}
              edited={overrides.eVerifyText !== undefined}
              onChange={setText('eVerifyText')}
              onRevert={() => revertText('eVerifyText')}
            />

            <AutoTextField
              label="Contingency / at-will paragraph"
              hint="Leave blank to omit it entirely."
              rows={3}
              value={contingencyText}
              edited={overrides.contingencyText !== undefined}
              onChange={setText('contingencyText')}
              onRevert={() => revertText('contingencyText')}
            />

            <AutoTextField
              label="Closing paragraph"
              rows={3}
              value={closing}
              edited={overrides.closing !== undefined}
              onChange={setText('closing')}
              onRevert={() => revertText('closing')}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Signature block</CardTitle>
          <CardDescription>
            Defaults come from your workspace settings. Change them here for this document only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Signatory name">
              <Input
                value={signatoryName}
                onChange={(event) => setSignatoryName(event.target.value)}
                placeholder="Alex Morgan"
              />
            </FormField>
            <FormField label="Title">
              <Input
                value={signatoryTitle}
                onChange={(event) => setSignatoryTitle(event.target.value)}
                placeholder="Managing Director"
              />
            </FormField>
            <FormField label="Phone">
              <Input
                value={signatoryPhone}
                onChange={(event) => setSignatoryPhone(event.target.value)}
                placeholder={phonePlaceholderFor(company.country)}
              />
            </FormField>
          </div>

          <div className="mt-5 space-y-2">
            <p className="text-sm font-medium text-ink">Signature</p>
            {existing && saved.signed && !signatureImage ? (
              <p className="rounded-lg bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-800">
                The saved copy was signed. Signatures are not stored, so sign again below or the
                updated PDF will have a blank line to sign by hand.
              </p>
            ) : null}
            <p className="text-[13px] text-ink-muted">
              Optional. Printed above the signatory&apos;s name with today&apos;s date. Leave it
              empty to keep a blank line for a wet signature.
            </p>
            <SignaturePad
              value={signatureImage}
              onChange={setSignatureImage}
              defaultName={signatoryName}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-card px-5 py-4 shadow-sm">
        <p className="flex items-start gap-2 text-sm text-ink-muted">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          {employee
            ? `Generating saves the PDF to your document library and to ${employee.full_name || employee.email}'s profile.`
            : 'Generating saves the PDF to your document library, filed under this recipient.'}
        </p>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" loading={busy === 'preview'} disabled={busy !== null} onClick={preview}>
            <Eye />
            Preview
          </Button>
          <Button loading={busy === 'generate'} disabled={busy !== null} onClick={generate}>
            <Download />
            {existing ? 'Save changes' : 'Generate PDF'}
          </Button>
        </div>
      </div>

      <Dialog
        open={!!previewUrl}
        onOpenChange={(open) => {
          if (!open && previewUrl) {
            URL.revokeObjectURL(previewUrl)
            setPreviewUrl(null)
          }
        }}
      >
        <DialogContent size="lg" className="h-[92vh] max-w-5xl">
          <DialogHeader>
            <DialogTitle>Preview</DialogTitle>
            <DialogDescription>
              Nothing has been saved yet. Close this and choose Generate PDF to keep it.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 px-6 pb-2">
            {previewUrl ? (
              <iframe
                src={previewUrl}
                title="Document preview"
                className="size-full rounded-lg border border-line bg-page"
              />
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                if (previewUrl) URL.revokeObjectURL(previewUrl)
                setPreviewUrl(null)
              }}
            >
              Close
            </Button>
            <Button
              loading={busy === 'generate'}
              onClick={() => {
                if (previewUrl) URL.revokeObjectURL(previewUrl)
                setPreviewUrl(null)
                void generate()
              }}
            >
              Generate PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * One paragraph that writes itself, with a note saying so.
 *
 * "Automatic" means it follows the details above; the moment somebody types in
 * it, it becomes theirs ("Edited") and stops following, until they choose to
 * hand it back. The note sits outside the <label> so its button is not a
 * second click target for the textarea.
 */
function AutoTextField({
  label, hint, rows, value, edited, onChange, onRevert,
}: {
  label: string
  hint?: string
  rows: number
  value: string
  edited: boolean
  onChange: (value: string) => void
  onRevert: () => void
}) {
  const id = React.useId()
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-[13px] font-medium text-ink">
          {label}
        </label>
        <AutoBadge edited={edited} onRevert={onRevert} />
      </div>
      <Textarea id={id} rows={rows} value={value} onChange={(event) => onChange(event.target.value)} />
      {hint ? <p className="text-xs text-ink-muted">{hint}</p> : null}
    </div>
  )
}

function AutoBadge({ edited, onRevert }: { edited: boolean; onRevert: () => void }) {
  return edited ? (
    <button
      type="button"
      onClick={onRevert}
      className="focus-ring inline-flex shrink-0 items-center gap-1 rounded text-xs font-medium text-brand-ink hover:underline"
    >
      <RotateCcw className="size-3" aria-hidden />
      Edited — use automatic
    </button>
  ) : (
    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-ink-muted">
      <Sparkles className="size-3" aria-hidden />
      Automatic
    </span>
  )
}

/**
 * The numbered clauses, each collapsible.
 *
 * Collapsed by default: a column of open textareas is a wall nobody reads, and
 * the point of this screen is that the automatic wording is usually right. The
 * heading row shows the number it will print with, so turning one off visibly
 * renumbers the rest — which is what the PDF does too.
 */
function AgreementSections({
  sections, intro, introEdited, editedKeys, onIntroChange, onIntroRevert, onUpdate, onRevert,
  onReset,
}: {
  sections: AgreementSectionValue[]
  intro: string
  introEdited: boolean
  /** Clauses whose heading or text somebody has rewritten. */
  editedKeys: string[]
  onIntroChange: (value: string) => void
  onIntroRevert: () => void
  onUpdate: (key: string, patch: SectionPatch) => void
  onRevert: (key: string) => void
  onReset: () => void
}) {
  const [open, setOpen] = React.useState<string | null>(null)

  let printed = 0

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>Clauses</CardTitle>
          <CardDescription>
            Written for the position above and kept in step with the details. Turn a clause off to
            leave it out entirely — the rest renumber themselves.
          </CardDescription>
        </div>
        <Button size="sm" variant="ghost" onClick={onReset}>
          <RotateCcw />
          Reset
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        <AutoTextField
          label="Opening paragraph"
          rows={3}
          value={intro}
          edited={introEdited}
          onChange={onIntroChange}
          onRevert={onIntroRevert}
        />

        <div className="divide-y divide-line rounded-lg border border-line">
          {sections.map((section) => {
            if (section.enabled) printed += 1
            const number = section.enabled ? printed : null
            const expanded = open === section.key
            const edited = editedKeys.includes(section.key)

            return (
              <div key={section.key}>
                <div className="flex items-center gap-3 px-3.5 py-2.5">
                  <Checkbox
                    checked={section.enabled}
                    onChange={(event) => onUpdate(section.key, { enabled: event.target.checked })}
                    aria-label={`Include ${section.heading}`}
                  />
                  <span
                    className={cn(
                      'tabular w-7 shrink-0 text-sm font-semibold',
                      section.enabled ? 'text-ink' : 'text-ink-muted/60'
                    )}
                  >
                    {number ? `${number}.` : '—'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setOpen(expanded ? null : section.key)}
                    className={cn(
                      'focus-ring flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 text-left text-sm font-medium transition',
                      section.enabled ? 'text-ink' : 'text-ink-muted/60'
                    )}
                    aria-expanded={expanded}
                  >
                    <span className="min-w-0 flex-1 truncate">{section.heading}</span>
                    {edited ? (
                      <span className="shrink-0 text-xs font-normal text-brand-ink">Edited</span>
                    ) : null}
                    <ChevronDown
                      className={cn(
                        'size-4 shrink-0 text-ink-muted transition-transform',
                        expanded && 'rotate-180'
                      )}
                      aria-hidden
                    />
                  </button>
                </div>

                {expanded ? (
                  <div className="space-y-3 border-t border-line bg-page/40 px-3.5 py-3.5">
                    <div className="flex justify-end">
                      <AutoBadge edited={edited} onRevert={() => onRevert(section.key)} />
                    </div>
                    <FormField label="Heading">
                      <Input
                        value={section.heading}
                        onChange={(event) => onUpdate(section.key, { heading: event.target.value })}
                      />
                    </FormField>
                    <FormField label="Text">
                      <Textarea
                        rows={7}
                        value={section.body}
                        onChange={(event) => onUpdate(section.key, { body: event.target.value })}
                      />
                    </FormField>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
