'use client'

import * as React from 'react'
import { PenLine, Upload, Type, Eraser, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { LogoAsset } from '@/lib/document-pdf'

type Mode = 'draw' | 'upload' | 'type'

const SCRIPT_FONT = "'Segoe Script', 'Brush Script MT', 'Lucida Handwriting', 'Apple Chancery', cursive"
const INK = '#1a1c23'

/**
 * Crop a canvas to its inked pixels (plus a little padding) and hand it back as
 * a PNG asset jsPDF can embed. Returns null for a blank canvas.
 */
function trimCanvas(source: HTMLCanvasElement): LogoAsset | null {
  const ctx = source.getContext('2d')
  if (!ctx) return null
  const { width, height } = source
  const data = ctx.getImageData(0, 0, width, height).data
  let top = height, left = width, right = -1, bottom = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < left) left = x
        if (x > right) right = x
        if (y < top) top = y
        if (y > bottom) bottom = y
      }
    }
  }
  if (right < 0) return null

  const pad = 6
  left = Math.max(0, left - pad)
  top = Math.max(0, top - pad)
  right = Math.min(width - 1, right + pad)
  bottom = Math.min(height - 1, bottom + pad)

  const out = document.createElement('canvas')
  out.width = right - left + 1
  out.height = bottom - top + 1
  out.getContext('2d')?.drawImage(source, left, top, out.width, out.height, 0, 0, out.width, out.height)
  return { dataUrl: out.toDataURL('image/png'), format: 'PNG', width: out.width, height: out.height }
}

/** Render a typed name in a script face onto a transparent canvas. */
function renderTyped(name: string): LogoAsset | null {
  if (!name.trim()) return null
  const canvas = document.createElement('canvas')
  canvas.width = 900
  canvas.height = 220
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  let size = 110
  ctx.font = `${size}px ${SCRIPT_FONT}`
  while (ctx.measureText(name).width > canvas.width - 40 && size > 30) {
    size -= 6
    ctx.font = `${size}px ${SCRIPT_FONT}`
  }
  ctx.fillStyle = INK
  ctx.textBaseline = 'middle'
  ctx.fillText(name, 20, canvas.height / 2)
  return trimCanvas(canvas)
}

/**
 * Load an uploaded PNG/JPG and re-encode it as a PNG. A white JPEG background
 * is keyed out so the signature sits on the page rather than in a box.
 */
async function renderUpload(file: File): Promise<LogoAsset | null> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement | null>((resolve) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => resolve(null)
      image.src = url
    })
    if (!img) return null
    const scale = Math.min(1, 1200 / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const d = pixels.data
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235) d[i + 3] = 0
    }
    ctx.putImageData(pixels, 0, 0)
    return trimCanvas(canvas)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * The signatory's signature, captured three ways: drawn on a pad (mouse, pen or
 * touch), uploaded as an image, or typed and set in a script face. Whatever the
 * source, the result is a trimmed transparent PNG handed up through `onChange`
 * — null when there is none, in which case the letter keeps its blank line.
 */
