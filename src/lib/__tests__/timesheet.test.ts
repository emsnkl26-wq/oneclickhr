import { describe, it, expect } from 'vitest'
import {
  weekStartSunday, timesheetWeek, formatPeriod, formatDateLabel, formatDayHeader,
  WEEK_DAY_LABELS,
} from '@/lib/time'
import { toCsv } from '@/lib/csv'
import { saveTimesheetSchema, isBlankEntry } from '@/lib/schemas'
import { summarizeZodError } from '@/lib/api'
import { composeSalaryText, buildAgreementSections } from '@/lib/document-templates'

/**
 * The week boundary a timesheet is filed against.
 *
 * Silent when wrong, like the timezone rules above it: the app keeps working and
 * simply files a Sunday's hours in the previous week, which nobody notices until
 * an invoice is short.
 */
describe('weekStartSunday', () => {
  it('returns the date itself when it is already a Sunday', () => {
    // 2026-08-16 is a Sunday.
    expect(weekStartSunday('2026-08-16')).toBe('2026-08-16')
  })

  it('walks back to the enclosing Sunday from every other day', () => {
    expect(weekStartSunday('2026-08-17')).toBe('2026-08-16') // Monday
    expect(weekStartSunday('2026-08-20')).toBe('2026-08-16') // Thursday
    expect(weekStartSunday('2026-08-22')).toBe('2026-08-16') // Saturday
  })

  it('crosses a month boundary correctly', () => {
    // 2026-09-01 is a Tuesday; its week starts on 2026-08-30.
    expect(weekStartSunday('2026-09-01')).toBe('2026-08-30')
  })

  it('crosses a year boundary correctly', () => {
    // 2027-01-01 is a Friday; its week starts on 2026-12-27.
    expect(weekStartSunday('2027-01-01')).toBe('2026-12-27')
  })

  it('is idempotent — normalising twice changes nothing', () => {
    for (const date of ['2026-08-17', '2026-02-28', '2024-02-29', '2026-12-31']) {
      expect(weekStartSunday(weekStartSunday(date))).toBe(weekStartSunday(date))
    }
  })

  it('is unaffected by DST, which a 7 * 86_400_000 shift would not be', () => {
    // 2026-03-08 is the US spring-forward Sunday; the 9th must still map to it.
    expect(weekStartSunday('2026-03-09')).toBe('2026-03-08')
    expect(weekStartSunday('2026-03-14')).toBe('2026-03-08')
  })
})

describe('timesheetWeek', () => {
  it('returns seven consecutive dates starting on the Sunday', () => {
    expect(timesheetWeek('2026-08-19')).toEqual([
      '2026-08-16', '2026-08-17', '2026-08-18', '2026-08-19',
      '2026-08-20', '2026-08-21', '2026-08-22',
    ])
  })

  it('lines up with the column labels the grid renders', () => {
    const week = timesheetWeek('2026-08-19')
    week.forEach((date, index) => {
      expect(formatDayHeader(date).startsWith(WEEK_DAY_LABELS[index])).toBe(true)
    })
  })
})

describe('formatPeriod', () => {
  it('reads as a calendar range, not an instant', () => {
    expect(formatPeriod('2026-08-16', '2026-08-22')).toBe('Aug 16, 2026 – Aug 22, 2026')
  })

  it('does not shift the day, whatever the reader timezone is', () => {
    // A `new Date('2026-08-16')` parsed as UTC and rendered in a negative offset
    // would print the 15th. These are formatted from the string parts instead.
    expect(formatDateLabel('2026-01-01')).toBe('Jan 1, 2026')
    expect(formatDateLabel('2026-12-31')).toBe('Dec 31, 2026')
  })

  it('renders a missing date as an em dash rather than "Invalid Date"', () => {
    expect(formatDateLabel(null)).toBe('—')
    expect(formatDateLabel(undefined)).toBe('—')
  })
})

/**
 * CSV export.
 *
 * The formula cases are the security-relevant ones: a cell a person typed that
 * begins with `=` is executable content in Excel and Sheets, and a timesheet
 * comment is a person-typed cell that ends up in an exported file someone else
 * opens.
 */
