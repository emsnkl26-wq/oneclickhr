'use client'

/**
 * The brand-colour picker.
 *
 * `<input type="color">` hands the whole job to the operating system — a grey
 * Windows dialog or a macOS colour wheel, neither of which belongs in a
 * workspace settings page, and neither of which can show what the choice will
 * actually look like in the product.
 *
 * This one is ours end to end: a saturation/value field, a hue slider, the
 * presets most orgs actually want, and a hex box for a brand guideline that
 * names an exact value. `value`/`onChange` carry a `#RRGGBB` string, the same
 * thing the native input emitted.
 */

import * as React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { controlBase } from '@/components/ui/select'

const HEX = /^#([0-9a-f]{6})$/i

/** Ready-made choices, so most orgs never touch the slider at all. */
const PRESETS = [
  '#C41E33', '#DC2626', '#EA580C', '#D97706', '#16A34A', '#059669',
  '#0891B2', '#2563EB', '#4F46E5', '#7C3AED', '#DB2777', '#1A1C23',
]

/* ------------------------------------------------------- Colour conversion */

interface Hsv {
  h: number
  s: number
  v: number
}

function hexToHsv(hex: string): Hsv {
  const match = HEX.exec(hex)
  if (!match) return { h: 352, s: 0.73, v: 0.77 }

  const int = parseInt(match[1], 16)
  const r = ((int >> 16) & 255) / 255
  const g = ((int >> 8) & 255) / 255
  const b = (int & 255) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min

  let h = 0
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6
    else if (max === g) h = (b - r) / delta + 2
    else h = (r - g) / delta + 4
    h *= 60
    if (h < 0) h += 360
  }

  return { h, s: max === 0 ? 0 : delta / max, v: max }
}

function hsvToHex({ h, s, v }: Hsv): string {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c

  const [r, g, b] =
    h < 60 ? [c, x, 0]
    : h < 120 ? [x, c, 0]
    : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c]
    : h < 300 ? [x, 0, c]
    : [c, 0, x]

  const channel = (n: number) =>
    Math.round((n + m) * 255).toString(16).padStart(2, '0')

  return `#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase()
}

/* ------------------------------------------------------------ Drag surface */

/**
 * Pointer-driven 2D (or 1D) drag, reported as fractions of the element's box.
 *
 * Pointer capture is what makes the drag survive leaving the element — without
 * it the handle sticks the moment the cursor crosses the edge, which is exactly
 * when someone is reaching for pure white or full saturation.
 */
function useDragArea(onMove: (x: number, y: number) => void) {
  const ref = React.useRef<HTMLDivElement>(null)

  const report = React.useCallback(
    (event: React.PointerEvent) => {
      const box = ref.current?.getBoundingClientRect()
      if (!box) return
      const x = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width))
      const y = Math.min(1, Math.max(0, (event.clientY - box.top) / box.height))
      onMove(x, y)
    },
    [onMove]
  )

  return {
    ref,
    onPointerDown: (event: React.PointerEvent) => {
      event.currentTarget.setPointerCapture(event.pointerId)
      report(event)
    },
    onPointerMove: (event: React.PointerEvent) => {
      if (event.buttons !== 1) return
      report(event)
    },
  }
}

/* ---------------------------------------------------------------- The field */

export interface ColorFieldProps {
  value: string
  onChange: (value: string) => void
  id?: string
  disabled?: boolean
  className?: string
  'aria-label'?: string
  'aria-describedby'?: string
}

export function ColorField({
  value,
  onChange,
  id,
  disabled,
  className,
  ...aria
}: ColorFieldProps) {
  const [open, setOpen] = React.useState(false)
  const valid = HEX.test(value)
  const safe = valid ? value.toUpperCase() : '#C41E33'

  /*
   * HSV is held locally while the popover is open. Round-tripping through hex
   * on every pointer move would lose the hue as soon as the user dragged into
   * pure black or pure white — every such colour is #000000, and converting
   * back gives hue 0, so the picker would snap to red under the cursor.
   */
  const [hsv, setHsv] = React.useState<Hsv>(() => hexToHsv(safe))

  React.useEffect(() => {
    if (open) setHsv(hexToHsv(safe))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function apply(next: Hsv) {
    setHsv(next)
    onChange(hsvToHex(next))
  }

  const svArea = useDragArea((x, y) => apply({ ...hsv, s: x, v: 1 - y }))
  const hueArea = useDragArea((x) => apply({ ...hsv, h: x * 360 }))

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          className={cn(
            controlBase,
            'flex h-10 w-auto items-center gap-2.5 pl-2 pr-3',
            'hover:border-ink-muted/40 data-[state=open]:border-brand-600 data-[state=open]:ring-2 data-[state=open]:ring-brand-600/15',
            className
          )}
          {...aria}
        >
          <span
            className="size-6 shrink-0 rounded-md ring-1 ring-inset ring-ink/10"
            style={{ background: safe }}
            aria-hidden
          />
          <span className="tabular text-sm uppercase">{valid ? value : safe}</span>
        </button>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={6}
          className={cn(
            'z-50 w-64 rounded-xl border border-line bg-card p-3 shadow-pop',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95'
          )}
        >
          {/* Saturation / value */}
          <div
            {...svArea}
            role="application"
            aria-label="Saturation and brightness"
            className="relative h-32 w-full cursor-crosshair touch-none rounded-lg"
            style={{
              backgroundColor: `hsl(${hsv.h} 100% 50%)`,
              backgroundImage:
                'linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)',
            }}
          >
            <span
              className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
              style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
              aria-hidden
            />
          </div>

          {/* Hue */}
          <div
            {...hueArea}
            role="application"
            aria-label="Hue"
            className="relative mt-3 h-3 w-full cursor-pointer touch-none rounded-full"
            style={{
              backgroundImage:
                'linear-gradient(to right, #f00, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00)',
            }}
          >
            <span
              className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-transparent shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
              style={{ left: `${(hsv.h / 360) * 100}%` }}
              aria-hidden
            />
          </div>

          {/* Presets */}
          <div className="mt-3 grid grid-cols-6 gap-1.5">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                aria-label={preset}
                onClick={() => {
                  setHsv(hexToHsv(preset))
                  onChange(preset)
                }}
                className="focus-ring grid aspect-square place-items-center rounded-md ring-1 ring-inset ring-ink/10 transition-transform hover:scale-110"
                style={{ background: preset }}
              >
                {preset.toUpperCase() === safe ? (
                  <Check className="size-3.5 stroke-[3] text-white drop-shadow" aria-hidden />
                ) : null}
              </button>
            ))}
          </div>

          {/* Hex — for a brand guideline that names an exact value. */}
          <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
            <span
              className="size-7 shrink-0 rounded-md ring-1 ring-inset ring-ink/10"
              style={{ background: safe }}
              aria-hidden
            />
            <input
              value={value}
              maxLength={7}
              spellCheck={false}
              aria-label="Hex colour"
              onChange={(event) => {
                const next = event.target.value.toUpperCase()
                onChange(next)
                if (HEX.test(next)) setHsv(hexToHsv(next))
              }}
              className={cn(
                'tabular h-9 w-full rounded-lg border border-line bg-card px-2.5 text-sm uppercase text-ink outline-none transition-colors focus-visible:border-brand-600',
                !valid && 'border-danger'
              )}
            />
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
