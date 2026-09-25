import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import {
  BRAND,
  BRAND_ASSETS,
  DEFAULT_PRIMARY_COLOR,
  LEGACY_PRIMARY_COLOR,
  brandColorOrDefault,
} from '@/lib/brand'
import { brandDarkTints, brandInk, brandLightTints, contrastRatio, hexToHslTriple } from '@/lib/utils'
import { layout, button } from '@/lib/email-layout'

const root = process.cwd()

/** Width and height from a PNG's IHDR chunk — no image library needed. */
function pngSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(file)
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function triple(hsl: string): { h: number; s: number; l: number } {
  const [h, s, l] = hsl.split(/\s+/).map(parseFloat)
  return { h, s, l }
}

/** HSL triple -> rgb, so a derived shade can be measured rather than eyeballed. */
function tripleToRgb(hsl: string): [number, number, number] {
  const { h, s, l } = triple(hsl)
  const sat = s / 100
  const light = l / 100
  const c = (1 - Math.abs(2 * light - 1)) * sat
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = light - c / 2
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
}

describe('brand assets', () => {
  it('has a file for every asset, and the recorded size is the file’s real size', () => {
    // A wrong width/height here does not fail anywhere loud: next/image would
    // render the logo squashed, and og:image:width would lie to link previews.
    for (const [name, asset] of Object.entries(BRAND_ASSETS)) {
      const file = join(root, 'public', asset.src)
      expect(existsSync(file), `${name}: ${asset.src} is missing — run npm run brand:assets`).toBe(true)
      expect(pngSize(file), name).toEqual({ width: asset.width, height: asset.height })
    }
  })

  it('keeps the social cards at the 1200x630 every network crops from', () => {
    expect(BRAND_ASSETS.ogDefault).toMatchObject({ width: 1200, height: 630 })
    expect(BRAND_ASSETS.ogJobs).toMatchObject({ width: 1200, height: 630 })
  })

  it('ships the files the manifest, the service worker and the browser ask for by name', () => {
    for (const file of [
      'favicon.ico',
      'icons/icon-192.png',
      'icons/icon-512.png',
      'icons/icon-maskable-512.png',
      // public/sw.js hard-codes these two.
      'icons/notification-192.png',
      'icons/badge-96.png',
    ]) {
      expect(existsSync(join(root, 'public', file)), `public/${file}`).toBe(true)
    }
    expect(pngSize(join(root, 'public/icons/notification-192.png'))).toEqual({ width: 192, height: 192 })
    expect(pngSize(join(root, 'public/icons/badge-96.png'))).toEqual({ width: 96, height: 96 })
  })
})

describe('the stylesheet agrees with the brand constants', () => {
  const css = readFileSync(join(root, 'src/app/globals.css'), 'utf8')
  const declared = (name: string) => new RegExp(`${name}:\\s+([^;]+);`).exec(css)?.[1].trim()

  it.each([
    ['--brand-600', BRAND.colors.primary],
    ['--text', BRAND.colors.charcoal],
    ['--muted', BRAND.colors.gray],
    ['--page-bg', BRAND.colors.lightGray],
  ])('%s is %s', (token, hex) => {
    expect(declared(token)).toBe(hexToHslTriple(hex))
  })

  it('keeps Orange Dark for hover, within a rounding step', () => {
    // globals.css holds it to a decimal place (47.5%); hexToHslTriple rounds.
    const dark = triple(declared('--brand-700')!)
    const kit = triple(hexToHslTriple(BRAND.colors.primaryDark)!)
    expect(dark.h).toBe(kit.h)
    expect(Math.abs(dark.l - kit.l)).toBeLessThanOrEqual(1)
  })
})

describe('brandColorOrDefault', () => {
  it('treats the pre-rebrand crimson as unset, in any case', () => {
    expect(brandColorOrDefault(LEGACY_PRIMARY_COLOR)).toBe(DEFAULT_PRIMARY_COLOR)
    expect(brandColorOrDefault('#c41e33')).toBe(DEFAULT_PRIMARY_COLOR)
  })

  it('falls back for a missing or malformed value', () => {
    for (const value of [null, undefined, '', 'red', '#fff', '#GGGGGG', 'FF6A00']) {
      expect(brandColorOrDefault(value), String(value)).toBe(DEFAULT_PRIMARY_COLOR)
    }
  })

  it('leaves a colour somebody actually chose alone', () => {
    expect(brandColorOrDefault('#0F766E')).toBe('#0F766E')
    expect(brandColorOrDefault('  #2563eb ')).toBe('#2563eb')
  })
})

