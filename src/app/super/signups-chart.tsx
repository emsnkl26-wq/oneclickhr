'use client'

import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'

/**
 * Weekly signups.
 *
 * One series, one colour — the brand orange — because a single-series chart
 * gains nothing from a palette. The grid is horizontal-only and the axes are
 * unadorned so the shape of the line is what reads first.
 */
export function SignupsChart({ data }: { data: Array<{ week: string; count: number }> }) {
  const total = data.reduce((sum, d) => sum + d.count, 0)

  if (total === 0) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-ink-muted">
        No signups in this period yet.
      </div>
    )
  }

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
          <defs>
            <linearGradient id="signupFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#FF6A00" stopOpacity={0.22} />
              <stop offset="100%" stopColor="#FF6A00" stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid stroke="#E2E8F0" vertical={false} />
          <XAxis
            dataKey="week"
            tickFormatter={(value: string) => value.slice(5)}
            tick={{ fontSize: 11, fill: '#64748B' }}
            tickLine={false}
            axisLine={{ stroke: '#E2E8F0' }}
            interval="preserveStartEnd"
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 11, fill: '#64748B' }}
            tickLine={false}
            axisLine={false}
            width={40}
          />
          <Tooltip
            cursor={{ stroke: '#E2E8F0' }}
            contentStyle={{
              borderRadius: 12,
              border: '1px solid #E2E8F0',
              boxShadow: '0 12px 40px -12px rgb(16 24 40 / 0.18)',
              fontSize: 13,
            }}
            labelFormatter={(value: string) => `Week of ${value}`}
            formatter={(value: number) => [value, 'Signups']}
          />
          <Area
            type="monotone"
            dataKey="count"
            stroke="#FF6A00"
            strokeWidth={2}
            fill="url(#signupFill)"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
