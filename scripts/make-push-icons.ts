/**
 * Generates the two raster icons a browser notification needs (035).
 *
 *   npx tsx scripts/make-push-icons.ts
 *
 * WHY GENERATED RATHER THAN CHECKED IN AS ART. These are not brand assets; they
 * are the smallest thing that satisfies two APIs with fixed requirements, and a
 * hand-made PNG in `public/` is a binary nobody can diff, regenerate or explain.
 * Rerun this and you get byte-identical output, which is the property that
 * matters for something that ships in every notification.
 *
 * WHY RASTER AT ALL, given the rest of the product draws its icons as SVG:
 * `Notification.icon` and `Notification.badge` do not accept SVG in Chromium or
 * WebKit. A vector here renders as no icon at all — silently, and only on the
 * platforms you are least likely to be testing on.
 *
 * TWO IMAGES, TWO JOBS, and they are not interchangeable:
 *   • icon  — 192px, full colour. The picture beside the text on desktop and in
 *             the Android shade.
 *   • badge — 96px, and it MUST be a white glyph on transparency. Android masks
 *             it to a single colour for the status bar, so anything with its own
 *             colours arrives as a featureless blob.
 *
 * No dependencies: PNG is a handful of length-prefixed chunks around a zlib
 * stream, and pulling in an image library to draw two circles would be a worse
 * trade than the forty lines below.
 */
import { deflateSync } from 'zlib'
import { createHash } from 'crypto'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

type RGBA = [number, number, number, number]

const BRAND: RGBA = [0xc4, 0x1e, 0x33, 0xff] // Oneclickhr crimson
const WHITE: RGBA = [0xff, 0xff, 0xff, 0xff]
const CLEAR: RGBA = [0, 0, 0, 0]

/** CRC-32, which PNG requires per chunk and Node does not expose. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([length, body, crc])
}

function encodePng(size: number, pixel: (x: number, y: number) => RGBA): Buffer {
  // One filter byte (0 = None) per scanline, then RGBA.
  const raw = Buffer.alloc(size * (1 + size * 4))
  let offset = 0
  for (let y = 0; y < size; y++) {
    raw[offset++] = 0
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y)
      raw[offset++] = r
      raw[offset++] = g
      raw[offset++] = b
      raw[offset++] = a
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  // 10..12 = compression, filter, interlace — all zero, which is the only
  // combination PNG actually defines.

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * A bell, drawn as maths rather than as a path: a dome, a skirt, a rim and a
 * clapper. Coordinates are fractions of the canvas so both sizes render the
 * same shape.
 *
 * Sampled 3x3 per pixel and averaged — without that, every curve here is a
 * staircase at 96px, which is exactly the size Android shows the badge at.
 */
function bellAlpha(px: number, py: number, size: number): number {
  const SAMPLES = 3
  let hits = 0

  for (let sy = 0; sy < SAMPLES; sy++) {
    for (let sx = 0; sx < SAMPLES; sx++) {
      const x = (px + (sx + 0.5) / SAMPLES) / size
      const y = (py + (sy + 0.5) / SAMPLES) / size

      // Clapper: a small circle below the rim.
      const cdx = x - 0.5
      const cdy = y - 0.80
      if (cdx * cdx + cdy * cdy <= 0.055 * 0.055) {
        hits++
        continue
      }

      // Rim: a flat bar at the bottom of the body.
      if (y >= 0.655 && y <= 0.715 && Math.abs(x - 0.5) <= 0.335) {
        hits++
        continue
      }

      // Body: a dome whose half-width grows with depth, so the silhouette
      // flares the way a bell does instead of being a plain semicircle.
      if (y >= 0.20 && y <= 0.665) {
        const t = (y - 0.20) / (0.665 - 0.20) // 0 at the crown, 1 at the rim
        const halfWidth = 0.09 + 0.225 * Math.pow(t, 0.62)
        if (Math.abs(x - 0.5) <= halfWidth) {
          hits++
          continue
        }
      }

      // Crown: the little loop on top.
      const kdx = x - 0.5
      const kdy = y - 0.185
      if (kdx * kdx + kdy * kdy <= 0.052 * 0.052) hits++
    }
  }

  return hits / (SAMPLES * SAMPLES)
}

/** Antialiased rounded square, for the full-colour icon's background. */
function roundedSquareAlpha(px: number, py: number, size: number): number {
  const SAMPLES = 3
  const radius = 0.22
  let hits = 0

  for (let sy = 0; sy < SAMPLES; sy++) {
    for (let sx = 0; sx < SAMPLES; sx++) {
      const x = (px + (sx + 0.5) / SAMPLES) / size
      const y = (py + (sy + 0.5) / SAMPLES) / size
      // Distance to the inner rectangle whose corners the radius rounds off.
      const dx = Math.max(radius - x, 0, x - (1 - radius))
      const dy = Math.max(radius - y, 0, y - (1 - radius))
      if (dx * dx + dy * dy <= radius * radius) hits++
    }
  }

  return hits / (SAMPLES * SAMPLES)
}

function blend(over: RGBA, under: RGBA, alpha: number): RGBA {
  if (alpha <= 0) return under
  if (alpha >= 1) return over
  return [
    Math.round(over[0] * alpha + under[0] * (1 - alpha)),
    Math.round(over[1] * alpha + under[1] * (1 - alpha)),
    Math.round(over[2] * alpha + under[2] * (1 - alpha)),
    Math.round(over[3] * alpha + under[3] * (1 - alpha)),
  ]
}

const outDir = join(process.cwd(), 'public', 'icons')
mkdirSync(outDir, { recursive: true })

// The icon: white bell on a crimson rounded square.
const icon = encodePng(192, (x, y) => {
  const background = blend(BRAND, CLEAR, roundedSquareAlpha(x, y, 192))
  return blend(WHITE, background, bellAlpha(x, y, 192))
})
writeFileSync(join(outDir, 'notification-192.png'), icon)

// The badge: the same glyph, white on transparency, nothing else. Android
// discards the colour and keeps the alpha — see the header.
const badge = encodePng(96, (x, y) => blend(WHITE, CLEAR, bellAlpha(x, y, 96)))
writeFileSync(join(outDir, 'badge-96.png'), badge)

console.log(
  `Wrote public/icons/notification-192.png (${icon.length} bytes) and ` +
    `public/icons/badge-96.png (${badge.length} bytes)`
)
