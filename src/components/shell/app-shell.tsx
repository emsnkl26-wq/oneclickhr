import * as React from 'react'
import { Sidebar, type ShellBrand, type ShellUser } from '@/components/shell/sidebar'
import { hexToHslTriple, shiftLightness } from '@/lib/utils'
import type { AppContext } from '@/lib/auth/context'

/**
 * The workspace frame: themed sidebar rail + scrollable content column.
 *
 * PER-ORG THEMING happens here and nowhere else. The org's saved hex colour is
 * converted to the same HSL-triple format globals.css uses and written as inline
 * CSS variables on this wrapper. Because every `bg-brand-600` in the app reads
 * `hsl(var(--brand-600))`, overriding the variable re-themes the entire
 * workspace — no conditional classes, no runtime class generation, and the
 * Oneclickhr crimson stays the default when an org has not chosen one.
 *
 * The 50/700 shades are DERIVED from the chosen hue rather than left at the
 * crimson defaults; mixing a custom primary with a crimson tint would look like
 * a bug.
 */
function brandVariables(hex: string | null | undefined): React.CSSProperties | undefined {
  if (!hex) return undefined
  const triple = hexToHslTriple(hex)
  if (!triple) return undefined

  return {
    '--brand-600': triple,
    '--brand-700': shiftLightness(triple, -7),
    '--brand-800': shiftLightness(triple, -14),
    '--brand-500': shiftLightness(triple, +8),
    '--brand-200': shiftLightness(triple, +40),
    '--brand-100': shiftLightness(triple, +47),
    '--brand-50': shiftLightness(triple, +51),
    '--danger': triple,
  } as React.CSSProperties
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
  const style = ctx.role === 'super_admin' ? undefined : brandVariables(ctx.tenant?.primaryColor)

  return (
    <div style={style} className="min-h-screen bg-page">
      <Sidebar user={user} brand={brand} />
      <div className="lg:pl-64">
        <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  )
}