describe('toCsv', () => {
  it('quotes cells containing a comma, a quote or a newline', () => {
    const csv = toCsv(
      ['a', 'b', 'c'],
      [['plain', 'has, comma', 'has "quotes"'], ['line\nbreak', '', null]]
    )
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('a,b,c')
    expect(lines[1]).toBe('plain,"has, comma","has ""quotes"""')
    expect(lines[2]).toContain('"line\nbreak"')
  })

  it('neutralises formula injection in every trigger character', () => {
    const csv = toCsv(
      ['comment'],
      [
        ['=HYPERLINK("http://evil.example","click")'],
        ['+1+1'],
        ['-1+1'],
        ['@SUM(A1:A9)'],
      ]
    )

    // The apostrophe goes on the VALUE, so a cell that also needs quoting comes
    // back as `"'=HYPERLINK(…)"` — quoted on the outside, defused on the inside.
    // Unwrap before asserting, or the test only checks the quoting.
    const unquote = (cell: string) =>
      cell.startsWith('"') ? cell.slice(1, -1).replace(/""/g, '"') : cell

    for (const row of csv.split('\r\n').slice(1)) {
      expect(unquote(row).startsWith("'")).toBe(true)
    }
  })

  it('leaves an ordinary negative number readable after escaping', () => {
    // It is still prefixed — correctness beats prettiness here, and the hours
    // columns are never negative.
    expect(toCsv(['n'], [[-4]]).split('\r\n')[1]).toBe("'-4")
  })

  it('renders null and undefined as empty cells, not as the words', () => {
    expect(toCsv(['a', 'b'], [[null, undefined]]).split('\r\n')[1]).toBe(',')
  })
})

/**
 * Document boilerplate. The two things worth pinning: the compensation sentence
 * a real offer letter prints, and the fact that the visa clause is off unless
 * someone turns it on.
 */
describe('composeSalaryText', () => {
  it('adds a currency symbol to a bare number and spells out the cadence', () => {
    expect(composeSalaryText('72,800', 'annual')).toContain('$72,800 per annum')
    expect(composeSalaryText('3000', 'monthly')).toContain('$3000 per month')
    expect(composeSalaryText('55', 'hourly')).toContain('$55 per hour')
  })

  it('leaves an amount that already carries wording alone', () => {
    expect(composeSalaryText('USD 72,800', 'annual')).toContain('USD 72,800 per annum')
  })

  it('degrades to a neutral phrase rather than printing an empty amount', () => {
    expect(composeSalaryText('', 'annual')).toBe('the agreed compensation')
  })
})

describe('buildAgreementSections', () => {
  const vars = {
    companyName: 'Northwind Talent LLC',
    employeeName: 'Priya Sharma',
    jobTitle: 'Data Engineer',
    employmentType: 'Full-Time',
    startDate: 'Jun 17, 2026',
    salaryText: composeSalaryText('72,800', 'annual'),
    workLocation: 'Remote',
    governingState: 'Maryland',
    visaType: 'H1B',
  }

  it('produces every clause with the org and role interpolated', () => {
    const sections = buildAgreementSections(vars)
    expect(sections.length).toBe(17)
    const services = sections.find((section) => section.key === 'services')
    expect(services?.body).toContain('Northwind Talent LLC')
    expect(services?.body).toContain('Data Engineer')
  })

  it('leaves the visa clause OFF by default — most hires do not need it', () => {
    const sections = buildAgreementSections(vars)
    const visa = sections.find((section) => section.key === 'visa')
    expect(visa?.enabled).toBe(false)
    expect(visa?.optional).toBe(true)
    // Everything else is on, so a document generated without touching the form
    // is complete.
    expect(sections.filter((section) => !section.enabled)).toHaveLength(1)
  })
})

/**
 * The save payload.
 *
 * These cases are the ones the grid actually produces, and one of them shipped
 * broken: a line with hours, no project and no task description was refused by
 * the schema, the refusal was rendered behind the confirmation dialog, and the
 * employee saw a spinner stop with no explanation and their week unsaved.
 */