describe('brandInk — brand colour as readable text', () => {
  // A tenant picks a colour for how it looks as a button. As a 13px link the
  // same colour can be unreadable; the ink shade is what stops that.
  const tenantColours = ['#FF6A00', '#EAB308', '#FDE047', '#84CC16', '#22D3EE', '#2563EB', '#7C3AED', '#0F172A', '#FFFFFF']

  it.each(tenantColours)('reaches AA (4.5:1) on white for %s', (hex) => {
    const ink = brandInk(hex, 'light')!
    expect(contrastRatio(tripleToRgb(ink), rgb('#FFFFFF'))).toBeGreaterThanOrEqual(4.5)
  })

  it.each(tenantColours)('reaches AA (4.5:1) on the dark card for %s', (hex) => {
    const ink = brandInk(hex, 'dark')!
    expect(contrastRatio(tripleToRgb(ink), rgb(BRAND.colors.charcoal))).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps hue and saturation, so it is recognisably the same colour', () => {
    const original = triple(hexToHslTriple('#EAB308')!)
    const ink = triple(brandInk('#EAB308', 'light')!)
    expect(ink.h).toBe(original.h)
    expect(ink.s).toBe(original.s)
    expect(ink.l).toBeLessThan(original.l)
  })

  it('does not move a colour that is already readable', () => {
    expect(brandInk('#0F172A', 'light')).toBe(hexToHslTriple('#0F172A'))
  })

  it('agrees with the brand ink the stylesheet ships for the default orange', () => {
    const shipped = tripleToRgb('17 88% 40.5%')
    expect(contrastRatio(shipped, rgb('#FFFFFF'))).toBeGreaterThanOrEqual(4.5)
    // …and the derivation for #FF6A00 lands in the same neighbourhood.
    expect(Math.abs(triple(brandInk(BRAND.colors.primary, 'light')!).l - 40.5)).toBeLessThan(6)
  })

  it('rejects a value that is not a hex colour', () => {
    expect(brandInk('orange', 'light')).toBeNull()
    expect(brandDarkTints('orange')).toBeNull()
  })

  it('makes light tints that stay light, whatever the colour’s own lightness', () => {
    // A deep teal used to get lightness + 51 = 83%: a loud slab, not a tint.
    for (const hex of ['#0F766E', '#FF6A00', '#EAB308', '#1E3A8A']) {
      const tints = brandLightTints(hex)!
      expect([triple(tints[50]).l, triple(tints[100]).l, triple(tints[200]).l], hex).toEqual([96, 91, 82])
      expect(triple(tints[50]).h).toBe(triple(hexToHslTriple(hex)!).h)
    }
  })

  it('makes dark tints that stay dark', () => {
    const tints = brandDarkTints('#FF6A00')!
    for (const shade of [tints[50], tints[100], tints[200]]) {
      expect(triple(shade).l).toBeLessThanOrEqual(22)
    }
  })
})

describe('email layout', () => {
  it('shows the logo, from the given origin, on a platform email', () => {
    const html = layout('<p>hi</p>', { origin: 'https://app.example.com/' })
    expect(html).toContain(`src="https://app.example.com${BRAND_ASSETS.email.src}"`)
    expect(html).toContain(`alt="${BRAND.name}"`)
  })

  it('shows the workspace name, not the logo, on a workspace email', () => {
    const html = layout('<p>hi</p>', { brandName: 'Acme Care', brandColor: '#0F766E', origin: 'https://app.example.com' })
    expect(html).not.toContain('email-logo.png')
    expect(html).toContain('Acme Care')
    expect(html).toContain('#0F766E')
  })

  it('has no old crimson in it, even for a workspace still stored on it', () => {
    const html = layout(button('https://x.test', 'Go', LEGACY_PRIMARY_COLOR), { brandName: 'Old Org', brandColor: LEGACY_PRIMARY_COLOR })
    expect(html.toUpperCase()).not.toContain(LEGACY_PRIMARY_COLOR)
    expect(html).toContain(DEFAULT_PRIMARY_COLOR)
  })
})
