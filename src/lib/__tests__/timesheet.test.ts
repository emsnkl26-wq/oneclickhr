import { describe, it, expect } from 'vitest'
import {
  weekStartSunday, timesheetWeek, formatPeriod, formatDateLabel, formatDayHeader,
  WEEK_DAY_LABELS,
} from '@/lib/time'
import { toCsv } from '@/lib/csv'
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
