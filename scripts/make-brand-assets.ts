/**
 * Generates every raster brand asset from the two source logos.
 *
 *   npm run brand:assets
 *
 * INPUTS (checked in, hand-supplied by the brand owner — never edited here):
 *   public/logo.png        the mark on white
 *   public/long logo.png   the horizontal lockup on white
 *
 * OUTPUTS (all generated, all safe to delete and regenerate):
 *   public/brand/*         lockups, mark, tiles, favicons, social cards, email logo
 *   public/favicon.ico     16/32/48 in one file
 *   public/icons/*         PWA icons, plus the two images a push notification needs
 *
 * WHY THIS IS A SCRIPT AND NOT A FOLDER OF HAND-EXPORTED PNGs. The sources are
 * flattened onto white. Every place the product draws a logo needs it on
 * something else — a dark sidebar, an orange tile, a browser tab, an email
 * header — and each of those is the same artwork with a different background
 * or a different ink. Re-exporting them by hand means the next logo tweak is
 * a day of design-tool work; here it is one command and a diff.
 *
 * HOW THE CUT-OUT WORKS (the only clever part). A threshold on "how white is
 * this pixel" leaves a pale halo round every edge, which is invisible on white
 * and shows as a glowing outline the moment the logo lands on charcoal. So
 * instead:
 *   1. Pixels that are clearly ink (≥ 84% away from white) are taken as-is.
 *   2. Their colour is spread a few pixels outward, so every edge pixel knows
 *      what colour it is an antialiased blend OF.
 *   3. Alpha is how far that pixel sits between white and that colour. The
 *      output keeps the ESTIMATED INK colour, not the blended one — which is
 *      what makes the edge clean on any background.
 * Works for the mark's per-shape gradients and the wordmark's flat navy alike,
 * because it never assumes what the ink colour is.
 *
 * TEXT for the social cards is drawn with Inter, the brand typeface. The font
 * is fetched once from Google Fonts into node_modules/.cache and reused; it is
 * a build-time tool, never shipped.
 */
import sharp from 'sharp'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { BRAND } from '../src/lib/brand'

const C = BRAND.colors
const root = process.cwd()
const pub = join(root, 'public')
const brandDir = join(pub, 'brand')
const iconDir = join(pub, 'icons')

const SOURCE_MARK = join(pub, 'logo.png')
const SOURCE_LOCKUP = join(pub, 'long logo.png')

/* ------------------------------------------------------------------ Raster */

/** Straight (non-premultiplied) RGBA, 8 bits per channel. */
interface Raster {
  data: Buffer
  width: number
  height: number
}

type RGB = [number, number, number]

const fromRaster = (r: Raster) =>
  sharp(r.data, { raw: { width: r.width, height: r.height, channels: 4 } })

