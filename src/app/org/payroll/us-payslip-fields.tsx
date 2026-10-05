'use client'

import * as React from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { FormField } from '@/components/ui/form-field'
import { daysInMonth } from '@/lib/payslip-pdf'
import type { UsPayslipDetails } from '@/lib/payslip-us-pdf'

/**
 * The US earnings statement's inputs (056), as the dialog edits them.
 *
 * Year-to-date is entered as what was paid BEFORE this period; the slip prints
 * that plus this period's amount. That way changing this month's figure can
 * never leave a year-to-date total that disagrees with it.
 */
export interface UsEarningDraft {
  label: string
  rate: string
  hours: string
  amount: string
  priorYtd: string
}

export interface UsDeductionDraft {
  label: string
  amount: string
  priorYtd: string
}

export interface UsDraft {
  companyCode: string
  locDept: string
  voucherNumber: string
  periodStart: string
  periodEnd: string
  payDate: string
  filingStatus: string
  federalAllowances: string
  stateAllowances: string
  localAllowances: string
  federalAdditional: string
  addressLines: string[]
  basisOfPay: string
  accountType: string
  accountLast4: string
  earnings: UsEarningDraft[]
  deductions: UsDeductionDraft[]
}

const num = (value: string) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}
const round2 = (value: number) => Math.round(value * 100) / 100
const text = (value: number) => (value ? String(round2(value)) : '0')

export const US_FILING_STATUSES = ['Single', 'Married', 'Married filing separately', 'Head of household']

/** Social Security and Medicare employee shares. */
const SOCIAL_SECURITY_RATE = 0.062
const MEDICARE_RATE = 0.0145

export interface UsDraftSource {
  month: number
  year: number
  orgCode: string | null
  monthlyPay: number
  hourly: boolean
  hourlyRate: number | null
  addressLines: string[]
  accountType: string | null
  /** The employee's last US slip, if any. */
  previous: UsPayslipDetails | null
}

/** The month's first and last day, ISO. */
function monthRange(month: number, year: number): [string, string] {
  const mm = String(month).padStart(2, '0')
  return [`${year}-${mm}-01`, `${year}-${mm}-${String(daysInMonth(month, year)).padStart(2, '0')}`]
}

/**
 * The year-to-date carried into this period from the last slip: its YTD when
 * it was an earlier period this year, its YTD less its own amount when it is a
 * re-issue of this very period, and nothing in a new year.
 */
function carried(previous: UsPayslipDetails | null, start: string, year: number) {
  if (!previous || !previous.periodStart.startsWith(String(year))) return () => 0
  const reissue = previous.periodStart >= start
  return (line: { ytd: number; amount: number }) => (reissue ? line.ytd - line.amount : line.ytd)
}

export function defaultUsDraft(source: UsDraftSource): UsDraft {
  const [start, end] = monthRange(source.month, source.year)
  const previous = source.previous
  const prior = carried(previous, start, source.year)
  const gross = source.hourly ? 0 : round2(source.monthlyPay)

  const earnings: UsEarningDraft[] = previous?.earnings.length
    ? previous.earnings.map((line) => ({
        label: line.label,
        rate: line.rate == null ? '' : String(line.rate),
        hours: line.hours == null ? '' : String(line.hours),
        amount: String(line.amount),
        priorYtd: text(prior(line)),
      }))
    : [
        {
          label: 'Regular',
          rate: source.hourly && source.hourlyRate ? String(source.hourlyRate) : '',
          hours: source.hourly ? '' : '0',
          amount: text(gross),
          priorYtd: '0',
        },
      ]

  const deductions: UsDeductionDraft[] = previous?.deductions.length
    ? previous.deductions.map((line) => ({
        label: line.label,
        amount: String(line.amount),
        priorYtd: text(prior(line)),
      }))
    : [
        { label: 'Federal Income', amount: '0', priorYtd: '0' },
        { label: 'Social Security', amount: text(gross * SOCIAL_SECURITY_RATE), priorYtd: '0' },
        { label: 'Medicare', amount: text(gross * MEDICARE_RATE), priorYtd: '0' },
        { label: 'State Income', amount: '0', priorYtd: '0' },
      ]

  return {
    companyCode: previous?.companyCode ?? source.orgCode ?? '',
    locDept: previous?.locDept ?? '01/',
    voucherNumber: `${source.year}${String(source.month).padStart(2, '0')}`,
    periodStart: start,
    periodEnd: end,
    payDate: end,
    filingStatus: previous?.filingStatus || 'Single',
    federalAllowances: previous?.federalAllowances || 'Std W/H Table',
    stateAllowances: previous?.stateAllowances || '0',
    localAllowances: previous?.localAllowances || '0',
    federalAdditional: previous?.federalAdditional || '0.00',
    addressLines: previous?.addressLines.length ? previous.addressLines : source.addressLines,
    basisOfPay: previous?.basisOfPay || (source.hourly ? 'Hourly' : 'Salaried'),
    accountType: previous?.accountType || source.accountType || 'Checking',
    accountLast4: previous?.accountLast4 ?? '',
    earnings,
    deductions,
  }
}

