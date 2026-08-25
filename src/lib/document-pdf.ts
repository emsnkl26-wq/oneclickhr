'use client'

/**
 * Offer letters and employment agreements, rendered in the browser.
 *
 * Same reasoning as `invoice-pdf.ts`: the document is already fully described by
 * the form on screen, so rendering it here costs no round trip, runs no PDF
 * toolchain in a lambda, and posts nobody's salary anywhere to be turned into a
 * file. The bytes are then uploaded through the ordinary two-phase pipeline, so
 * a generated letter is sniffed, stored and recorded exactly like an uploaded
 * one.
 *
 * WHAT MAKES THESE LOOK LIKE REAL LETTERS
 * ---------------------------------------
 *   • Every page carries the ORG'S letterhead — its logo, its name, its address,
 *     its registration number. Never ours. A field the org has not filled in is
 *     omitted rather than defaulted, because a placeholder on an employment
 *     document is worse than a shorter block.
 *   • The body is justified by hand (see `justified`). jsPDF's own `justify`
 *     stretches the final line of a paragraph, which is the single most obvious
 *     tell that a document was generated.
 *   • The agreement is set in Times and the two short letters in Helvetica,
 *     matching the conventions each kind of document is usually written in.
 *   • Page numbers are stamped in a second pass, once the total is known.
 *
 * jsPDF is imported dynamically so its ~350KB never lands in the bundle for the
 * many people who open the letters list and never generate one.
 */

import type { GeneratedDocumentType } from '@/types/db'

/* --------------------------------------------------------------- Inputs */

export interface LogoAsset {
  /** `data:image/png;base64,...` — jsPDF cannot embed a remote URL or an SVG. */
  dataUrl: string
  format: 'PNG' | 'JPEG'
  width: number
  height: number
}

export interface LetterheadOrg {
  name: string
  logo: LogoAsset | null
  /** Pre-composed address lines; empty entries are dropped. */
  addressLines: string[]
  registrationNumber: string | null
  email: string | null
  phone: string | null
  website: string | null
}

export interface SignatureBlock {
  name: string
  title: string
  phone: string
}

export interface OfferLetterInput {
  org: LetterheadOrg
  date: string
  employeeName: string
  jobTitle: string
  employmentType: string
  startDate: string
  salary: string
  workLocation: string
  intro: string
  responsibilities: string[]
  closing: string
  acceptanceDeadline: string
  signatory: SignatureBlock
}

export interface InternshipOfferInput extends OfferLetterInput {
  companyAddress: string
}

export interface AgreementSection {
  heading: string
  body: string
}

export interface AgreementInput {
  org: LetterheadOrg
  date: string
  employeeName: string
  /** "Mr." / "Ms." / "" — printed in the salutation only when set. */
  honorific: string
  employeeAddressLines: string[]
  intro: string
  sections: AgreementSection[]
  signatory: SignatureBlock
}

/* ------------------------------------------------------------ Type plumbing */

/**
 * The slice of jsPDF this module uses.
 *
 * Written out rather than imported as a type so the dynamic `import('jspdf')`
 * stays the only reference to the package — a static type import would be
 * erased, but the temptation to reach for a value from it would not be.
 */
type Doc = {
  internal: { pageSize: { getWidth(): number; getHeight(): number } }
  setFont(family: string, style?: string): void
  setFontSize(size: number): void
  setTextColor(r: number, g: number, b: number): void
  setDrawColor(r: number, g: number, b: number): void
  setLineWidth(w: number): void
  text(text: string | string[], x: number, y: number, options?: Record<string, unknown>): void
  line(x1: number, y1: number, x2: number, y2: number): void
  splitTextToSize(text: string, width: number): string[]
  getTextWidth(text: string): number
  addImage(
    data: string, format: string, x: number, y: number, w: number, h: number,
    alias?: string, compression?: string
  ): void
  addPage(): void
  setPage(page: number): void
  getNumberOfPages(): number
  output(type: 'blob'): Blob
  GState: new (options: { opacity: number }) => unknown
  setGState(state: unknown): void
}

const INK: [number, number, number] = [26, 28, 35]
const MUTED: [number, number, number] = [90, 96, 110]
const RULE: [number, number, number] = [200, 204, 212]

/* ------------------------------------------------------------- Logo loading */

