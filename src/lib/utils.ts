import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merge conditional class names, letting later Tailwind classes win. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** "Ada Lovelace" -> "AL". Falls back to the email's first letter. */
export function initials(name?: string | null, email?: string | null): string {
  const source = (name || '').trim()
  if (source) {
    const parts = source.split(/\s+/).filter(Boolean)
    return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
  }
  return (email || '?').charAt(0).toUpperCase()
}

export function formatMoney(amount: number | string | null | undefined, currency = 'USD'): string {
  const n = typeof amount === 'string' ? parseFloat(amount) : (amount ?? 0)
  if (!Number.isFinite(n)) return '—'
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(n)
  } catch {
    return `${currency} ${n.toFixed(2)}`
  }
}

export function formatHours(hours: number | string | null | undefined): string {
  const n = typeof hours === 'string' ? parseFloat(hours) : (hours ?? 0)
  if (!Number.isFinite(n) || n <= 0) return '—'
  const h = Math.floor(n)
  const m = Math.round((n - h) * 60)
  return m ? `${h}h ${m}m` : `${h}h`
}

/** Title-case a slug/enum value for display: `needs_reauth` -> `Needs reauth`. */
export function humanize(value?: string | null): string {
  if (!value) return ''
  const s = value.replace(/[_-]+/g, ' ').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Clamp a string for display without cutting mid-word when avoidable. */
export function truncate(text: string, max = 80): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return `${lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut}…`
}

/**
 * Readable contrast colour for a hex background — used so an org's custom
 * primary colour never ends up with unreadable label text on top of it.
 */
export function contrastOn(hex: string): '#FFFFFF' | '#0F172A' {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return '#FFFFFF'
  const int = parseInt(m[1], 16)
  const r = (int >> 16) & 255
  const g = (int >> 8) & 255
  const b = int & 255
  // Relative luminance (sRGB, simplified).
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.6 ? '#0F172A' : '#FFFFFF'
}

/** Hex -> `H S% L%` so a custom brand colour can be written into a CSS variable. */
export function hexToHslTriple(hex: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return null
  const int = parseInt(m[1], 16)
  const r = ((int >> 16) & 255) / 255
  const g = ((int >> 8) & 255) / 255
  const b = (int & 255) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break
      case g: h = (b - r) / d + 2; break
      default: h = (r - g) / d + 4
    }
    h /= 6
  }

  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`
}

/** Shift an HSL triple's lightness — derives hover/tint shades from one colour. */
export function shiftLightness(triple: string, delta: number): string {
  const parts = triple.split(/\s+/)
  if (parts.length !== 3) return triple
  const l = parseFloat(parts[2])
  if (!Number.isFinite(l)) return triple
  return `${parts[0]} ${parts[1]} ${Math.min(97, Math.max(6, Math.round(l + delta)))}%`
}

/* ------------------------------------------------- Readable brand colours */

interface Hsl {
  h: number
  s: number
  l: number
}

function parseHsl(hex: string): Hsl | null {
  const triple = hexToHslTriple(hex)
  if (!triple) return null
  const [h, s, l] = triple.split(/\s+/).map((part) => parseFloat(part))
  return { h, s, l }
}

function hslToRgb({ h, s, l }: Hsl): [number, number, number] {
  const sat = s / 100
  const light = l / 100
  const chroma = (1 - Math.abs(2 * light - 1)) * sat
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = light - chroma / 2
  const [r, g, b] =
    h < 60 ? [chroma, x, 0]
    : h < 120 ? [x, chroma, 0]
    : h < 180 ? [0, chroma, x]
    : h < 240 ? [0, x, chroma]
    : h < 300 ? [x, 0, chroma]
    : [chroma, 0, x]
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
}

/** WCAG relative luminance of an sRGB colour given as 0-255 channels. */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG contrast ratio between two 0-255 RGB colours (1 to 21). */
export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const WHITE: [number, number, number] = [255, 255, 255]
/** The dark theme's card surface (#0F172A), which brand text has to read on. */
const DARK_CARD: [number, number, number] = [15, 23, 42]

/** Body-text contrast with a little headroom over the WCAG AA line of 4.5. */
const READABLE = 4.6

/**
 * The tenant's colour, adjusted just enough to be readable as TEXT — the value
 * behind `text-brand-ink`.
 *
 * A tenant picks a colour for how it looks as a button, and a button can be any
 * lightness. The same colour as a 13px link on white can be unreadable (yellow
 * is 1.5:1). Hue and saturation are kept, so it is recognisably the same
 * colour; only lightness moves — down on a light surface, up on a dark one —
 * and only if it has to.
 */
export function brandInk(hex: string, surface: 'light' | 'dark'): string | null {
  const start = parseHsl(hex)
  if (!start) return null
  const background = surface === 'light' ? WHITE : DARK_CARD
  const step = surface === 'light' ? -1 : 1
  const limit = surface === 'light' ? 8 : 92

  let l = surface === 'light' ? start.l : Math.max(start.l, 55)
  while (l !== limit && contrastRatio(hslToRgb({ ...start, l }), background) < READABLE) l += step
  return `${start.h} ${start.s}% ${l}%`
}

/**
 * Light-theme washes for a tenant colour, at FIXED lightness (96 / 91 / 82%).
 *
 * They used to be the colour's own lightness plus a constant, which is only a
 * tint if the colour starts out mid-tone: a deep teal (32%) came out at 83% —
 * a loud pastel slab rather than a hint of colour behind a chip. Pinning the
 * lightness makes every tenant's `bg-brand-50` equally quiet, whatever they
 * picked, and matches the platform orange's own tints.
 */
export function brandLightTints(hex: string): { 50: string; 100: string; 200: string } | null {
  const hsl = parseHsl(hex)
  if (!hsl) return null
  return { 50: `${hsl.h} ${hsl.s}% 96%`, 100: `${hsl.h} ${hsl.s}% 91%`, 200: `${hsl.h} ${hsl.s}% 82%` }
}

/**
 * Dark-theme washes for a tenant colour: the same hue as a faint warm tint, so
 * `bg-brand-50` is a subtle chip on a dark card rather than a pale slab.
 */
export function brandDarkTints(hex: string): { 50: string; 100: string; 200: string } | null {
  const hsl = parseHsl(hex)
  if (!hsl) return null
  const s = Math.min(hsl.s, 55)
  return { 50: `${hsl.h} ${s}% 12%`, 100: `${hsl.h} ${s}% 15%`, 200: `${hsl.h} ${s}% 22%` }
}