describe('saveTimesheetSchema', () => {
  const line = (over: Partial<Record<string, unknown>> = {}) => ({
    projectId: null,
    billable: true,
    hoursSun: 0, hoursMon: 0, hoursTue: 0, hoursWed: 0,
    hoursThu: 0, hoursFri: 0, hoursSat: 0,
    ...over,
  })

  it('accepts hours described by a task when the employee is on no project', () => {
    const parsed = saveTimesheetSchema.parse({
      entries: [line({ taskName: 'Client onboarding calls', hoursSun: 2 })],
      submit: true,
    })
    expect(parsed.entries).toHaveLength(1)
    expect(parsed.entries[0].hoursSun).toBe(2)
  })

  it('accepts hours attributed to a project with no task description', () => {
    const parsed = saveTimesheetSchema.parse({
      entries: [line({ projectId: '11111111-1111-4111-8111-111111111111', hoursMon: 8 })],
      submit: true,
    })
    expect(parsed.entries[0].projectId).toBe('11111111-1111-4111-8111-111111111111')
  })

  it('refuses hours that name neither a project nor a task', () => {
    const result = saveTimesheetSchema.safeParse({
      entries: [line({ hoursSun: 2 })],
      submit: true,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['entries', 0, 'taskName'])
    }
  })

  it("accepts the grid's trailing blank line, which carries nothing at all", () => {
    // The editor always keeps one empty row at the bottom. Refusing it made an
    // untouched grid unsaveable.
    const parsed = saveTimesheetSchema.parse({ entries: [line()], submit: false })
    expect(parsed.entries).toHaveLength(1)
    expect(isBlankEntry(parsed.entries[0])).toBe(true)
  })

  it('refuses more than 24 hours in one day across separate lines', () => {
    // Each cell passes its own 0-24 check; only the whole week shows the problem.
    const result = saveTimesheetSchema.safeParse({
      entries: [
        line({ taskName: 'A', hoursTue: 20 }),
        line({ taskName: 'B', hoursTue: 8 }),
      ],
      submit: true,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('Tuesday')
      expect(result.error.issues[0].message).toContain('28')
    }
  })

  it('allows exactly 24 hours in a day', () => {
    const parsed = saveTimesheetSchema.parse({
      entries: [line({ taskName: 'A', hoursTue: 16 }), line({ taskName: 'B', hoursTue: 8 })],
      submit: true,
    })
    expect(parsed.entries).toHaveLength(2)
  })

  it('rounds hours to the two decimals the column actually stores', () => {
    // numeric(5,2) would round 2.555 to 2.56 on write and the grid would come
    // back showing a figure nobody typed.
    const parsed = saveTimesheetSchema.parse({
      entries: [line({ taskName: 'A', hoursWed: 2.555 })],
      submit: false,
    })
    expect(parsed.entries[0].hoursWed).toBe(2.56)
  })

  it('refuses a single cell over 24 hours', () => {
    const result = saveTimesheetSchema.safeParse({
      entries: [line({ taskName: 'A', hoursWed: 25 })],
      submit: false,
    })
    expect(result.success).toBe(false)
  })

  it('refuses a negative cell', () => {
    const result = saveTimesheetSchema.safeParse({
      entries: [line({ taskName: 'A', hoursWed: -1 })],
      submit: false,
    })
    expect(result.success).toBe(false)
  })

  it('carries no status field, so a submit cannot smuggle one in', () => {
    const parsed = saveTimesheetSchema.parse({
      entries: [line({ taskName: 'A', hoursWed: 1 })],
      submit: true,
      status: 'approved',
    })
    expect(parsed).not.toHaveProperty('status')
  })
})

/**
 * The banner text a failed save shows. One reason is worth stating; several
 * reasons at once are not, because the result is a paragraph nobody reads.
 */
describe('summarizeZodError', () => {
  it('uses the single reason when there is exactly one', () => {
    const result = saveTimesheetSchema.safeParse({
      entries: [
        {
          projectId: null, billable: true,
          hoursSun: 2, hoursMon: 0, hoursTue: 0, hoursWed: 0,
          hoursThu: 0, hoursFri: 0, hoursSat: 0,
        },
      ],
      submit: true,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(summarizeZodError(result.error)).toBe(
        'Pick a project or describe the task for this line'
      )
    }
  })

  it('falls back to the generic line when the reasons differ', () => {
    const result = saveTimesheetSchema.safeParse({
      entries: [
        {
          projectId: null, taskName: 'A', billable: true,
          hoursSun: -5, hoursMon: 0, hoursTue: 0, hoursWed: 0,
          hoursThu: 0, hoursFri: 0, hoursSat: 0,
        },
        {
          projectId: null, taskName: 'B', billable: true,
          hoursSun: 0, hoursMon: 30, hoursTue: 0, hoursWed: 0,
          hoursThu: 0, hoursFri: 0, hoursSat: 0,
        },
      ],
      submit: true,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(new Set(result.error.issues.map((i) => i.message)).size).toBeGreaterThan(1)
      expect(summarizeZodError(result.error)).toBe('Please check the highlighted fields')
    }
  })
})