async function toRaster(image: sharp.Sharp): Promise<Raster> {
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

const hex = (value: string): RGB => {
  const n = parseInt(value.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Distance from white, in channel units, at which a pixel counts as pure ink. */
const INK_FLOOR = 215
/** How far, in pixels, ink colour is spread to reach antialiased edges. */
const EDGE_REACH = 4

async function cutout(file: string): Promise<Raster> {
  const { data: rgb, info } = await sharp(file)
    .flatten({ background: '#ffffff' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const { width, height } = info
  const count = width * height

  const ink = new Uint8Array(count * 3)
  let known = new Uint8Array(count)
  for (let i = 0; i < count; i++) {
    const r = rgb[i * 3]
    const g = rgb[i * 3 + 1]
    const b = rgb[i * 3 + 2]
    if (255 - Math.min(r, g, b) >= INK_FLOOR) {
      known[i] = 1
      ink[i * 3] = r
      ink[i * 3 + 1] = g
      ink[i * 3 + 2] = b
    }
  }

  // Spread ink colour outward, one ring per pass.
  for (let pass = 0; pass < EDGE_REACH; pass++) {
    const next = known.slice()
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x
        if (known[i]) continue
        for (let dy = -1; dy <= 1 && !next[i]; dy++) {
          const ny = y + dy
          if (ny < 0 || ny >= height) continue
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx
            if (nx < 0 || nx >= width) continue
            const j = ny * width + nx
            if (!known[j]) continue
            ink[i * 3] = ink[j * 3]
            ink[i * 3 + 1] = ink[j * 3 + 1]
            ink[i * 3 + 2] = ink[j * 3 + 2]
            next[i] = 1
            break
          }
        }
      }
    }
    known = next
  }

  const out = Buffer.alloc(count * 4)
  for (let i = 0; i < count; i++) {
    if (!known[i]) continue // background: stays fully transparent
    const cr = ink[i * 3]
    const cg = ink[i * 3 + 1]
    const cb = ink[i * 3 + 2]
    // Where this pixel sits on the line from white to its ink colour.
    const dot =
      (255 - rgb[i * 3]) * (255 - cr) +
      (255 - rgb[i * 3 + 1]) * (255 - cg) +
      (255 - rgb[i * 3 + 2]) * (255 - cb)
    const norm = (255 - cr) ** 2 + (255 - cg) ** 2 + (255 - cb) ** 2
    let alpha = norm > 0 ? dot / norm : 0
    // Snap the extremes: scanner-style noise must not leave a faint veil over
    // the solid areas or specks over the empty ones.
    alpha = alpha < 0.03 ? 0 : alpha > 0.97 ? 1 : alpha
    out[i * 4] = cr
    out[i * 4 + 1] = cg
    out[i * 4 + 2] = cb
    out[i * 4 + 3] = Math.round(alpha * 255)
  }

  return { data: out, width, height }
}

/** Crop to the artwork's bounding box, then add `pad` (a fraction of the long side). */
async function trim(r: Raster, pad = 0): Promise<Raster> {
  let minX = r.width
  let minY = r.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < r.height; y++) {
    for (let x = 0; x < r.width; x++) {
      if (r.data[(y * r.width + x) * 4 + 3] > 20) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  const width = maxX - minX + 1
  const height = maxY - minY + 1
  const margin = Math.round(Math.max(width, height) * pad)
  return toRaster(
    fromRaster(r)
      .extract({ left: minX, top: minY, width, height })
      .extend({
        top: margin,
        bottom: margin,
        left: margin,
        right: margin,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
  )
}

/** Same artwork, one flat ink. What a monochrome logo is. */
function flat(r: Raster, colour: string): Raster {
  const [cr, cg, cb] = hex(colour)
  const data = Buffer.from(r.data)
  for (let i = 0; i < r.width * r.height; i++) {
    data[i * 4] = cr
    data[i * 4 + 1] = cg
    data[i * 4 + 2] = cb
  }
  return { ...r, data }
}

/**
 * The dark-surface version: lettering goes white, everything with real colour
 * in it — the mark, the orange "HR" — is left alone. "Neutral" here means low
 * chroma, which is what separates the navy lettering (chroma ≈ 27) from every
 * orange and red in the artwork (chroma > 200).
 */
function forDark(r: Raster): Raster {
  const data = Buffer.from(r.data)
  for (let i = 0; i < r.width * r.height; i++) {
    const cr = data[i * 4]
    const cg = data[i * 4 + 1]
    const cb = data[i * 4 + 2]
    if (Math.max(cr, cg, cb) - Math.min(cr, cg, cb) < 80) {
      data[i * 4] = 255
      data[i * 4 + 1] = 255
      data[i * 4 + 2] = 255
    }
  }
  return { ...r, data }
}

/**
 * Split the horizontal lockup into its mark and its lettering at the first
 * gap of empty columns. Found, not hard-coded, so a re-exported source with
 * slightly different spacing still splits correctly.
 */
async function splitLockup(r: Raster): Promise<{ mark: Raster; text: Raster }> {
  const filled = new Uint8Array(r.width)
  for (let x = 0; x < r.width; x++) {
    for (let y = 0; y < r.height; y++) {
      if (r.data[(y * r.width + x) * 4 + 3] > 20) {
        filled[x] = 1
        break
      }
    }
  }
  let x = 0
  while (x < r.width && !filled[x]) x++ // leading margin
  while (x < r.width) {
    // A gap is six consecutive empty columns.
    let run = 0
    while (x + run < r.width && !filled[x + run]) run++
    if (run >= 6) break
    x += Math.max(run, 1)
  }
  const split = x
  const markPart = await toRaster(fromRaster(r).extract({ left: 0, top: 0, width: split, height: r.height }))
  const textPart = await toRaster(
    fromRaster(r).extract({ left: split, top: 0, width: r.width - split, height: r.height })
  )
  return { mark: await trim(markPart), text: await trim(textPart) }
}

/* ----------------------------------------------------------------- Output */

const png = (image: sharp.Sharp) => image.png({ compressionLevel: 9, effort: 10 }).toBuffer()

async function scaled(r: Raster, size: { width?: number; height?: number }): Promise<Buffer> {
  return png(fromRaster(r).resize({ ...size, fit: 'inside', kernel: 'lanczos3' }))
}

const written: Array<{ file: string; width: number; height: number; bytes: number }> = []

async function save(path: string, buffer: Buffer): Promise<void> {
  writeFileSync(path, buffer)
  const meta = await sharp(buffer).metadata()
  written.push({
    file: path.replace(pub, 'public').replace(/\\/g, '/'),
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    bytes: buffer.length,
  })
}

/* ------------------------------------------------------------------ Tiles */

/** A rounded square, optionally filled with a vertical two-stop gradient. */
function tileSvg(size: number, radius: number, fill: string | [string, string] | null): Buffer {
  const paint = Array.isArray(fill) ? 'url(#g)' : (fill ?? 'none')
  const defs = Array.isArray(fill)
    ? `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${fill[0]}"/><stop offset="1" stop-color="${fill[1]}"/></linearGradient></defs>`
    : ''
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${defs}<rect width="${size}" height="${size}" rx="${radius}" fill="${paint}"/></svg>`
  )
}

interface TileOptions {
  size: number
  /** Corner radius as a fraction of the side; 0 for a full-bleed square. */
  radius: number
  background: string | [string, string] | null
  mark: Raster
  /** Width of the mark as a fraction of the side. */
  markRatio: number
}

async function tile(o: TileOptions): Promise<Buffer> {
  const markBuffer = await scaled(o.mark, { width: Math.round(o.size * o.markRatio) })
  const base = sharp(tileSvg(o.size, Math.round(o.size * o.radius), o.background)).png()
  return png(sharp(await base.toBuffer()).composite([{ input: markBuffer, gravity: 'centre' }]))
}

/* -------------------------------------------------------------------- ICO */

/** An .ico that wraps PNG frames — every browser since IE9 reads it. */
function ico(frames: Array<{ size: number; data: Buffer }>): Buffer {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(frames.length, 4)
  const directory = Buffer.alloc(16 * frames.length)
  let offset = header.length + directory.length
  frames.forEach((frame, index) => {
    const at = index * 16
    directory[at] = frame.size >= 256 ? 0 : frame.size
    directory[at + 1] = frame.size >= 256 ? 0 : frame.size
    directory.writeUInt16LE(1, at + 4) // colour planes
    directory.writeUInt16LE(32, at + 6) // bits per pixel
    directory.writeUInt32LE(frame.data.length, at + 8)
    directory.writeUInt32LE(offset, at + 12)
    offset += frame.data.length
  })
  return Buffer.concat([header, directory, ...frames.map((f) => f.data)])
}

/* ------------------------------------------------------------------- Text */

const INTER_WEIGHTS = [500, 600, 700, 800] as const
type InterWeight = (typeof INTER_WEIGHTS)[number]
const FONT_NAME: Record<InterWeight, string> = {
  500: 'Medium',
  600: 'SemiBold',
  700: 'Bold',
  800: 'ExtraBold',
}

async function interFile(weight: InterWeight): Promise<string> {
  const dir = join(root, 'node_modules', '.cache', 'oneclickhr-brand')
  const file = join(dir, `Inter-${weight}.ttf`)
  if (existsSync(file)) return file

  mkdirSync(dir, { recursive: true })
  // A legacy User-Agent makes Google answer with plain TTF rather than WOFF2,
  // which is the only format libvips/Pango can load.
  const css = await (
    await fetch(`https://fonts.googleapis.com/css?family=Inter:${INTER_WEIGHTS.join(',')}`, {
      headers: { 'User-Agent': 'Mozilla/4.0' },
    })
  ).text()
  for (const match of css.matchAll(/font-weight:\s*(\d+);\s*src:\s*url\(([^)]+)\)/g)) {
    const target = join(dir, `Inter-${match[1]}.ttf`)
    if (existsSync(target)) continue
    const response = await fetch(match[2])
    if (!response.ok) throw new Error(`Could not download Inter ${match[1]}: ${response.status}`)
    writeFileSync(target, Buffer.from(await response.arrayBuffer()))
  }
  if (!existsSync(file)) throw new Error(`Inter ${weight} was not in the Google Fonts response`)
  return file
}

interface TextRun {
  text: string
  colour: string
}

/** Rendered text as a transparent PNG, tightly cropped. Runs allow mixed colours. */
async function text(
  runs: TextRun[],
  o: { weight: InterWeight; size: number; tracking?: number; lineHeight?: number }
): Promise<{ input: Buffer; width: number; height: number }> {
  const spacing = Math.round((o.tracking ?? 0) * o.size * 1024) // Pango: 1/1024 pt
  const markup = runs
    .map(
      (run) =>
        `<span foreground="${run.colour}" letter_spacing="${spacing}">${run.text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')}</span>`
    )
    .join('')
  const buffer = await sharp({
    text: {
      text: markup,
      font: `Inter ${FONT_NAME[o.weight]} ${o.size}`,
      fontfile: await interFile(o.weight),
      rgba: true,
      dpi: 72,
      // Pango's `spacing` is EXTRA leading on top of the font's own line height
      // (Inter's is 1.21em), so a target line height is expressed relative to that.
      ...(o.lineHeight ? { spacing: Math.round(o.size * (o.lineHeight - 1.21)) } : {}),
    },
  })
    .png()
    .toBuffer()
  const cropped = await trim(await toRaster(sharp(buffer)))
  return { input: await png(fromRaster(cropped)), width: cropped.width, height: cropped.height }
}

/* ------------------------------------------------------------ Social cards */

const CARD = { width: 1200, height: 630 }

/** The dark canvas every card sits on: charcoal with two soft pools of orange. */
function cardBackground(): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD.width}" height="${CARD.height}">
      <defs>
        <radialGradient id="a" cx="88%" cy="6%" r="62%">
          <stop offset="0" stop-color="${C.primary}" stop-opacity="0.42"/>
          <stop offset="1" stop-color="${C.primary}" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="b" cx="4%" cy="108%" r="55%">
          <stop offset="0" stop-color="${C.primaryDark}" stop-opacity="0.30"/>
          <stop offset="1" stop-color="${C.primaryDark}" stop-opacity="0"/>
        </radialGradient>
        <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
          <path d="M48 0H0V48" fill="none" stroke="#fff" stroke-opacity="0.045" stroke-width="1"/>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="${C.charcoal}"/>
      <rect width="100%" height="100%" fill="url(#grid)"/>
      <rect width="100%" height="100%" fill="url(#a)"/>
      <rect width="100%" height="100%" fill="url(#b)"/>
    </svg>`
  )
}

async function socialCard(
  kit: { horizontalDark: Raster; mark: Raster },
  copy: { headline: TextRun[]; sub: string }
): Promise<Buffer> {
  const layers: sharp.OverlayOptions[] = []

  // Lockup, top-left.
  const lockupHeight = 76
  const lockup = await scaled(kit.horizontalDark, { height: lockupHeight })
  layers.push({ input: lockup, left: 80, top: 72 })

  // The mark, large and partly off the right edge: a watermark, not a second logo.
  const watermarkWidth = 520
  const watermark = await scaled(kit.mark, { width: watermarkWidth })
  const watermarkHeight = (await sharp(watermark).metadata()).height ?? watermarkWidth
  const faded = await sharp(watermark)
    .composite([
      {
        // `dest-in` multiplies the artwork's alpha by this rectangle's: 11%.
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${watermarkWidth}" height="${watermarkHeight}"><rect width="100%" height="100%" fill="#fff" fill-opacity="0.11"/></svg>`
        ),
        blend: 'dest-in',
      },
    ])
    .png()
    .toBuffer()
  layers.push({ input: faded, left: CARD.width - watermarkWidth + 110, top: 150 })

  // Headline: one text call, newline-separated, so the leading is even.
  const headline = await text(copy.headline, { weight: 800, size: 84, tracking: -0.03, lineHeight: 1.06 })
  const headlineTop = 246
  layers.push({ input: headline.input, left: 80, top: headlineTop })

  const sub = await text([{ text: copy.sub, colour: '#94A3B8' }], { weight: 500, size: 34 })
  layers.push({ input: sub.input, left: 80, top: headlineTop + headline.height + 34 })

  // A short orange rule under everything, the brand's one flourish.
  layers.push({
    input: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="6"><rect width="96" height="6" rx="3" fill="${C.primary}"/></svg>`
    ),
    left: 80,
    top: CARD.height - 72,
  })

  return png(sharp(cardBackground()).composite(layers))
}

/* -------------------------------------------------------------------- Run */

async function main(): Promise<void> {
  mkdirSync(brandDir, { recursive: true })
  mkdirSync(iconDir, { recursive: true })

  const markSource = await trim(await cutout(SOURCE_MARK))
  const lockupSource = await trim(await cutout(SOURCE_LOCKUP))
  const { mark: lockupMark, text: lockupText } = await splitLockup(lockupSource)

  const white = flat(markSource, '#FFFFFF')

  /* ---- Lockups -------------------------------------------------------- */
  await save(join(brandDir, 'logo-mark.png'), await scaled(markSource, { width: 512 }))
  await save(join(brandDir, 'logo-mark-white.png'), await scaled(white, { width: 512 }))
  await save(join(brandDir, 'logo-mark-black.png'), await scaled(flat(markSource, '#000000'), { width: 512 }))

  await save(join(brandDir, 'logo-horizontal.png'), await png(fromRaster(lockupSource)))
  await save(join(brandDir, 'logo-horizontal-dark.png'), await png(fromRaster(forDark(lockupSource))))

  await save(join(brandDir, 'logo-wordmark.png'), await png(fromRaster(lockupText)))
  await save(join(brandDir, 'logo-wordmark-dark.png'), await png(fromRaster(forDark(lockupText))))

  // Vertical: the lettering at 560px wide, the mark 42% of that, a gap of 7%.
  for (const dark of [false, true]) {
    const wordWidth = 560
    const markWidth = Math.round(wordWidth * 0.42)
    const gap = Math.round(wordWidth * 0.07)
    const wordBuffer = await scaled(dark ? forDark(lockupText) : lockupText, { width: wordWidth })
    const markBuffer = await scaled(lockupMark, { width: markWidth })
    const wordMeta = await sharp(wordBuffer).metadata()
    const markMeta = await sharp(markBuffer).metadata()
    const height = (markMeta.height ?? 0) + gap + (wordMeta.height ?? 0)
    const canvas = sharp({
      create: { width: wordWidth, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
    await save(
      join(brandDir, dark ? 'logo-vertical-dark.png' : 'logo-vertical.png'),
      await png(
        canvas.composite([
          { input: markBuffer, left: Math.round((wordWidth - (markMeta.width ?? 0)) / 2), top: 0 },
          { input: wordBuffer, left: 0, top: (markMeta.height ?? 0) + gap },
        ])
      )
    )
  }

  // Single-ink lockups for print, fax, embossing, a watermark.
  for (const [name, colour] of [
    ['black', '#000000'],
    ['white', '#FFFFFF'],
    ['gray', C.gray],
  ] as const) {
    await save(join(brandDir, `logo-mono-${name}.png`), await png(fromRaster(flat(lockupSource, colour))))
  }

  /* ---- Icon tiles ----------------------------------------------------- */
  const tileArt = { size: 512, radius: 0.2237, markRatio: 0.56 }
  await save(
    join(brandDir, 'icon-light.png'),
    await tile({ ...tileArt, background: '#FFFFFF', mark: markSource })
  )
  await save(
    join(brandDir, 'icon-dark.png'),
    await tile({ ...tileArt, background: C.charcoal, mark: white })
  )
  await save(
    join(brandDir, 'icon-orange.png'),
    await tile({ ...tileArt, background: ['#FF7A1A', C.primaryDark], mark: white })
  )
  await save(
    join(brandDir, 'icon-app.png'),
    await tile({ ...tileArt, background: C.charcoal, mark: markSource })
  )

  /* ---- Favicons ------------------------------------------------------- */
  // The bare mark, not a tile: at 16px the tile's corners and margin eat a
  // third of the pixels, and the mark on its own is what the brand kit shows.
  const faviconSource = await trim(markSource, 0.04)
  const frames: Array<{ size: number; data: Buffer }> = []
  for (const size of [16, 32, 48]) {
    const square = await png(
      fromRaster(faviconSource).resize({
        width: size,
        height: size,
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        kernel: 'lanczos3',
      })
    )
    frames.push({ size, data: square })
    if (size !== 48) await save(join(brandDir, `favicon-${size}.png`), square)
  }
  const favicon = ico(frames)
  writeFileSync(join(pub, 'favicon.ico'), favicon)
  written.push({ file: 'public/favicon.ico', width: 48, height: 48, bytes: favicon.length })

  /* ---- App icons (PWA, iOS home screen) ------------------------------- */
  // iOS rounds the corners itself and paints any transparency black, so the
  // touch icon is a full-bleed square.
  await save(
    join(brandDir, 'apple-touch-icon.png'),
    await tile({ size: 180, radius: 0, background: C.charcoal, mark: markSource, markRatio: 0.62 })
  )
  await save(
    join(iconDir, 'icon-192.png'),
    await tile({ size: 192, radius: 0.2237, background: C.charcoal, mark: markSource, markRatio: 0.58 })
  )
  await save(
    join(iconDir, 'icon-512.png'),
    await tile({ size: 512, radius: 0.2237, background: C.charcoal, mark: markSource, markRatio: 0.58 })
  )
  // Maskable: Android crops this to a circle, a squircle or a rounded square,
  // so the artwork stays inside the central safe zone (a circle of 40% radius).
  await save(
    join(iconDir, 'icon-maskable-512.png'),
    await tile({ size: 512, radius: 0, background: C.charcoal, mark: markSource, markRatio: 0.5 })
  )

  /* ---- Push notification images (read by public/sw.js) ---------------- */
  // `icon`: full colour, beside the text. `badge`: Android keeps only the
  // alpha channel and paints it one colour, so it must be a plain silhouette.
  await save(
    join(iconDir, 'notification-192.png'),
    await tile({
      size: 192,
      radius: 0.2237,
      background: ['#FF7A1A', C.primaryDark],
      mark: white,
      markRatio: 0.58,
    })
  )
  await save(
    join(iconDir, 'badge-96.png'),
    await png(
      sharp({
        create: { width: 96, height: 96, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      }).composite([{ input: await scaled(white, { width: 72 }), gravity: 'centre' }])
    )
  )

  /* ---- Email ---------------------------------------------------------- */
  // Shown at 32px tall; stored at 2x so it stays sharp on a retina screen.
  await save(
    join(brandDir, 'email-logo.png'),
    await scaled(forDark(lockupSource), { height: 64 })
  )

  /* ---- Social cards --------------------------------------------------- */
  const kit = { horizontalDark: forDark(lockupSource), mark: markSource }
  await save(
    join(brandDir, 'og-default.png'),
    await socialCard(kit, {
      headline: [
        { text: 'HR Management\nin One Click', colour: '#FFFFFF' },
        { text: '.', colour: C.primary },
      ],
      sub: BRAND.taglineShort,
    })
  )
  await save(
    join(brandDir, 'og-jobs.png'),
    await socialCard(kit, {
      headline: [
        { text: 'Find your next\nrole in a click', colour: '#FFFFFF' },
        { text: '.', colour: C.primary },
      ],
      sub: 'Open roles from organizations hiring on OneclickHR.',
    })
  )

  for (const item of written) {
    console.log(
      `${item.file.padEnd(46)} ${`${item.width}×${item.height}`.padEnd(11)} ${(item.bytes / 1024).toFixed(1)} KB`
    )
  }
  console.log(`\n${written.length} files written.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
