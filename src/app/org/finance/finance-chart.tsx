'use client'

import * as React from 'react'
import {
  Area, AreaChart, Bar, CartesianGrid, ComposedChart, Line, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { useTheme } from '@/components/theme-provider'
import { formatMoney } from '@/lib/utils'
import type { FinancePoint } from './finance-data'

/**
 * The Finance overview's plots — everything here that depends on `recharts`.
 *
 * Reached ONLY through `finance-chart-loader.tsx`, for the same bundle reason as
 * the dashboard's charts: a static import would put the charting library in the
 * route's initial JavaScript.
 *
 * Literal hex rather than tokens, as dashboard-palette.ts explains: recharts
 * writes SVG presentation attributes, where `var(--token)` does not resolve.
 */
const COLORS = {
  light: {
    earned: '#1f9d6b', expenses: '#e5484d', payroll: '#f08c00', net: '#2a78d6',
    grid: '#E2E8F0', axis: '#64748B', zero: '#94A3B8',
  },
  dark: {
    earned: '#34c38f', expenses: '#f2555a', payroll: '#f5a524', net: '#3987e5',
    grid: '#243247', axis: '#94A3B8', zero: '#64748B',
  },
}

function useColors() {
  const { theme } = useTheme()
  return theme === 'dark' ? COLORS.dark : COLORS.light
}

function compact(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1,
    }).format(value)
  } catch {
    return String(value)
  }
}

const SERIES_LABELS: Record<string, string> = {
  earned: 'Earned',
  expenses: 'Expenses',
  payroll: 'Payroll',
  net: 'Net',
  cumulative: 'Cumulative net',
}

function FinanceTooltip({
  active, payload, currency,
}: {
  active?: boolean
  payload?: Array<{ dataKey?: string | number; value?: number; color?: string; payload?: FinancePoint }>
  currency: string
}) {
  if (!active || !payload?.length) return null
  const point = payload[0].payload
  return (
    <div className="min-w-[180px] rounded-lg border border-line bg-card px-3 py-2 shadow-pop">
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
        {point?.fullLabel}
      </p>
      <dl className="mt-1 space-y-0.5">
        {payload.map((entry) => (
          <div key={String(entry.dataKey)} className="flex items-center justify-between gap-4 text-xs">
            <dt className="flex items-center gap-1.5 text-ink-muted">
              <span className="size-2 rounded-full" style={{ background: entry.color }} aria-hidden />
              {SERIES_LABELS[String(entry.dataKey)] ?? entry.dataKey}
            </dt>
            <dd className="tabular font-semibold text-ink">
              {formatMoney(Number(entry.value) || 0, currency)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function Legend({ items }: { items: Array<{ label: string; color: string; line?: boolean }> }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span
            className={item.line ? 'h-0.5 w-3.5 rounded-full' : 'size-2.5 rounded-sm'}
            style={{ background: item.color }}
            aria-hidden
          />
          {item.label}
        </li>
      ))}
    </ul>
  )
}

/**
 * Earned against spent per bucket, spent stacked by where it went, with net
 * drawn as a line across both — the one picture that answers "did we make
 * money, and why".
 */
export function EarnedSpentChart({ data, currency }: { data: FinancePoint[]; currency: string }) {
  const c = useColors()
  return (
    <div className="space-y-3">
      <Legend
        items={[
          { label: 'Earned (paid invoices)', color: c.earned },
          { label: 'Expenses', color: c.expenses },
          { label: 'Payroll', color: c.payroll },
          { label: 'Net', color: c.net, line: true },
        ]}
      />
      <div className="h-[320px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }} barGap={2}>
            <CartesianGrid stroke={c.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fill: c.axis, fontSize: 11 }}
              interval="preserveStartEnd"
              minTickGap={12}
            />
            <YAxis
              width={64}
              tickLine={false}
              axisLine={false}
              tick={{ fill: c.axis, fontSize: 11 }}
              tickFormatter={(v: number) => compact(v, currency)}
            />
            <ReferenceLine y={0} stroke={c.zero} />
            <Tooltip
              cursor={{ fill: c.grid, fillOpacity: 0.45 }}
              content={<FinanceTooltip currency={currency} />}
            />
            <Bar dataKey="earned" fill={c.earned} radius={[4, 4, 0, 0]} maxBarSize={28} />
            <Bar dataKey="expenses" stackId="spent" fill={c.expenses} maxBarSize={28} />
            <Bar dataKey="payroll" stackId="spent" fill={c.payroll} radius={[4, 4, 0, 0]} maxBarSize={28} />
            <Line
              type="monotone"
              dataKey="net"
              stroke={c.net}
              strokeWidth={2}
              dot={data.length <= 16 ? { r: 3, fill: c.net } : false}
              activeDot={{ r: 4 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/** Running net across the window — growth read as a shape, not a sum. */
export function CumulativeNetChart({ data, currency }: { data: FinancePoint[]; currency: string }) {
  const c = useColors()
  const last = data[data.length - 1]?.cumulative ?? 0
  const color = last >= 0 ? c.earned : c.expenses
  return (
    <div className="h-[180px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id="finance-cumulative" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.25} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={c.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fill: c.axis, fontSize: 11 }}
            interval="preserveStartEnd"
            minTickGap={16}
          />
          <YAxis
            width={64}
            tickLine={false}
            axisLine={false}
            tick={{ fill: c.axis, fontSize: 11 }}
            tickFormatter={(v: number) => compact(v, currency)}
          />
          <ReferenceLine y={0} stroke={c.zero} />
          <Tooltip
            cursor={{ stroke: c.axis, strokeDasharray: '3 3' }}
            content={<FinanceTooltip currency={currency} />}
          />
          <Area
            type="monotone"
            dataKey="cumulative"
            stroke={color}
            strokeWidth={2}
            fill="url(#finance-cumulative)"
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