/**
 * Fetch the org's logo and turn it into something jsPDF can embed.
 *
 * It goes through `/api/org/letterhead-logo` — a SAME-ORIGIN route that returns
 * the bytes as a data URL — rather than `/api/files/view`, which redirects to
 * storage. See that route for the full reasoning; the short version is that
 * embedding needs to READ the bytes, and a cross-origin read depends on the
 * bucket's CORS policy allowing GET, which is not something a document
 * generator should quietly depend on.
 *
 * Returns null — never throws — whenever there is no usable raster: no logo
 * saved, an SVG, an unreadable object. A letterhead without a picture is a
 * perfectly good letterhead; a generator that refuses to run is not.
 */
export async function loadOrgLogo(logoKey: string | null): Promise<LogoAsset | null> {
  if (!logoKey) return null

  try {
    const response = await fetch('/api/org/letterhead-logo')
    if (!response.ok) return null

    const payload = (await response.json()) as { dataUrl: string | null; format: string | null }
    if (!payload?.dataUrl || (payload.format !== 'PNG' && payload.format !== 'JPEG')) return null

    // Natural dimensions, so the logo keeps its aspect ratio in the header and
    // in the watermark instead of being squashed into a square. A data URL needs
    // no CORS to measure.
    const size = await new Promise<{ width: number; height: number }>((resolve) => {
      const image = new Image()
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
      image.onerror = () => resolve({ width: 1, height: 1 })
      image.src = payload.dataUrl as string
    })

    return {
      dataUrl: payload.dataUrl,
      format: payload.format,
      width: size.width || 1,
      height: size.height || 1,
    }
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ Writer */

interface WriterOptions {
  org: LetterheadOrg
  /** 'times' for the agreement, 'helvetica' for the two short letters. */
  family: 'helvetica' | 'times'
  bodySize: number
  /** Stamp "Page X of Y" in the footer. Off for the short letters. */
  pageNumbers: boolean
}

/**
 * A flowing text cursor with page breaks, a repeating letterhead and a footer.
 *
 * The reason this exists rather than a pile of `doc.text` calls: a five-page
 * agreement has to break between clauses without splitting a heading from its
 * first line, and every new page needs the letterhead and watermark redrawn
 * before anything else lands on it. `ensure()` is the one place that decides a
 * page is full, so no caller has to track the cursor.
 */
class DocWriter {
  readonly doc: Doc
  readonly pageWidth: number
  readonly pageHeight: number
  readonly margin = 56
  readonly contentWidth: number
  readonly bottom: number
  private y = 0
  private readonly options: WriterOptions

  constructor(doc: Doc, options: WriterOptions) {
    this.doc = doc
    this.options = options
    this.pageWidth = doc.internal.pageSize.getWidth()
    this.pageHeight = doc.internal.pageSize.getHeight()
    this.contentWidth = this.pageWidth - this.margin * 2
    // Room for the footer rule, the branding line and the page number.
    this.bottom = this.pageHeight - this.margin - 26
    this.startPage()
  }

  get cursor(): number {
    return this.y
  }

  set cursor(value: number) {
    this.y = value
  }

  /** Watermark first, then the letterhead: everything else draws on top. */
  private startPage(): void {
    this.drawWatermark()
    this.y = this.drawLetterhead()
  }

  newPage(): void {
    this.doc.addPage()
    this.startPage()
  }

  /** Make room for `height` points of unbreakable content. */
  ensure(height: number): void {
    if (this.y + height > this.bottom) this.newPage()
  }

  space(points: number): void {
    this.y += points
  }

  /* ---------------------------------------------------------- Letterhead */

  private drawLetterhead(): number {
    const { doc, org } = { doc: this.doc, org: this.options.org }
    const top = 40
    let textX = this.margin
    let y = top + 10

    if (org.logo) {
      const size = 44
      const ratio = org.logo.width / org.logo.height
      const w = ratio >= 1 ? size : size * ratio
      const h = ratio >= 1 ? size / ratio : size
      doc.addImage(org.logo.dataUrl, org.logo.format, this.margin, top, w, h)
      textX = this.margin + size + 14
    }

    doc.setFont(this.options.family, 'bold')
    doc.setFontSize(12)
    doc.setTextColor(...INK)
    doc.text(org.name.toUpperCase(), textX, y)
    y += 12

    doc.setFont(this.options.family, 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...MUTED)

    for (const line of this.letterheadLines()) {
      doc.text(line, textX, y)
      y += 10
    }

    // The logo is taller than a short address block; the rule clears both.
    const bottom = Math.max(y + 2, org.logo ? top + 44 + 12 : y + 2)
    doc.setDrawColor(...RULE)
    doc.setLineWidth(0.7)
    doc.line(this.margin, bottom, this.pageWidth - this.margin, bottom)

    return bottom + 26
  }

  /** Address, registration number and contacts — omitting whatever is unset. */
  private letterheadLines(): string[] {
    const org = this.options.org
    const lines = org.addressLines.map((line) => line.trim()).filter(Boolean)

    if (org.registrationNumber) lines.push(`EIN / Reg. No: ${org.registrationNumber}`)

    const contacts = [org.email, org.phone].filter(Boolean).join('  |  ')
    if (contacts) lines.push(contacts)
    if (org.website) lines.push(org.website)

    return lines
  }

  /* ----------------------------------------------------------- Watermark */

  /**
   * The faded mark behind the text.
   *
   * Drawn through a graphics state with a low alpha. `setGState` is guarded
   * because it is the one call here that a future jsPDF build could move; if it
   * is unavailable the mark is simply skipped, and a document without a
   * watermark is still a correct document.
   */
  private drawWatermark(): void {
    const { doc } = this
    const org = this.options.org

    try {
      doc.setGState(new doc.GState({ opacity: 0.05 }))

      if (org.logo) {
        const width = this.pageWidth * 0.62
        const height = width * (org.logo.height / org.logo.width)
        doc.addImage(
          org.logo.dataUrl,
          org.logo.format,
          (this.pageWidth - width) / 2,
          (this.pageHeight - height) / 2,
          width,
          height
        )
      } else {
        doc.setFont(this.options.family, 'bold')
        doc.setFontSize(58)
        doc.setTextColor(...INK)
        doc.text(org.name, this.pageWidth / 2, this.pageHeight / 2, { align: 'center' })
      }

      doc.setGState(new doc.GState({ opacity: 1 }))
    } catch {
      // No transparency support: leave the page clean rather than stamping an
      // opaque logo across the text.
    }
    doc.setTextColor(...INK)
  }

  /* --------------------------------------------------------------- Text */

  /** Centred, underlined document title — "Employment Offer". */
  title(text: string): void {
    this.ensure(40)
    this.doc.setFont(this.options.family, 'bold')
    this.doc.setFontSize(13)
    this.doc.setTextColor(...INK)
    const centre = this.pageWidth / 2
    this.doc.text(text, centre, this.y, { align: 'center' })

    const width = this.doc.getTextWidth(text)
    this.doc.setDrawColor(...INK)
    this.doc.setLineWidth(0.6)
    this.doc.line(centre - width / 2, this.y + 3, centre + width / 2, this.y + 3)
    this.y += 26
  }

  /** A left-aligned bold line — "Position Details", "Dear …". */
  heading(text: string, size = 10.5): void {
    this.ensure(this.lineHeight() * 2)
    this.doc.setFont(this.options.family, 'bold')
    this.doc.setFontSize(size)
    this.doc.setTextColor(...INK)
    this.doc.text(text, this.margin, this.y)
    this.y += this.lineHeight() + 4
  }

  private lineHeight(): number {
    return this.options.bodySize * 1.45
  }

  /** A justified body paragraph. */
  paragraph(text: string, options: { indent?: number; bold?: boolean } = {}): void {
    if (!text.trim()) return
    const indent = options.indent ?? 0
    const width = this.contentWidth - indent

    this.doc.setFont(this.options.family, options.bold ? 'bold' : 'normal')
    this.doc.setFontSize(this.options.bodySize)
    this.doc.setTextColor(...INK)

    for (const paragraph of text.split(/\n{2,}/)) {
      const lines = this.doc.splitTextToSize(paragraph.replace(/\s+/g, ' ').trim(), width)
      for (let i = 0; i < lines.length; i += 1) {
        this.ensure(this.lineHeight())
        this.justified(lines[i], this.margin + indent, width, i === lines.length - 1)
        this.y += this.lineHeight()
      }
      this.y += 4
    }
    this.y += 4
  }

  /**
   * Draw one line, spreading the slack between its words.
   *
   * The last line of a paragraph is drawn as-is. That single exception is the
   * difference between a typeset page and one that looks machine-made, and it is
   * why this does not use jsPDF's own `align: 'justify'`.
   */
  private justified(line: string, x: number, width: number, isLast: boolean): void {
    if (isLast) {
      this.doc.text(line, x, this.y)
      return
    }
    const words = line.split(' ').filter(Boolean)
    if (words.length < 2) {
      this.doc.text(line, x, this.y)
      return
    }

    const natural = this.doc.getTextWidth(line)
    const slack = width - natural
    // A line that is already full (or over, which splitTextToSize should not
    // produce) gets no extra space rather than negative kerning.
    const extra = slack > 0 ? slack / (words.length - 1) : 0
    const spaceWidth = this.doc.getTextWidth(' ')

    let cursorX = x
    for (const word of words) {
      this.doc.text(word, cursorX, this.y)
      cursorX += this.doc.getTextWidth(word) + spaceWidth + extra
    }
  }

  /** A bulleted list. The marker hangs outside the text block. */
  bullets(items: string[], marker = '•'): void {
    const indent = 16
    const width = this.contentWidth - indent

    this.doc.setFontSize(this.options.bodySize)
    this.doc.setTextColor(...INK)

    for (const item of items) {
      const text = item.trim()
      if (!text) continue
      const lines = this.doc.splitTextToSize(text.replace(/\s+/g, ' '), width)
      this.ensure(this.lineHeight() * Math.min(lines.length, 2))

      this.doc.setFont(this.options.family, 'normal')
      this.doc.text(marker, this.margin + 3, this.y)
      for (const line of lines) {
        this.ensure(this.lineHeight())
        this.doc.text(line, this.margin + indent, this.y)
        this.y += this.lineHeight()
      }
      this.y += 2
    }
    this.y += 4
  }

  /** "Position Title: Data Engineer" — label bold, value beside it. */
  definitions(rows: Array<[string, string]>, marker = '•'): void {
    this.doc.setFontSize(this.options.bodySize)

    for (const [label, value] of rows) {
      if (!value?.trim()) continue
      this.ensure(this.lineHeight())

      this.doc.setTextColor(...INK)
      this.doc.setFont(this.options.family, 'normal')
      this.doc.text(marker, this.margin + 3, this.y)

      this.doc.setFont(this.options.family, 'bold')
      const labelText = `${label}:`
      this.doc.text(labelText, this.margin + 16, this.y)

      // The gap is measured, not assumed: a trailing space inside the measured
      // string is not reliably counted, and the label running into the value is
      // the kind of thing nobody notices until it is on a signed document.
      const gap = this.doc.getTextWidth(' ') + 2
      this.doc.setFont(this.options.family, 'normal')
      this.doc.text(value, this.margin + 16 + this.doc.getTextWidth(labelText) + gap, this.y)
      this.y += this.lineHeight()
    }
    this.y += 6
  }

  /**
   * A numbered clause of the agreement.
   *
   * The heading and its first two lines are kept together — a "12. ARBITRATION"
   * stranded at the foot of a page with its text overleaf is the classic
   * generated-document artefact.
   */
  numberedSection(index: number, heading: string, body: string): void {
    const numberX = this.margin
    const textX = this.margin + 34
    const width = this.contentWidth - 34

    /*
     * The body is measured in the font it will be DRAWN in.
     * `splitTextToSize` uses whatever face is current, and bold is wider than
     * regular — measuring while bold was still selected produced lines short of
     * the margin on every clause of the document.
     */
    this.doc.setFontSize(this.options.bodySize)
    this.doc.setFont(this.options.family, 'normal')
    const lines = this.doc.splitTextToSize(body.replace(/\s+/g, ' ').trim(), width)

    this.ensure(this.lineHeight() * (2 + Math.min(lines.length, 2)))

    this.doc.setTextColor(...INK)
    this.doc.setFont(this.options.family, 'bold')
    this.doc.text(`${index}.`, numberX, this.y)
    this.doc.text(heading, textX, this.y)
    this.y += this.lineHeight() + 2

    this.doc.setFont(this.options.family, 'normal')
    for (let i = 0; i < lines.length; i += 1) {
      this.ensure(this.lineHeight())
      this.justified(lines[i], textX, width, i === lines.length - 1)
      this.y += this.lineHeight()
    }
    this.y += 10
  }

  /** A ruled blank for a wet signature, with its caption to the left. */
  signatureLine(label: string, x: number, width: number, value = ''): void {
    this.doc.setFont(this.options.family, 'normal')
    this.doc.setFontSize(this.options.bodySize)
    this.doc.setTextColor(...INK)
    this.doc.text(label, x, this.y)

    const lineStart = x + this.doc.getTextWidth(label) + 6
    const lineEnd = x + width

    if (value) {
      this.doc.text(value, lineStart + 4, this.y - 2)
    }
    this.doc.setDrawColor(...INK)
    this.doc.setLineWidth(0.5)
    this.doc.line(lineStart, this.y + 2, lineEnd, this.y + 2)
  }

  /* -------------------------------------------------------------- Footer */

  /**
   * Stamp the footer on every page, in a second pass.
   *
   * It has to be a second pass: "Page 2 of 5" is unknowable while page 2 is
   * being written. `getNumberOfPages()` is only correct once the body is done.
   */
  finish(): void {
    const total = this.doc.getNumberOfPages()
    const y = this.pageHeight - this.margin + 6

    for (let page = 1; page <= total; page += 1) {
      this.doc.setPage(page)

      this.doc.setDrawColor(...RULE)
      this.doc.setLineWidth(0.5)
      this.doc.line(this.margin, y - 12, this.pageWidth - this.margin, y - 12)

      this.doc.setFont(this.options.family, 'normal')
      this.doc.setFontSize(7.5)
      this.doc.setTextColor(...MUTED)
      this.doc.text('Powered by OneClickHR', this.margin, y)

      if (this.options.pageNumbers || total > 1) {
        this.doc.text(`Page ${page} of ${total}`, this.pageWidth - this.margin, y, {
          align: 'right',
        })
      }
    }
  }
}

/* ------------------------------------------------------------- Generators */

async function newDoc(): Promise<Doc> {
  const { default: jsPDF } = await import('jspdf')
  return new jsPDF({ unit: 'pt', format: 'a4', compress: true }) as unknown as Doc
}

/** Template 1 — the short "Offer of Employment" letter. */
export async function renderOfferLetter(input: OfferLetterInput): Promise<Blob> {
  const doc = await newDoc()
  const w = new DocWriter(doc, {
    org: input.org,
    family: 'helvetica',
    bodySize: 10,
    pageNumbers: false,
  })

  w.heading(`Date: ${input.date}`)
  w.heading(`Subject: Offer of Employment – ${input.jobTitle}`)
  w.space(6)
  w.heading(`Dear ${input.employeeName},`)

  w.paragraph(input.intro)
  w.space(4)

  w.heading('Position Details')
  w.definitions([
    ['Position Title', input.jobTitle],
    ['Employment Type', input.employmentType],
    ['Start Date', input.startDate],
    ['Compensation', input.salary],
    ['Work Location', input.workLocation],
  ])

  if (input.responsibilities.length) {
    w.heading('Roles and Responsibilities')
    w.paragraph(`As a ${input.jobTitle}, you will work on:`)
    w.bullets(input.responsibilities)
  }

  w.paragraph(input.closing)
  w.space(10)

  writeSignatory(w, input.org, input.signatory)

  if (input.acceptanceDeadline) {
    w.space(6)
    w.paragraph(
      `Please confirm your acceptance of this offer by signing and returning a copy of this ` +
        `letter no later than ${input.acceptanceDeadline}.`
    )
  }

  w.space(6)
  // The acknowledgment, its sentence and both signature rules move together: a
  // page whose only content is two ruled lines does not read as a document
  // anyone is meant to sign.
  w.ensure(140)
  w.heading('Candidate Acknowledgment')
  w.paragraph(
    `I, ${input.employeeName}, accept the terms above and confirm my joining on ` +
      `${input.startDate}.`
  )

  w.space(18)
  w.signatureLine('Signature:', w.margin, 260)
  w.cursor += 34
  w.signatureLine('Date:', w.margin, 260)

  w.finish()
  return doc.output('blob')
}

/** Template 3 — the internship / short-form letter. */
export async function renderInternshipOffer(input: InternshipOfferInput): Promise<Blob> {
  const doc = await newDoc()
  const w = new DocWriter(doc, {
    org: input.org,
    family: 'helvetica',
    bodySize: 10,
    pageNumbers: false,
  })

  w.heading(`Date: ${input.date}`)
  w.space(4)
  w.heading(`Dear ${input.employeeName},`)

  w.paragraph(input.intro)
  w.space(4)

  w.heading('Position Details')
  w.definitions([
    ['Position Title', input.jobTitle],
    ['Start Date', input.startDate],
    ['Type', input.employmentType],
    ['Stipend / Salary', input.salary],
    ['Company Address', input.companyAddress],
  ])

  if (input.responsibilities.length) {
    w.heading('Training Focus & Responsibilities')
    w.paragraph(
      `As a ${input.jobTitle}, you will receive structured training and work on projects that ` +
        `focus on the following areas:`
    )
    w.bullets(input.responsibilities)
  }

  w.heading('Acceptance')
  if (input.acceptanceDeadline) {
    w.paragraph(
      `Please confirm your acceptance of this offer by signing and returning a copy of this ` +
        `letter by ${input.acceptanceDeadline}.`
    )
  }
  w.paragraph(input.closing)
  w.space(8)

  writeSignatory(w, input.org, input.signatory)

  w.space(14)
  w.ensure(140)
  w.heading('Candidate Acknowledgment and Acceptance')
  w.paragraph(`I, ${input.employeeName}, accept the offer as outlined above.`)

  w.space(18)
  w.signatureLine('Signature:', w.margin, 260)
  w.cursor += 34
  w.signatureLine('Date:', w.margin, 260)

  w.finish()
  return doc.output('blob')
}

/** Template 2 — the numbered, multi-page employment agreement. */
export async function renderEmploymentAgreement(input: AgreementInput): Promise<Blob> {
  const doc = await newDoc()
  const w = new DocWriter(doc, {
    org: input.org,
    family: 'times',
    bodySize: 10.5,
    pageNumbers: true,
  })

  w.title('Employment Offer')

  w.paragraph(input.date)
  w.space(2)

  w.heading(input.employeeName)
  for (const line of input.employeeAddressLines.filter(Boolean)) {
    w.paragraph(line)
    w.cursor -= 8 // address lines sit tight together, not as separate paragraphs
  }
  w.space(14)

  const salutation = input.honorific
    ? `Dear ${input.honorific} ${input.employeeName},`
    : `Dear ${input.employeeName},`
  w.heading(salutation)

  w.paragraph(input.intro, { bold: true })
  w.space(6)

  input.sections.forEach((section, index) => {
    w.numberedSection(index + 1, section.heading.toUpperCase(), section.body)
  })

  // Employer signature block.
  w.ensure(120)
  w.space(24)
  w.paragraph(input.signatory.name, { bold: true })
  w.cursor -= 10
  w.paragraph(input.signatory.title)
  w.cursor -= 12
  w.paragraph(input.org.name)

  // Employee acceptance.
  w.ensure(150)
  w.space(16)
  w.title('ACCEPTANCE')
  w.paragraph(
    `I, ${input.employeeName}, hereby declare that I have read and understood the above terms ` +
      `and conditions of employment and hereby signify my acceptance of the said offer of ` +
      `employment without any conditions by signing below.`
  )

  w.space(24)
  w.signatureLine('Employee Signature:', w.margin, 230)
  w.signatureLine('Date:', w.margin + 280, 200)
  w.cursor += 34
  w.signatureLine('Employee Name:', w.margin, 230)

  w.finish()
  return doc.output('blob')
}

/** The signature block both short letters end with. */
function writeSignatory(w: DocWriter, org: LetterheadOrg, signatory: SignatureBlock): void {
  w.ensure(80)
  w.paragraph('Sincerely,')
  w.space(8)
  if (signatory.name) {
    w.paragraph(signatory.name, { bold: true })
    w.cursor -= 10
  }
  if (signatory.title) {
    w.paragraph(signatory.title)
    w.cursor -= 12
  }
  w.paragraph(org.name)
  if (signatory.phone) {
    w.cursor -= 12
    w.paragraph(`Phone: ${signatory.phone}`)
  }
}

/* ------------------------------------------------------------------ Facade */

export type DocumentInput =
  | { type: 'offer_letter'; data: OfferLetterInput }
  | { type: 'internship_offer'; data: InternshipOfferInput }
  | { type: 'employment_agreement'; data: AgreementInput }

/** Render whichever template was chosen. One call site for the whole feature. */
export async function renderDocument(input: DocumentInput): Promise<Blob> {
  switch (input.type) {
    case 'offer_letter':
      return renderOfferLetter(input.data)
    case 'internship_offer':
      return renderInternshipOffer(input.data)
    default:
      return renderEmploymentAgreement(input.data)
  }
}

/** `Offer-Letter-Priya-Sharma-2026-08-22.pdf` — sortable and self-describing. */
export function documentFileName(
  docType: GeneratedDocumentType,
  employeeName: string,
  isoDate: string
): string {
  const slug = (text: string) =>
    text.trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'document'
  const kind = {
    offer_letter: 'Offer-Letter',
    employment_agreement: 'Employment-Agreement',
    internship_offer: 'Internship-Offer',
  }[docType]
  return `${kind}-${slug(employeeName)}-${isoDate}.pdf`
}
