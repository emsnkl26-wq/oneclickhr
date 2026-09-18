'use client'

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { usePalette } from '@/app/org/dashboard-palette'

export interface WeekPoint {
  /** Axis tick, e.g. "12 Feb". */
  label: string
  /** Tooltip heading — the full week range. */
  fullLabel: string
  hours: number
}

function ChartTooltip({
  active, payload,
}: {
  active?: boolean
  payload?: Array<{ value?: number | string; payload?: WeekPoint }>
}) {
  if (!active || !payload?.length) return null
  const point = payload[0]
  return (
    <div className="rounded-lg border border-line bg-card px-3 py-2 shadow-pop">
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
        {point.payload?.fullLabel}
      </p>
      <p className="tabular mt-0.5 text-sm font-semibold text-ink">{point.value} h</p>
    </div>
  )
}

/**
 * Hours logged on the project per week, oldest on the left. One series — the
 * question is only "how much work went in each week?". Reached through
 * `weekly-hours-chart-loader.tsx` so recharts stays out of the initial bundle.
 */
export function WeeklyHoursChart({ data }: { data: WeekPoint[] }) {
  const palette = usePalette()
  return (
    <div className="h-[180px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid stroke={palette.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fill: palette.axis, fontSize: 11 }}
          />
          <YAxis
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            tick={{ fill: palette.axis, fontSize: 11 }}
          />
          <Tooltip cursor={{ fill: palette.grid, fillOpacity: 0.45 }} content={<ChartTooltip />} />
          <Bar dataKey="hours" fill={palette.series} radius={[4, 4, 0, 0]} maxBarSize={36} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
