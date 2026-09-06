'use client'

import { useTheme } from '@/components/theme-provider'

/**
 * The one palette the dashboard's visuals share.
 *
 * It lives in its own module for a build reason, not a stylistic one: the gauge
 * and the two plots both need it, but only the plots need `recharts`. Keeping
 * the palette here lets `dashboard-gauge.tsx` stay free of that import, which is
 * what allows the charts to be code-split away from it.
 *
 * WHY LITERAL HEX AND NOT TOKENS. Recharts writes `fill` and `stroke` as SVG
 * PRESENTATION ATTRIBUTES, where `var(--token)` is not resolved — it is only
 * valid inside a CSS declaration. So the theme is read once through `useTheme()`
 * and the matching hex is handed to the chart.
 */
export const PALETTE = {
  light: { series: '#2a78d6', fillTop: 0.22, grid: '#E7E9EE', axis: '#6B7280' },
  dark: { series: '#3987e5', fillTop: 0.3, grid: '#2A2E39', axis: '#9AA0AE' },
}

export function usePalette() {
  const { theme } = useTheme()
  return theme === 'dark' ? PALETTE.dark : PALETTE.light
}
