'use client'

import { usePalette } from './dashboard-palette'

/**
 * Today's attendance rate as a ring.
 *
 * Hand-drawn SVG rather than a charting component: it is one number, and the
 * ring is a frame for it, not a plot. The percentage is printed in the middle,
 * so the colour is decoration and the value is always readable — including in
 * forced-colours mode, where the arc may not render at all.
 *
 * It sits in its own module because it is the only dashboard visual that does
 * NOT depend on `recharts`. Sharing a file with the plots meant the ~105kB
 * charting bundle had to arrive before this ring — one circle and a number —
 * could render, on the page every org user lands on. Split out, it renders with
 * the server markup and the plots stream in behind it.
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