/** The draft as the PDF and the API take it. */
export function usDetailsFromDraft(draft: UsDraft): UsPayslipDetails {
  return {
    format: 'us',
    companyCode: draft.companyCode.trim(),
    locDept: draft.locDept.trim(),
    voucherNumber: draft.voucherNumber.trim(),
    periodStart: draft.periodStart,
    periodEnd: draft.periodEnd,
    payDate: draft.payDate,
    filingStatus: draft.filingStatus.trim(),
    federalAllowances: draft.federalAllowances.trim(),
    stateAllowances: draft.stateAllowances.trim(),
    localAllowances: draft.localAllowances.trim(),
    federalAdditional: draft.federalAdditional.trim(),
    addressLines: draft.addressLines.map((line) => line.trim()).filter(Boolean),
    basisOfPay: draft.basisOfPay.trim(),
    accountType: draft.accountType.trim(),
    accountLast4: draft.accountLast4.replace(/\D/g, '').slice(-4),
    earnings: draft.earnings
      .filter((line) => line.label.trim())
      .map((line) => ({
        label: line.label.trim(),
        rate: line.rate.trim() ? num(line.rate) : null,
        hours: line.hours.trim() ? num(line.hours) : null,
        amount: round2(num(line.amount)),
        ytd: round2(num(line.priorYtd) + num(line.amount)),
      })),
    deductions: draft.deductions
      .filter((line) => line.label.trim())
      .map((line) => ({
        label: line.label.trim(),
        amount: round2(num(line.amount)),
        ytd: round2(num(line.priorYtd) + num(line.amount)),
      })),
  }
}

