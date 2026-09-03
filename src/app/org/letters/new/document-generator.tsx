'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import {
  FileText, FileSignature, GraduationCap, Eye, Download, AlertCircle,
  ChevronDown, RotateCcw, Info,
} from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Textarea, Select, DateField, RadioCards, Checkbox } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/primitives'
import { apiPost, uploadFile, ApiClientError } from '@/lib/fetcher'
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
import {
  loadOrgLogo, renderDocument, documentFileName,
  type LetterheadOrg, type LogoAsset,
} from '@/lib/document-pdf'
import type { CompanyDetails, GeneratedDocumentType } from '@/types/db'

export interface GeneratorEmployee {
  id: string
  full_name: string | null
  email: string | null
  phone: string | null
  designation: string | null
  employment_type: string | null
  pay_rate: number | null
  pay_type: string | null
  hire_date: string | null
  date_of_joining: string | null
  street_address: string | null
  apartment: string | null
  city: string | null
  state_province: string | null
  zip_postal: string | null
  country: string | null
}

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
 * WHEN THE TEXT IS REBUILT. Only when the TEMPLATE or the EMPLOYEE changes.
 * Rebuilding on every keystroke would erase a paragraph someone was in the
 * middle of rewriting the moment they corrected the job title in it.
 */
export function DocumentGenerator({
  company, employees, initialEmployeeId, initialType, today,
}: {
  company: CompanyDetails
  employees: GeneratorEmployee[]
  initialEmployeeId: string
  initialType: GeneratedDocumentType
  today: string
}) {
  const router = useRouter()
  const progressRouter = useProgressRouter()

  const [docType, setDocType] = React.useState<GeneratedDocumentType>(initialType)
  const [employeeId, setEmployeeId] = React.useState(
    employees.some((person) => person.id === initialEmployeeId)
      ? initialEmployeeId
      : (employees[0]?.id ?? '')
  )

  const employee = employees.find((person) => person.id === employeeId) ?? null
  const employeeName = employee?.full_name || employee?.email || ''

  // --- Position details ----------------------------------------------------
  const [letterDate, setLetterDate] = React.useState(today)
  const [jobTitle, setJobTitle] = React.useState('')
  const [employmentType, setEmploymentType] = React.useState<string>('Full-Time')
  const [startDate, setStartDate] = React.useState('')
  const [salaryAmount, setSalaryAmount] = React.useState('')
  const [salaryCadence, setSalaryCadence] = React.useState<string>('annual')
  const [workLocation, setWorkLocation] = React.useState('')
  const [hoursPerWeek, setHoursPerWeek] = React.useState('40')
  const [acceptanceDeadline, setAcceptanceDeadline] = React.useState('')
  const [honorific, setHonorific] = React.useState('')
  const [governingState, setGoverningState] = React.useState('')
  const [visaType, setVisaType] = React.useState('H1B')
  const [addressLines, setAddressLines] = React.useState('')

  // --- Content -------------------------------------------------------------
  const [intro, setIntro] = React.useState('')
  const [startDateText, setStartDateText] = React.useState('')
  const [compensationText, setCompensationText] = React.useState('')
  const [responsibilities, setResponsibilities] = React.useState('')
  const [eVerifyText, setEVerifyText] = React.useState('')
  const [contingencyText, setContingencyText] = React.useState('')
  const [closing, setClosing] = React.useState('')
  const [sections, setSections] = React.useState<AgreementSectionValue[]>([])

  // --- Signature -----------------------------------------------------------
  const [signatoryName, setSignatoryName] = React.useState(company.signatoryName ?? '')
  const [signatoryTitle, setSignatoryTitle] = React.useState(company.signatoryTitle ?? '')
  const [signatoryPhone, setSignatoryPhone] = React.useState(company.signatoryPhone ?? '')

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

  const templateVars: TemplateVars = React.useMemo(
    () => ({
      companyName: company.name,
      employeeName,
      jobTitle,
      employmentType,
      startDate: formatDateLabel(startDate),
      salaryText: composeSalaryText(salaryAmount, salaryCadence),
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
      salaryAmount, salaryCadence, workLocation, governingState, visaType, hoursPerWeek,
      signatoryName, signatoryTitle,
    ]
  )

  /*
   * Prefill from the employee's profile.
   *
   * `templateVars` is deliberately NOT a dependency: it changes on every
   * keystroke in this very form, and depending on it would make the effect
   * overwrite the field being typed into. It is read through a ref at the moment
   * the template is actually rebuilt.
   */
  const varsRef = React.useRef(templateVars)
  varsRef.current = templateVars

  React.useEffect(() => {
    if (!employee) return

    const title = employee.designation ?? ''
    const type = employee.employment_type || 'Full-Time'
    const start = employee.hire_date || employee.date_of_joining || ''
    const rate = employee.pay_rate != null ? String(employee.pay_rate) : ''
    const cadence = employee.pay_type?.toLowerCase() === 'hourly' ? 'hourly' : 'annual'
    const location = companyAddress || 'Remote'

    setJobTitle(title)
    setEmploymentType(type)
    setStartDate(start)
    setSalaryAmount(rate)
    setSalaryCadence(cadence)
    setWorkLocation(location)
    setGoverningState(company.stateProvince ?? '')
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

    const vars: TemplateVars = {
      ...varsRef.current,
      employeeName: employee.full_name || employee.email || '',
      jobTitle: title,
      employmentType: type,
      startDate: formatDateLabel(start),
      salaryText: composeSalaryText(rate, cadence),
      workLocation: location,
    }

    setResponsibilities(defaultResponsibilities(title).join('\n'))
    setSections(buildAgreementSections(vars))
    setIntro(docType === 'internship_offer' ? defaultInternshipIntro(vars) : docType === 'employment_agreement' ? defaultAgreementIntro(vars) : defaultOfferIntro(vars))
    setStartDateText(defaultStartDateText(vars))
    setCompensationText(defaultCompensationText(vars))
    setEVerifyText(defaultEVerifyText(vars))
    setContingencyText(defaultContingencyText())
    setClosing(defaultOfferClosing(vars))
  }, [employeeId, docType, employee, companyAddress, company.stateProvince])

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

    const signatory = { name: signatoryName, title: signatoryTitle, phone: signatoryPhone }
    const dateLabel = formatDateLabel(letterDate)

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
      salary: composeSalaryText(salaryAmount, salaryCadence),
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
    if (!employeeId) return 'Choose the employee this document is for.'
    if (!employeeName) return 'That employee has no name on their profile yet.'
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
      const uploaded = await uploadFile(file, 'employee_doc', { employeeId })

      await apiPost('/api/org/letters', {
        employeeId,
        docType,
        title: documentTitle,
        key: uploaded.key,
        fileName,
        documentId: uploaded.documentId ?? null,
        payload: {
          letterDate, jobTitle, employmentType, startDate, salaryAmount, salaryCadence,
          workLocation, hoursPerWeek, acceptanceDeadline, honorific, governingState, visaType,
          intro, startDateText, compensationText, responsibilities, eVerifyText, contingencyText,
          closing, signatoryName, signatoryTitle, signatoryPhone,
        },
      })

      toast.success('Document generated and saved')
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
            <CardDescription>Details are prefilled from their profile.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField label="Employee" required>
              <Select
                value={employeeId}
                onChange={(event) => setEmployeeId(event.target.value)}
                placeholder="Choose an employee"
              >
                {employees.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.full_name || person.email}
                    {person.designation ? ` — ${person.designation}` : ''}
                  </option>
                ))}
              </Select>
            </FormField>

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
            <FormField label="Position title" required={!isAgreement}>
              <Input
                value={jobTitle}
                onChange={(event) => setJobTitle(event.target.value)}
                placeholder="Data Engineer"
              />
            </FormField>

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
              Reads as: {composeSalaryText(salaryAmount, salaryCadence)}
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
          onIntroChange={setIntro}
          onChange={setSections}
          onReset={() => {
            setSections(buildAgreementSections(templateVars))
            setIntro(defaultAgreementIntro(templateVars))
            toast.success('Clauses reset to the template')
          }}
        />
      ) : (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Wording</CardTitle>
              <CardDescription>Edit anything here before you generate.</CardDescription>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setIntro(
                  docType === 'internship_offer'
                    ? defaultInternshipIntro(templateVars)
                    : defaultOfferIntro(templateVars)
                )
                setStartDateText(defaultStartDateText(templateVars))
                setCompensationText(defaultCompensationText(templateVars))
                setResponsibilities(defaultResponsibilities(jobTitle).join('\n'))
                setEVerifyText(defaultEVerifyText(templateVars))
                setContingencyText(defaultContingencyText())
                setClosing(defaultOfferClosing(templateVars))
                toast.success('Wording reset to the template')
              }}
            >
              <RotateCcw />
              Reset
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField label="Opening paragraph">
              <Textarea rows={4} value={intro} onChange={(event) => setIntro(event.target.value)} />
            </FormField>

            <FormField label="Start date paragraph">
              <Textarea
                rows={2}
                value={startDateText}
                onChange={(event) => setStartDateText(event.target.value)}
              />
            </FormField>

            <FormField label="Compensation paragraph">
              <Textarea
                rows={3}
                value={compensationText}
                onChange={(event) => setCompensationText(event.target.value)}
              />
            </FormField>

            <FormField
              label={
                docType === 'internship_offer'
                  ? 'Training focus & responsibilities'
                  : 'Job duties and responsibilities'
              }
              hint="One bullet per line."
            >
              <Textarea
                rows={9}
                value={responsibilities}
                onChange={(event) => setResponsibilities(event.target.value)}
              />
            </FormField>

            <FormField label="E-Verify statement" hint="Leave blank to omit it entirely.">
              <Textarea
                rows={2}
                value={eVerifyText}
                onChange={(event) => setEVerifyText(event.target.value)}
              />
            </FormField>

            <FormField label="Contingency / at-will paragraph" hint="Leave blank to omit it entirely.">
              <Textarea
                rows={3}
                value={contingencyText}
                onChange={(event) => setContingencyText(event.target.value)}
              />
            </FormField>

            <FormField label="Closing paragraph">
              <Textarea
                rows={3}
                value={closing}
                onChange={(event) => setClosing(event.target.value)}
              />
            </FormField>
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
                placeholder="+1 (484) 803-2090"
              />
            </FormField>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-card px-5 py-4 shadow-sm">
        <p className="flex items-start gap-2 text-sm text-ink-muted">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          Generating saves the PDF to {employeeName || 'the employee'}&apos;s profile and to your
          document library.
        </p>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" loading={busy === 'preview'} disabled={busy !== null} onClick={preview}>
            <Eye />
            Preview
          </Button>
          <Button loading={busy === 'generate'} disabled={busy !== null} onClick={generate}>
            <Download />
            Generate PDF
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
 * The seventeen numbered clauses, each collapsible.
 *
 * Collapsed by default: seventeen open textareas is a wall nobody reads, and the
 * point of this screen is that the defaults are usually right. The heading row
 * shows the number it will print with, so turning one off visibly renumbers the
 * rest — which is what the PDF does too.
 */
