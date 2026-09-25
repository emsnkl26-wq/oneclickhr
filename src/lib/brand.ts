/**
 * OneclickHR brand constants — the one place the product's identity is written
 * down as data.
 *
 * NO IMPORTS, on purpose. This file is read by the app, by middleware-adjacent
 * code, by the email layout (which also runs from plain Node scripts) and by
 * `scripts/make-brand-assets.ts`. Anything it imported would follow it into all
 * of those.
 *
 * Source of truth for the VALUES is the brand kit:
 *
 *   Primary Orange  #FF6A00   main brand colour, CTAs, highlights
 *   Orange Dark     #F24400   hover states, active elements
 *   Charcoal        #0F172A   primary text, headings, dark surfaces
 *   Gray            #64748B   secondary text, icons
 *   Light Gray      #F1F5F9   backgrounds, borders
 *   Typeface        Inter (Bold / SemiBold / Medium / Regular)
 *
 * The same palette is mirrored as CSS variables in `src/app/globals.css`; keep
 * the two in step. `src/lib/__tests__/brand.test.ts` checks the assets below
 * against the files on disk.
 */

export const BRAND = {
  /** How the name is written in copy. The `HR` is capitalised in the wordmark. */
  name: 'OneclickHR',
  /** The candidate-facing job portal. */
  jobsName: 'OneclickHR Jobs',
  tagline: 'HR Management in One Click.',
  /** The default <title> and og:title: the name and the tagline, no full stop. */
  title: 'OneclickHR — HR Management in One Click',
  taglineShort: 'People. Processes. Progress.',
  description:
    'Modern HR & organization management — attendance, leave, payroll, work authorization and tasks in one calm place.',

  colors: {
    primary: '#FF6A00',
    primaryDark: '#F24400',
    charcoal: '#0F172A',
    gray: '#64748B',
    lightGray: '#F1F5F9',
    white: '#FFFFFF',
    /**
     * Orange for TEXT on a light surface. `primary` is 2.9:1 against white,
     * which is fine for a fill or an icon and not for a 13px link. This is the
     * same hue, deep enough for 5:1. See `--brand-ink` in globals.css.
     */
    ink: '#C2410C',
  },

  /** Browser chrome colour, per scheme. */
  themeColor: { light: '#FFFFFF', dark: '#0F172A' },
} as const

/** The colour a workspace gets until its owner picks one. */
export const DEFAULT_PRIMARY_COLOR = BRAND.colors.primary

/**
 * What the platform used before the rebrand. Existing workspaces still carry it
 * in `tenants.primary_color` until migration 054 rewrites it; kept here so the
 * one place that has to recognise it (see `brandCss`) can do so by name.
 */
export const LEGACY_PRIMARY_COLOR = '#C41E33'

/**
 * The colour to actually use for a stored workspace colour.
 *
 * Falls back to the platform orange for a missing or malformed value, and for
 * the pre-rebrand crimson: nobody CHOSE that, it was the column default, so a
 * workspace still carrying it should look like the new brand rather than the
 * old one. This is what keeps emails, PDFs and the UI in step whether or not
 * migration 054 has run yet.
 */
export function brandColorOrDefault(value: string | null | undefined): string {
  const color = (value ?? '').trim()
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return DEFAULT_PRIMARY_COLOR
  if (color.toLowerCase() === LEGACY_PRIMARY_COLOR.toLowerCase()) return DEFAULT_PRIMARY_COLOR
  return color
}

/** Raster brand assets, all under `public/brand/`. Sizes are the files' own. */
export interface BrandAsset {
  src: string
  width: number
  height: number
}

const asset = (file: string, width: number, height: number): BrandAsset => ({
  src: `/brand/${file}`,
  width,
  height,
})

export const BRAND_ASSETS = {
  // Lockups. `*Dark` variants have white lettering, for dark surfaces.
  horizontal: asset('logo-horizontal.png', 1061, 243),
  horizontalDark: asset('logo-horizontal-dark.png', 1061, 243),
  mark: asset('logo-mark.png', 512, 469),
  wordmark: asset('logo-wordmark.png', 793, 117),
  wordmarkDark: asset('logo-wordmark-dark.png', 793, 117),
  vertical: asset('logo-vertical.png', 560, 342),
  verticalDark: asset('logo-vertical-dark.png', 560, 342),

  // Shown at 32px tall in an email header; stored at 2x.
  email: asset('email-logo.png', 279, 64),

  // Browser and OS icons.
  favicon16: asset('favicon-16.png', 16, 16),
  favicon32: asset('favicon-32.png', 32, 32),
  appleTouch: asset('apple-touch-icon.png', 180, 180),

  // Link-preview cards. 1200x630 is the size every network crops from.
  ogDefault: asset('og-default.png', 1200, 630),
  ogJobs: asset('og-jobs.png', 1200, 630),
} as const

export type BrandLogoVariant = 'horizontal' | 'mark' | 'wordmark' | 'vertical'

/** A brand asset in the shape Next's `openGraph.images` expects. */
export function brandOgImage(asset: BrandAsset, alt: string) {
  return { url: asset.src, width: asset.width, height: asset.height, alt }
}