export function UsPayslipFields({ value, onChange }: { value: UsDraft; onChange: (next: UsDraft) => void }) {
  const set = <K extends keyof UsDraft>(key: K, next: UsDraft[K]) => onChange({ ...value, [key]: next })

  function setEarning(index: number, patch: Partial<UsEarningDraft>) {
    const earnings = value.earnings.map((line, i) => {
      if (i !== index) return line
      const merged = { ...line, ...patch }
      // Hours × rate fills the amount; typing an amount directly still wins.
      if (('rate' in patch || 'hours' in patch) && merged.rate.trim() && merged.hours.trim()) {
        merged.amount = text(num(merged.rate) * num(merged.hours))
      }
      return merged
    })
    set('earnings', earnings)
  }

  function setDeduction(index: number, patch: Partial<UsDeductionDraft>) {
    set('deductions', value.deductions.map((line, i) => (i === index ? { ...line, ...patch } : line)))
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label="Period starting">
          <Input type="date" value={value.periodStart} onChange={(e) => set('periodStart', e.target.value)} />
        </FormField>
        <FormField label="Period ending">
          <Input type="date" value={value.periodEnd} onChange={(e) => set('periodEnd', e.target.value)} />
        </FormField>
        <FormField label="Pay date">
          <Input type="date" value={value.payDate} onChange={(e) => set('payDate', e.target.value)} />
        </FormField>
        <FormField label="Company code">
          <Input value={value.companyCode} maxLength={40} onChange={(e) => set('companyCode', e.target.value)} />
        </FormField>
        <FormField label="Loc/Dept">
          <Input value={value.locDept} maxLength={20} onChange={(e) => set('locDept', e.target.value)} />
        </FormField>
        <FormField label="Statement number">
          <Input value={value.voucherNumber} maxLength={20} onChange={(e) => set('voucherNumber', e.target.value)} />
        </FormField>
        <FormField label="Filing status">
          <Select value={value.filingStatus} onChange={(e) => set('filingStatus', e.target.value)}>
            {US_FILING_STATUSES.map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </Select>
        </FormField>
        <FormField label="Federal allowances">
          <Input value={value.federalAllowances} maxLength={40} onChange={(e) => set('federalAllowances', e.target.value)} />
        </FormField>
        <FormField label="Federal additional W/H">
          <Input value={value.federalAdditional} maxLength={20} onChange={(e) => set('federalAdditional', e.target.value)} />
        </FormField>
        <FormField label="State allowances">
          <Input value={value.stateAllowances} maxLength={20} onChange={(e) => set('stateAllowances', e.target.value)} />
        </FormField>
        <FormField label="Local allowances">
          <Input value={value.localAllowances} maxLength={20} onChange={(e) => set('localAllowances', e.target.value)} />
        </FormField>
        <FormField label="Basis of pay">
          <Select value={value.basisOfPay} onChange={(e) => set('basisOfPay', e.target.value)}>
            <option value="Salaried">Salaried</option>
            <option value="Hourly">Hourly</option>
          </Select>
        </FormField>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Mailing address" hint="Printed under the employee's name. One line each.">
          <div className="space-y-2">
            {[0, 1, 2].map((index) => (
              <Input
                key={index}
                value={value.addressLines[index] ?? ''}
                maxLength={120}
                placeholder={['2100 Escorial Place', 'Apt 201', 'Palm Beach Gardens, FL 33410'][index]}
                onChange={(e) => {
                  const lines = [...value.addressLines]
                  lines[index] = e.target.value
                  set('addressLines', lines)
                }}
              />
            ))}
          </div>
        </FormField>
        <div className="space-y-4">
          <FormField label="Deposit account type">
            <Select value={value.accountType} onChange={(e) => set('accountType', e.target.value)}>
              <option value="Checking">Checking</option>
              <option value="Savings">Savings</option>
            </Select>
          </FormField>
          <FormField label="Account — last 4 digits" hint="The slip shows only these, masked.">
            <Input
              value={value.accountLast4}
              inputMode="numeric"
              maxLength={4}
              placeholder="3952"
              onChange={(e) => set('accountLast4', e.target.value.replace(/\D/g, '').slice(0, 4))}
            />
          </FormField>
        </div>
      </div>

      <LineTable
        title="Earnings"
        columns={['Description', 'Rate', 'Hours', 'This period', 'YTD before']}
        rows={value.earnings.map((line, index) => [
          <Input key="l" value={line.label} maxLength={60} onChange={(e) => setEarning(index, { label: e.target.value })} />,
          <Input key="r" type="number" min="0" step="0.01" value={line.rate} onChange={(e) => setEarning(index, { rate: e.target.value })} />,
          <Input key="h" type="number" min="0" step="0.01" value={line.hours} onChange={(e) => setEarning(index, { hours: e.target.value })} />,
          <Input key="a" type="number" min="0" step="0.01" value={line.amount} onChange={(e) => setEarning(index, { amount: e.target.value })} />,
          <Input key="y" type="number" min="0" step="0.01" value={line.priorYtd} onChange={(e) => setEarning(index, { priorYtd: e.target.value })} />,
        ])}
        onAdd={() => set('earnings', [...value.earnings, { label: '', rate: '', hours: '', amount: '0', priorYtd: '0' }])}
        onRemove={(index) => set('earnings', value.earnings.filter((_, i) => i !== index))}
        minRows={1}
      />

      <LineTable
        title="Statutory deductions"
        columns={['Description', 'This period', 'YTD before']}
        rows={value.deductions.map((line, index) => [
          <Input key="l" value={line.label} maxLength={60} onChange={(e) => setDeduction(index, { label: e.target.value })} />,
          <Input key="a" type="number" min="0" step="0.01" value={line.amount} onChange={(e) => setDeduction(index, { amount: e.target.value })} />,
          <Input key="y" type="number" min="0" step="0.01" value={line.priorYtd} onChange={(e) => setDeduction(index, { priorYtd: e.target.value })} />,
        ])}
        onAdd={() => set('deductions', [...value.deductions, { label: '', amount: '0', priorYtd: '0' }])}
        onRemove={(index) => set('deductions', value.deductions.filter((_, i) => i !== index))}
        minRows={0}
      />
    </div>
  )
}

function LineTable({
  title, columns, rows, onAdd, onRemove, minRows,
}: {
  title: string
  columns: string[]
  rows: React.ReactNode[][]
  onAdd: () => void
  onRemove: (index: number) => void
  minRows: number
}) {
  const template = `minmax(8rem,2fr) repeat(${columns.length - 1}, minmax(5.5rem,1fr)) 2rem`
  return (
    <fieldset className="min-w-0 rounded-xl border border-line">
      <legend className="sr-only">{title}</legend>
      <div className="flex items-center justify-between border-b border-line bg-page px-3.5 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{title}</span>
        <Button size="sm" variant="ghost" onClick={onAdd} disabled={rows.length >= 12}>
          <Plus />
          Add line
        </Button>
      </div>
      <div className="scrollbar-thin overflow-x-auto">
        <div className="min-w-[560px] space-y-2 p-3">
          <div className="grid gap-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted" style={{ gridTemplateColumns: template }}>
            {columns.map((column) => (
              <span key={column}>{column}</span>
            ))}
            <span />
          </div>
          {rows.map((cells, index) => (
            <div key={index} className="grid items-center gap-2" style={{ gridTemplateColumns: template }}>
              {cells}
              <button
                type="button"
                aria-label="Remove line"
                disabled={rows.length <= minRows}
                onClick={() => onRemove(index)}
                className="grid size-8 place-items-center rounded-md text-ink-muted transition hover:bg-page hover:text-ink disabled:opacity-30"
              >
                <X className="size-4" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </fieldset>
  )
}