function AgreementSections({
  sections, intro, onIntroChange, onChange, onReset,
}: {
  sections: AgreementSectionValue[]
  intro: string
  onIntroChange: (value: string) => void
  onChange: (sections: AgreementSectionValue[]) => void
  onReset: () => void
}) {
  const [open, setOpen] = React.useState<string | null>(null)

  const update = (key: string, patch: Partial<AgreementSectionValue>) =>
    onChange(sections.map((section) => (section.key === key ? { ...section, ...patch } : section)))

  let printed = 0

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>Clauses</CardTitle>
          <CardDescription>
            Turn a clause off to leave it out entirely — the rest renumber themselves.
          </CardDescription>
        </div>
        <Button size="sm" variant="ghost" onClick={onReset}>
          <RotateCcw />
          Reset
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        <FormField label="Opening paragraph">
          <Textarea rows={3} value={intro} onChange={(event) => onIntroChange(event.target.value)} />
        </FormField>

        <div className="divide-y divide-line rounded-lg border border-line">
          {sections.map((section) => {
            if (section.enabled) printed += 1
            const number = section.enabled ? printed : null
            const expanded = open === section.key

            return (
              <div key={section.key}>
                <div className="flex items-center gap-3 px-3.5 py-2.5">
                  <Checkbox
                    checked={section.enabled}
                    onChange={(event) => update(section.key, { enabled: event.target.checked })}
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
                    <FormField label="Heading">
                      <Input
                        value={section.heading}
                        onChange={(event) => update(section.key, { heading: event.target.value })}
                      />
                    </FormField>
                    <FormField label="Text">
                      <Textarea
                        rows={7}
                        value={section.body}
                        onChange={(event) => update(section.key, { body: event.target.value })}
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
