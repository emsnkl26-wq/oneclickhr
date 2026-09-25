'use client'

import { useTheme } from '@/components/theme-provider'

/**
 * The one palette the dashboard's visuals share — one series, in the brand
 * orange (Orange Dark on light, a step brighter on dark), on slate neutrals.
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
  light: { series: '#F24400', fillTop: 0.22, grid: '#E2E8F0', axis: '#64748B' },
  dark: { series: '#FF7A1A', fillTop: 0.3, grid: '#243247', axis: '#94A3B8' },
}

export function usePalette() {
  const { theme } = useTheme()
  return theme === 'dark' ? PALETTE.dark : PALETTE.light
}
