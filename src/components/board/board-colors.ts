/**
 * The eight swatches a board can wear. Shared by the board form and the route
 * that validates it, so the palette has one definition.
 */
export const BOARD_COLORS = [
  '#2563EB', '#16A34A', '#9333EA', '#DC2626',
  '#EA580C', '#0891B2', '#CA8A04', '#DB2777',
] as const

export const BOARD_COLOR_NAMES: Record<string, string> = {
  '#2563EB': 'Blue',
  '#16A34A': 'Green',
  '#9333EA': 'Purple',
  '#DC2626': 'Red',
  '#EA580C': 'Orange',
  '#0891B2': 'Teal',
  '#CA8A04': 'Gold',
  '#DB2777': 'Pink',
}
