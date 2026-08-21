import * as React from 'react'
import { Sidebar, type ShellBrand, type ShellUser } from '@/components/shell/sidebar'
import { hexToHslTriple, shiftLightness } from '@/lib/utils'
import type { AppContext } from '@/lib/auth/context'

/**
 * The workspace frame: themed sidebar rail + scrollable content column.
 *
 * PER-ORG THEMING happens here and nowhere else. The org's saved hex colour is
 * converted to the same HSL-triple format globals.css uses and written as CSS
 * variables on `:root`. Because every `bg-brand-600` in the app reads
 * `hsl(var(--brand-600))`, overriding the variable re-themes the entire
 * workspace — no conditional classes, no runtime class generation, and the
 * Oneclickhr crimson stays the default when an org has not chosen one.
 *
 * It targets `:root` rather than a wrapper div so that chrome rendered OUTSIDE
 * this subtree — the fixed route-progress bar in the root layout — is brand
 * coloured too. Exactly one AppShell is ever mounted, so there is no rule to
 * conflict with, and emitting it server-side means no flash of the wrong colour.
 *
 * The 50/700 shades are DERIVED from the chosen hue rather than left at the
 * crimson defaults; mixing a custom primary with a crimson tint would look like
 * a bug.
 */
function brandCss(hex: string | null | undefined): string | null {
  const triple = hexToHslTriple(hex ?? '')
  // `hexToHslTriple` only ever returns numbers parsed out of a `#rrggbb` match,
  // so nothing user-controlled can reach the stylesheet as text.
  if (!triple) return null

  const declarations: Record<string, string> = {
    '--brand-600': triple,
    '--brand-700': shiftLightness(triple, -7),
    '--brand-800': shiftLightness(triple, -14),
    '--brand-500': shiftLightness(triple, +8),
    '--brand-200': shiftLightness(triple, +40),
    '--brand-100': shiftLightness(triple, +47),
    '--brand-50': shiftLightness(triple, +51),
    '--danger': triple,
  }

  const body = Object.entries(declarations)
    .map(([name, value]) => `${name}:${value}`)
    .join(';')

  return `:root{${body}}`
}

export function AppShell({
  ctx,
  children,
}: {
  ctx: AppContext
  children: React.ReactNode
}) {
  const user: ShellUser = {
    name: ctx.fullName || '',
    email: ctx.email,
    role: ctx.role,
    photoUrl: ctx.photoUrl ? `/api/files/view?key=${encodeURIComponent(ctx.photoUrl)}` : null,
  }

  const brand: ShellBrand = {
    name: ctx.role === 'super_admin' ? 'Oneclickhr' : (ctx.tenant?.name ?? 'Workspace'),
    logoUrl: ctx.tenant?.logoUrl
      ? `/api/files/view?key=${encodeURIComponent(ctx.tenant.logoUrl)}`
      : null,
  }

  // The platform console always wears Oneclickhr crimson — it is our product,
  // not a customer's workspace.
  const css = ctx.role === 'super_admin' ? null : brandCss(ctx.tenant?.primaryColor)

  return (
    <div className="min-h-screen bg-page">
      {css ? <style>{css}</style> : null}
      <Sidebar user={user} brand={brand} />
      {/* `rail-offset` rather than a fixed `lg:pl-64`: the collapsed rail is
          half the width, and the offset has to follow it. */}
      <div className="rail-offset">
        <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  )
}
