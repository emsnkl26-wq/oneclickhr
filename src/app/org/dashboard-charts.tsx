'use client'

import * as React from 'react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts'
import { useTheme } from '@/components/theme-provider'

/**
 * The dashboard's two plots.
 *
 * WHY THE COLOURS ARE LITERALS AND NOT TOKENS. Recharts writes `fill` and
 * `stroke` as SVG PRESENTATION ATTRIBUTES, and `var(--token)` is not resolved
 * there — it is only valid inside a CSS declaration. So the theme is read once
 * through `useTheme()` and the matching hex is handed to the chart. Two steps of
 * one blue, each chosen for its own surface, rather than one colour dimmed.
 *
 * ONE SERIES PER PLOT, deliberately. Both charts answer a single question —
 * "how many people clocked in?" — so there is nothing for a second hue to name,
 * no legend to read and no colour-blind pair to get wrong. The comparison line
 * is headcount, drawn as a rule, not as a rival series.
 */

const PALETTE = {
  light: { series: '#2a78d6', fillTop: 0.22, grid: '#E7E9EE', axis: '#6B7280' },
  dark: { series: '#3987e5', fillTop: 0.3, grid: '#2A2E39', axis: '#9AA0AE' },
}

function usePalette() {
  const { theme } = useTheme()
  return theme === 'dark' ? PALETTE.dark : PALETTE.light
}

/* ------------------------------------------------------------------ Tooltip */

/**
 * The tooltip is ordinary markup on the app's own card tokens, so it follows the
 * theme without a second palette and matches every other floating surface in the
 * product. Recharts' default is a white box that is invisible in dark mode.
 */
function ChartTooltip({
  active, payload, label, suffix,
}: {
  active?: boolean
  payload?: Array<{ value?: number | string; payload?: { fullLabel?: string } }>
  label?: string | number
  suffix: string
}) {
  if (!active || !payload?.length) return null
  const point = payload[0]
  return (
    <div className="rounded-lg border border-line bg-card px-3 py-2 shadow-pop">
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
        {point.payload?.fullLabel ?? label}
      </p>
      <p className="tabular mt-0.5 text-sm font-semibold text-ink">
        {point.value} {suffix}
      </p>
    </div>
  )
}

/* ------------------------------------------------------- Attendance history */

export interface AttendancePoint {
  /** The axis tick — short, e.g. "12 Feb". */
  label: string
  /** The tooltip's heading — the full date. */
  fullLabel: string
  value: number
  /** Weekends are drawn recessive: a quiet Saturday is not a bad day. */
  weekend: boolean
}

/**
 * Clock-ins per day for the last fortnight.
 *
 * A BAR, not a line. The values are counts of discrete events on discrete days,
 * and a line between them implies a reading in between that does not exist. Bars
 * also make a zero legible as a gap rather than as a dip to the axis.
 */
export function AttendanceTrend({
  data, headcount,
}: {
  data: AttendancePoint[]
  headcount: number
}) {
  const palette = usePalette()
  const peak = Math.max(headcount, ...data.map((point) => point.value), 1)

  return (
    <div className="h-[220px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -22 }} barCategoryGap="26%">
          <CartesianGrid stroke={palette.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fill: palette.axis, fontSize: 11 }}
            interval="preserveStartEnd"
            minTickGap={12}
          />
          <YAxis
            allowDecimals={false}
            domain={[0, peak]}
            width={44}
            tickLine={false}
            axisLine={false}
            tick={{ fill: palette.axis, fontSize: 11 }}
          />
          <Tooltip
            cursor={{ fill: palette.grid, fillOpacity: 0.45 }}
            content={<ChartTooltip suffix="clocked in" />}
          />
          <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={26}>
            {data.map((point) => (
              <Cell
                key={point.label}
                fill={palette.series}
                fillOpacity={point.weekend ? 0.38 : 1}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/* ------------------------------------------------------------ Hours worked */

export interface HoursPoint {
  label: string
  fullLabel: string
  value: number
}

/**
 * Total hours logged per day — an AREA, because hours are a continuous quantity
 * accumulating through each day rather than a count of events, and the shape of
 * the fortnight is the thing being read, not any single value in it.
 */
export function HoursTrend({ data }: { data: HoursPoint[] }) {
  const palette = usePalette()

  return (
    <div className="h-[140px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: -30 }}>
          <defs>
            <linearGradient id="hours-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={palette.series} stopOpacity={palette.fillTop} />
              <stop offset="100%" stopColor={palette.series} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={palette.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fill: palette.axis, fontSize: 11 }}
            interval="preserveStartEnd"
            minTickGap={16}
          />
          <YAxis
            width={40}
            tickLine={false}
            axisLine={false}
            tick={{ fill: palette.axis, fontSize: 11 }}
          />
          <Tooltip
            cursor={{ stroke: palette.axis, strokeDasharray: '3 3' }}
            content={<ChartTooltip suffix="hours" />}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={palette.series}
            strokeWidth={2}
            fill="url(#hours-fill)"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: palette.series }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

/* ------------------------------------------------------------------- Gauge */

/**
 * Today's attendance rate as a ring.
 *
 * Hand-drawn SVG rather than a charting component: it is one number, and the
 * ring is a frame for it, not a plot. The percentage is printed in the middle,
 * so the colour is decoration and the value is always readable — including in
 * forced-colours mode, where the arc may not render at all.
 */
export function AttendanceGauge({
  present, total,
}: {
  present: number
  total: number
}) {
  const palette = usePalette()
  const rate = total > 0 ? Math.round((present / total) * 100) : 0

  const radius = 62
  const circumference = 2 * Math.PI * radius
  const dash = (Math.min(rate, 100) / 100) * circumference

  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <svg width="160" height="160" viewBox="0 0 160 160" role="img" aria-label={`${rate}% of the team has clocked in today`}>
          <circle
            cx="80" cy="80" r={radius}
            fill="none" stroke={palette.grid} strokeWidth="12"
          />
          <circle
            cx="80" cy="80" r={radius}
            fill="none" stroke={palette.series} strokeWidth="12" strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
            transform="rotate(-90 80 80)"
            className="transition-[stroke-dasharray] duration-700 ease-out"
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <div className="text-center">
            <p className="tabular text-[30px] font-bold leading-none tracking-[-0.02em] text-ink">
              {rate}%
            </p>
            <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-ink-muted">
              Clocked in
            </p>
          </div>
        </div>
      </div>
      <p className="mt-3 text-[13px] text-ink-muted">
        <span className="tabular font-semibold text-ink">{present}</span> of{' '}
        <span className="tabular font-semibold text-ink">{total}</span>{' '}
        {total === 1 ? 'person' : 'people'}
      </p>
    </div>
  )
}
