'use client'

import * as React from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { Menu, X, LogOut, ChevronsUpDown } from 'lucide-react'
import { navFor, isActive } from '@/components/shell/nav-config'
import { usePendingHref } from '@/lib/nav-progress'
import {
  Avatar, AvatarFallback, AvatarImage,
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/primitives'
import { ThemeToggle } from '@/components/theme-toggle'
import { cn, initials } from '@/lib/utils'
import type { UserRole } from '@/types/db'

export interface ShellUser {
  name: string
  email: string
  role: UserRole
  photoUrl: string | null
}

export interface ShellBrand {
  name: string
  logoUrl: string | null
}

/**
 * The sidebar is the app's spine: a fixed rail on desktop, a slide-over drawer
 * below `lg`. It closes on navigation, because a drawer that stays open after a
 * tap hides the page the user just asked for.
 */
export function Sidebar({ user, brand }: { user: ShellUser; brand: ShellBrand }) {
  const pathname = usePathname()
  const pendingHref = usePendingHref()
  const [open, setOpen] = React.useState(false)
  const sections = React.useMemo(() => navFor(user.role), [user.role])

  /*
   * Move the highlight the moment a link is clicked rather than when the server
   * answers. Only when the destination actually maps to a nav item, though —
   * navigating to /change-password should not blank the rail out.
   */
  const highlightPath = React.useMemo(() => {
    const destination = pendingHref?.split('?')[0]
    if (!destination) return pathname
    const known = sections.some((section) =>
      section.items.some((item) => isActive(item, destination))
    )
    return known ? destination : pathname
  }, [pendingHref, pathname, sections])

  React.useEffect(() => {
    setOpen(false)
  }, [pathname])

  // Lock body scroll while the mobile drawer is open.
  React.useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  const nav = (
    <nav className="scrollbar-thin flex-1 space-y-6 overflow-y-auto px-3 py-4">
      {sections.map((section) => (
        <div key={section.label}>
          <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-muted">
            {section.label}
          </p>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active = isActive(item, highlightPath)
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                      active
                        ? 'bg-brand-600 font-medium text-white shadow-sm'
                        : 'text-sidebar-fg/80 hover:bg-sidebar-hover hover:text-sidebar-fg'
                    )}
                  >
                    <item.icon className="size-[18px] shrink-0" aria-hidden />
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )

  const brandBlock = (
    <div className="flex h-16 shrink-0 items-center justify-between gap-2.5 border-b border-sidebar-border px-5">
      <div className="flex min-w-0 items-center gap-2.5">
        {brand.logoUrl ? (
          <Image
            src={brand.logoUrl}
            alt=""
            width={28}
            height={28}
            className="size-7 rounded-md object-cover"
            unoptimized
          />
        ) : (
          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-brand-600 text-[13px] font-bold text-white">
            {brand.name.charAt(0).toUpperCase()}
          </span>
        )}
        <span className="truncate text-[15px] font-semibold tracking-[-0.01em] text-sidebar-fg">
          {brand.name}
        </span>
      </div>
      <ThemeToggle />
    </div>
  )

  const account = (
    <div className="shrink-0 border-t border-sidebar-border p-3">
      <DropdownMenu>
        <DropdownMenuTrigger className="focus-ring flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition hover:bg-sidebar-hover">
          <Avatar className="size-8 border-sidebar-border">
            {user.photoUrl ? <AvatarImage src={user.photoUrl} alt="" /> : null}
            <AvatarFallback className="bg-brand-600 text-white">
              {initials(user.name, user.email)}
            </AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-sidebar-fg">
              {user.name || user.email}
            </span>
            <span className="block truncate text-[11px] text-sidebar-muted">{user.email}</span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-sidebar-muted" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" className="w-56">
          <DropdownMenuLabel>Signed in</DropdownMenuLabel>
          <DropdownMenuItem asChild>
            <Link href={user.role === 'employee' ? '/employee/profile' : '/org/settings'}>
              Account settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/change-password">Change password</Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive asChild>
            <form action="/api/auth/signout" method="post" className="w-full">
              <button type="submit" className="flex w-full items-center gap-2">
                <LogOut className="size-4" aria-hidden />
                Sign out
              </button>
            </form>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )

  return (
    <>
      {/* Mobile top bar — the only place the hamburger lives. */}
      <div className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-card px-4 lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
          className="focus-ring -ml-1 rounded-lg p-2 text-ink-muted hover:bg-page hover:text-ink"
        >
          <Menu className="size-5" />
        </button>
        <span className="truncate text-[15px] font-semibold">{brand.name}</span>
      </div>

      {/* Desktop rail */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col bg-sidebar lg:flex">
        {brandBlock}
        {nav}
        {account}
      </aside>

      {/* Mobile drawer */}
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 animate-fade-in bg-ink/50"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <aside className="absolute inset-y-0 left-0 flex w-72 animate-slide-in-left flex-col bg-sidebar">
            <div className="flex h-16 shrink-0 items-center justify-between gap-2.5 border-b border-sidebar-border px-5">
              <div className="flex min-w-0 items-center gap-2.5">
                {brand.logoUrl ? (
                  <Image
                    src={brand.logoUrl}
                    alt=""
                    width={28}
                    height={28}
                    className="size-7 rounded-md object-cover"
                    unoptimized
                  />
                ) : (
                  <span className="grid size-7 shrink-0 place-items-center rounded-md bg-brand-600 text-[13px] font-bold text-white">
                    {brand.name.charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="truncate text-[15px] font-semibold tracking-[-0.01em] text-sidebar-fg">
                  {brand.name}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <ThemeToggle />
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close navigation"
                  className="focus-ring rounded-lg p-2 text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-fg"
                >
                  <X className="size-5" />
                </button>
              </div>
            </div>
            {nav}
            {account}
          </aside>
        </div>
      ) : null}
    </>
  )
}
