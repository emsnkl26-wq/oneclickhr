/**
 * CSV text, safe to open in a spreadsheet — see src/lib/csv.ts for the two
 * things this gets right (quoting, formula injection). Directive-free so a
 * server route can build the same file the browser does.
 */

/** Excel treats a leading one of these as the start of a formula. */
const FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r']

function escapeCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  let text = String(value)

  if (FORMULA_TRIGGERS.some((trigger) => text.startsWith(trigger))) {
    text = `'${text}`
  }
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

export type CsvValue = string | number | null | undefined

export function toCsv(headers: string[], rows: CsvValue[][]): string {
  const lines = [headers.map(escapeCell).join(',')]
  for (const row of rows) lines.push(row.map(escapeCell).join(','))
  return lines.join('\r\n')
}