export function SignaturePad({
  value, onChange, defaultName,
}: {
  value: LogoAsset | null
  onChange: (value: LogoAsset | null) => void
  defaultName: string
}) {
  const [mode, setMode] = React.useState<Mode>('draw')
  const [typed, setTyped] = React.useState('')
  const [uploadError, setUploadError] = React.useState<string | null>(null)
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const drawing = React.useRef(false)
  const last = React.useRef<{ x: number; y: number } | null>(null)
  const inked = React.useRef(false)

  // Size the drawing surface to its box at device resolution.
  React.useEffect(() => {
    if (mode !== 'draw') return
    const canvas = canvasRef.current
    if (!canvas) return
    const ratio = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = Math.round(rect.width * ratio)
    canvas.height = Math.round(rect.height * ratio)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(ratio, ratio)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = 2.2
    ctx.strokeStyle = INK
    inked.current = false
  }, [mode])

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  function onPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drawing.current = true
    last.current = point(event)
    const ctx = event.currentTarget.getContext('2d')
    if (ctx && last.current) {
      ctx.beginPath()
      ctx.arc(last.current.x, last.current.y, 1.1, 0, Math.PI * 2)
      ctx.fillStyle = INK
      ctx.fill()
      inked.current = true
    }
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || !last.current) return
    const ctx = event.currentTarget.getContext('2d')
    if (!ctx) return
    const next = point(event)
    ctx.beginPath()
    ctx.moveTo(last.current.x, last.current.y)
    ctx.lineTo(next.x, next.y)
    ctx.stroke()
    last.current = next
    inked.current = true
  }

  function onPointerUp() {
    if (!drawing.current) return
    drawing.current = false
    last.current = null
    if (inked.current && canvasRef.current) onChange(trimCanvas(canvasRef.current))
  }

  function clear() {
    const canvas = canvasRef.current
    if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    inked.current = false
    setTyped('')
    setUploadError(null)
    onChange(null)
  }

  function switchMode(next: Mode) {
    if (next === mode) return
    clear()
    setMode(next)
    if (next === 'type') {
      setTyped(defaultName)
      onChange(renderTyped(defaultName))
    }
  }

  const tabs: Array<{ value: Mode; label: string; icon: React.ReactNode }> = [
    { value: 'draw', label: 'Draw', icon: <PenLine className="size-4" /> },
    { value: 'upload', label: 'Upload', icon: <Upload className="size-4" /> },
    { value: 'type', label: 'Type', icon: <Type className="size-4" /> },
  ]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-line bg-page p-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => switchMode(tab.value)}
              className={cn(
                'focus-ring inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition',
                mode === tab.value ? 'bg-card text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
              )}
              aria-pressed={mode === tab.value}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={clear} disabled={!value && mode !== 'draw'}>
          <Eraser />
          Clear
        </Button>
      </div>

      {mode === 'draw' ? (
        <div className="relative">
          <canvas
            ref={canvasRef}
            className="h-40 w-full cursor-crosshair touch-none rounded-lg border border-dashed border-line bg-white"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
            onPointerCancel={onPointerUp}
            aria-label="Signature pad — draw your signature"
          />
          {!value ? (
            <span className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs text-ink-muted">
              Sign here with your mouse, pen or finger
            </span>
          ) : null}
        </div>
      ) : null}

      {mode === 'upload' ? (
        <div className="space-y-2">
          <Input
            type="file"
            accept="image/png,image/jpeg"
            onChange={async (event) => {
              const file = event.target.files?.[0]
              if (!file) return
              if (!['image/png', 'image/jpeg'].includes(file.type)) {
                setUploadError('Choose a PNG or JPG image.')
                return
              }
              setUploadError(null)
              const asset = await renderUpload(file)
              if (!asset) setUploadError('That image could not be read.')
              onChange(asset)
            }}
          />
          <p className="text-xs text-ink-muted">
            PNG or JPG. A transparent PNG or a signature on plain white paper works best.
          </p>
          {uploadError ? <p className="text-xs text-red-600">{uploadError}</p> : null}
        </div>
      ) : null}

      {mode === 'type' ? (
        <div className="space-y-2">
          <Input
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value)
              onChange(renderTyped(event.target.value))
            }}
            placeholder="Type your full name"
          />
          <div
            className="flex h-24 items-center rounded-lg border border-dashed border-line bg-white px-4 text-4xl text-ink"
            style={{ fontFamily: SCRIPT_FONT }}
          >
            {typed || <span className="font-sans text-base text-ink-muted">Preview</span>}
          </div>
        </div>
      ) : null}

      {value && mode !== 'draw' && mode !== 'type' ? (
        <div className="flex items-center gap-3 rounded-lg border border-line bg-white px-4 py-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value.dataUrl} alt="Signature" className="max-h-16 max-w-[240px] object-contain" />
          <button
            type="button"
            onClick={clear}
            className="focus-ring ml-auto rounded-md p-1 text-ink-muted hover:text-ink"
            aria-label="Remove signature"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : null}
    </div>
  )
}
