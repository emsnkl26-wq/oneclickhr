'use client'

import * as React from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { Menu, X, LogOut, ChevronsUpDown, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { navFor, isActive, type NavItem } from '@/components/shell/nav-config'
import { usePendingHref } from '@/lib/nav-progress'
import {
  Avatar, AvatarFallback, AvatarImage,
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
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
 *
 * Two things are worth knowing about how it is built.
 *
 * COLLAPSE is CSS, not React. The rail's width, the content offset and the
 * labels all key off a `data-sidebar` attribute on <html> that a blocking script
 * writes before first paint (see layout.tsx). React only mirrors it for the
 * toggle's icon and the tooltips, so a collapsed rail never flashes open while
 * the bundle loads and nothing reflows on hydration.
 *
 * ACTIVE STATE is a tinted pill with a brand-coloured icon and a small accent
 * bar, rather than a filled crimson block. It reads as "you are here" without
 * turning the quietest surface in the app into the loudest, and — unlike a
 * brand-tinted background — it stays legible in both themes, because the tint
 * comes from the sidebar's own hover colour.
 */

/**
 * Drop anything this app has parked in `localStorage` for the person leaving.
 *
 * The timesheet editor keeps unsaved hours there so a failed request or a closed
 * tab cannot lose a week. That is the right trade while someone is signed in and
 * the wrong one the moment they are not: on a shared ward terminal the next
 * person to sign in would be offered the last one's hours and task notes to
 * restore. Signing out is the boundary, so the drafts end here.
 *
 * Prefixed keys only — `theme` and `sidebar` are this browser's preferences, not
 * this account's data, and clearing them would make every sign-out flash the
 * wrong theme for the next user.
 */
function clearLocalDrafts() {
  try {
    const doomed = Object.keys(window.localStorage).filter((key) =>
      key.startsWith('oneclickhr:')
    )
    doomed.forEach((key) => window.localStorage.removeItem(key))
  } catch {
    // Storage denied or unavailable — there is nothing held to clear.
  }
}

export function Sidebar({ user, brand }: { user: ShellUser; brand: ShellBrand }) {
  const pathname = usePathname()
  const pendingHref = usePendingHref()
  const [open, setOpen] = React.useState(false)
  const [collapsed, setCollapsed] = React.useState(false)
  const sections = React.useMemo(() => navFor(user.role), [user.role])

  // Pick up whatever the pre-hydration script decided, without owning it.
  React.useEffect(() => {
    setCollapsed(document.documentElement.dataset.sidebar === 'collapsed')
  }, [])

  const toggleCollapsed = React.useCallback(() => {
    setCollapsed((previous) => {
      const next = !previous
      const root = document.documentElement
      if (next) root.dataset.sidebar = 'collapsed'
      else delete root.dataset.sidebar
      try {
        localStorage.setItem('sidebar', next ? 'collapsed' : 'expanded')
      } catch {
        // A blocked storage API is not a reason to refuse to collapse.
      }
      return next
    })
  }, [])

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

  /** `inDrawer` opts out of collapsing: the drawer is always full width. */
  function renderNav(inDrawer: boolean) {
    return (
      <nav className="scrollbar-thin flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {sections.map((section, index) => (
          <div key={section.label}>
            {/* Collapsed, the section heading becomes a hairline: the grouping
                survives even when there is no room for the word. */}
            <p className="rail-expanded-only px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-muted">
              {section.label}
            </p>
            {index > 0 ? (
              <div
                className={cn('mx-3 mb-2 hidden h-px bg-sidebar-border', !inDrawer && 'rail-divider')}
                aria-hidden
              />
            ) : null}
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <li key={item.href}>
                  <NavLink
                    item={item}
                    active={isActive(item, highlightPath)}
                    collapsed={collapsed && !inDrawer}
                    onNavigate={() => setOpen(false)}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    )
  }

  function renderBrand(inDrawer: boolean) {
    const mark = brand.logoUrl ? (
      <Image
        src={brand.logoUrl}
        alt=""
        width={32}
        height={32}
        className="size-8 shrink-0 rounded-lg object-cover"
        unoptimized
      />
    ) : (
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white shadow-sm">
        {brand.name.charAt(0).toUpperCase()}
      </span>
    )

    return (
      <div className="rail-center flex h-16 shrink-0 items-center justify-between gap-2.5 border-b border-sidebar-border px-4">
        {/*
         * Collapsed, the logo's slot IS the expand control: the mark sits there
         * until the pointer enters the rail, and fades out under the toggle. It
         * costs no extra row, and the one place a collapsed rail invites a click
         * is the only place worth putting the way back out.
         */}
        {!inDrawer ? (
          <div className="rail-collapsed-only relative size-8 shrink-0 place-items-center">
            <Link
              href="/"
              aria-label={brand.name}
              className="focus-ring rounded-lg opacity-100 transition-opacity duration-150 group-hover/rail:pointer-events-none group-hover/rail:opacity-0"
            >
              {mark}
            </Link>
            <span className="pointer-events-none absolute inset-0 grid place-items-center opacity-0 transition-opacity duration-150 group-hover/rail:pointer-events-auto group-hover/rail:opacity-100">
              <CollapseButton collapsed onToggle={toggleCollapsed} />
            </span>
          </div>
        ) : null}

        <Link
          href="/"
          className={cn(
            'focus-ring flex min-w-0 items-center gap-2.5 rounded-lg',
            !inDrawer && 'rail-expanded-only'
          )}
          aria-label={brand.name}
        >
          {mark}
          <span className="rail-label text-[15px] font-semibold tracking-[-0.015em] text-sidebar-fg">
            {brand.name}
          </span>
        </Link>

        <div className={cn('flex shrink-0 items-center gap-0.5', !inDrawer && 'rail-expanded-only')}>
          <ThemeToggle />
          {inDrawer ? (
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close navigation"
              className="focus-ring grid size-8 place-items-center rounded-lg text-sidebar-muted transition-colors hover:bg-sidebar-hover hover:text-sidebar-fg"
            >
              <X className="size-[18px]" />
            </button>
          ) : (
            <CollapseButton collapsed={collapsed} onToggle={toggleCollapsed} />
          )}
        </div>
      </div>
    )
  }

  function renderAccount(inDrawer: boolean) {
    const isCollapsed = collapsed && !inDrawer
    return (
      <div className="shrink-0 border-t border-sidebar-border p-3">
        {/* Collapsed, the theme toggle loses its home in the header, so it
            joins the account row where there is still a spare slot. */}
        {isCollapsed ? (
          <div className="mb-1 flex justify-center">
            <ThemeToggle />
          </div>
        ) : null}

        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              'rail-center focus-ring flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-sidebar-hover'
            )}
          >
            <Avatar className="size-8 shrink-0 border-sidebar-border">
              {user.photoUrl ? <AvatarImage src={user.photoUrl} alt="" /> : null}
              <AvatarFallback className="bg-brand-600 text-white">
                {initials(user.name, user.email)}
              </AvatarFallback>
            </Avatar>
            <span className="rail-label">
              <span className="block truncate text-[13px] font-medium text-sidebar-fg">
                {user.name || user.email}
              </span>
              <span className="block truncate text-[11px] text-sidebar-muted">{user.email}</span>
            </span>
            <ChevronsUpDown
              className="rail-expanded-only size-4 shrink-0 text-sidebar-muted"
              aria-hidden
            />
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
              <form
                action="/api/auth/signout"
                method="post"
                className="w-full"
                onSubmit={clearLocalDrafts}
              >
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
  }

  return (
    <TooltipProvider delayDuration={200} skipDelayDuration={400}>
      {/* Mobile top bar — the only place the hamburger lives. */}
      <div className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-card/85 px-4 backdrop-blur-md lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
          aria-expanded={open}
          className="focus-ring -ml-1 rounded-lg p-2 text-ink-muted transition-colors hover:bg-page hover:text-ink"
        >
          <Menu className="size-5" />
        </button>
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-[-0.01em]">
          {brand.name}
        </span>
        <ThemeToggle className="text-ink-muted hover:bg-page hover:text-ink" />
      </div>

      {/* Desktop rail */}
      <aside className="rail group/rail fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        {renderBrand(false)}
        {renderNav(false)}
        {renderAccount(false)}
      </aside>

      {/* Mobile drawer */}
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 animate-fade-in bg-ink/50 backdrop-blur-[2px]"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <aside className="rail-drawer absolute inset-y-0 left-0 flex w-[17.5rem] animate-slide-in-left flex-col bg-sidebar shadow-pop">
            {renderBrand(true)}
            {renderNav(true)}
            {renderAccount(true)}
          </aside>
        </div>
      ) : null}
    </TooltipProvider>
  )
}

/* ---------------------------------------------------------------- Nav link */

function NavLink({
  item, active, collapsed, onNavigate,
}: {
  item: NavItem
  active: boolean
  collapsed: boolean
  onNavigate: () => void
}) {
  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'rail-center group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors',
        active
          ? 'bg-sidebar-hover font-medium text-sidebar-fg'
          : 'text-sidebar-fg/70 hover:bg-sidebar-hover/70 hover:text-sidebar-fg'
      )}
    >
      {/* The accent bar — the one place the brand colour appears in the rail. */}
      <span
        className={cn(
          'absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-brand-600 transition-opacity',
          active ? 'opacity-100' : 'opacity-0'
        )}
        aria-hidden
      />
      <item.icon
        className={cn(
          'size-[18px] shrink-0 transition-colors',
          active ? 'text-brand-600' : 'text-sidebar-muted group-hover:text-sidebar-fg'
        )}
        aria-hidden
      />
      <span className="rail-label">{item.label}</span>
    </Link>
  )

  // A label the user cannot read is a label they need on hover.
  if (!collapsed) return link

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  )
}

/* --------------------------------------------------------- Collapse toggle */

function CollapseButton({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}
          className="focus-ring grid size-8 shrink-0 place-items-center rounded-lg text-sidebar-muted transition-colors hover:bg-sidebar-hover hover:text-sidebar-fg"
        >
          <Icon className="size-[18px]" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{collapsed ? 'Expand' : 'Collapse'}</TooltipContent>
    </Tooltip>
  )
}
