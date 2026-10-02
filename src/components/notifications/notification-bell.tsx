'use client'

import * as React from 'react'
import Link from 'next/link'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Bell, BellOff, CheckCheck, ChevronRight, Loader2, X } from 'lucide-react'
import { apiGet, apiPost } from '@/lib/fetcher'
import { getPushState, enablePush, type PushState } from '@/lib/push/client'
import { cn } from '@/lib/utils'

interface InboxItem {
  id: string
  title: string
  description: string | null
  createdAt: string
  personal: boolean
  read: boolean
  href: string
}

interface Inbox {
  items: InboxItem[]
  unread: number
  allHref: string | null
}

/** How often the badge re-checks while the tab is visible. */
const POLL_MS = 60_000

/*
 * ONE INBOX PER TAB. The shell renders a bell in more than one place (desktop
 * header, collapsed rail, phone top bar) and only CSS decides which is visible,
 * so the list lives here rather than in each instance: one poll, one badge
 * count, and marking read in one bell clears them all.
 */
const store: { inbox: Inbox | null; listeners: Set<() => void>; stop: (() => void) | null } = {
  inbox: null,
  listeners: new Set(),
  stop: null,
}

function setStoreInbox(next: Inbox | null | ((current: Inbox | null) => Inbox | null)) {
  store.inbox = typeof next === 'function' ? next(store.inbox) : next
  store.listeners.forEach((listener) => listener())
}

async function loadInbox() {
  try {
    setStoreInbox(await apiGet<Inbox>('/api/notifications/inbox'))
  } catch {
    // A failed refresh keeps the last good list; the next poll tries again.
  }
}

function startPolling(): () => void {
  void loadInbox()
  const tick = () => {
    if (document.visibilityState === 'visible') void loadInbox()
  }
  const timer = window.setInterval(tick, POLL_MS)
  window.addEventListener('focus', tick)
  document.addEventListener('visibilitychange', tick)
  // A push arriving while the app is open is the moment the badge is most
  // obviously stale.
  navigator.serviceWorker?.addEventListener?.('message', tick)
  return () => {
    window.clearInterval(timer)
    window.removeEventListener('focus', tick)
    document.removeEventListener('visibilitychange', tick)
    navigator.serviceWorker?.removeEventListener?.('message', tick)
  }
}

function subscribe(listener: () => void): () => void {
  store.listeners.add(listener)
  if (!store.stop) store.stop = startPolling()
  return () => {
    store.listeners.delete(listener)
    if (!store.listeners.size && store.stop) {
      store.stop()
      store.stop = null
    }
  }
}

/**
 * The bell in the sidebar header, and the inbox it opens.
 *
 * The panel slides in from the right on a desktop and rises from the bottom on
 * a phone, where a right-hand drawer would cover the whole screen anyway and a
 * bottom sheet is what the thumb expects. It is a Radix dialog underneath, so
 * focus is trapped, Escape closes it and the page behind does not scroll.
 *
 * Opening the panel marks what it shows as read — the same receipt the
 * notifications page writes — so the badge and the page never disagree.
 */
export function NotificationBell({ className }: { className?: string }) {
  const [open, setOpen] = React.useState(false)
  const inbox = React.useSyncExternalStore(subscribe, () => store.inbox, () => null)
  const setInbox = setStoreInbox
  const load = loadInbox
  const [loading, setLoading] = React.useState(false)

  async function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      // Closing settles the "new" highlights the reader has now seen.
      setInbox((current) =>
        current
          ? { ...current, unread: 0, items: current.items.map((item) => ({ ...item, read: true })) }
          : current
      )
      return
    }
    setLoading(true)
    await load()
    setLoading(false)
  }

  // Mark as read once the list is actually on screen.
  React.useEffect(() => {
    if (!open || !inbox) return
    const ids = inbox.items.filter((item) => !item.read).map((item) => item.id)
    if (!ids.length) return
    apiPost('/api/employee/notifications/read', { ids }).catch(() => undefined)
  }, [open, inbox])

  async function markAllRead() {
    if (!inbox) return
    const ids = inbox.items.filter((item) => !item.read).map((item) => item.id)
    setInbox({ ...inbox, unread: 0, items: inbox.items.map((item) => ({ ...item, read: true })) })
    if (ids.length) await apiPost('/api/employee/notifications/read', { ids }).catch(() => undefined)
  }

  const unread = inbox?.unread ?? 0

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Trigger
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        className={cn(
          'focus-ring relative grid size-8 shrink-0 place-items-center rounded-lg text-sidebar-muted transition hover:bg-sidebar-hover hover:text-sidebar-fg',
          className
        )}
      >
        <Bell className="size-[18px]" />
        {unread ? (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-brand-600 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-sidebar">
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </DialogPrimitive.Trigger>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-[2px] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className={cn(
            'fixed z-50 flex flex-col overflow-hidden border-line bg-card shadow-pop outline-none',
            // Phone: a bottom sheet.
            'inset-x-0 bottom-0 max-h-[85dvh] rounded-t-2xl border-t',
            'data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom',
            // Desktop: a right-hand panel.
            'sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-[400px] sm:rounded-none sm:border-l sm:border-t-0',
            'sm:data-[state=open]:slide-in-from-right sm:data-[state=closed]:slide-out-to-right sm:data-[state=open]:slide-in-from-bottom-0 sm:data-[state=closed]:slide-out-to-bottom-0',
            'duration-300'
          )}
        >
          <div className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-line sm:hidden" aria-hidden />

          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-base font-semibold text-ink">Notifications</DialogPrimitive.Title>
              <DialogPrimitive.Description className="text-xs text-ink-muted">
                {unread ? `${unread} unread` : 'You are all caught up'}
              </DialogPrimitive.Description>
            </div>
            <div className="flex items-center gap-1">
              {unread ? (
                <button
                  type="button"
                  onClick={markAllRead}
                  className="focus-ring inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-brand-600 transition hover:bg-page"
                >
                  <CheckCheck className="size-3.5" aria-hidden />
                  Mark all read
                </button>
              ) : null}
              <DialogPrimitive.Close
                aria-label="Close"
                className="focus-ring grid size-8 place-items-center rounded-lg text-ink-muted transition hover:bg-page hover:text-ink"
              >
                <X className="size-4" />
              </DialogPrimitive.Close>
            </div>
          </div>

          <PushPrompt />

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {!inbox && loading ? (
              <div className="grid place-items-center py-16 text-ink-muted">
                <Loader2 className="size-5 animate-spin" aria-hidden />
              </div>
            ) : inbox && inbox.items.length ? (
              <ul className="divide-y divide-line">
                {inbox.items.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className={cn(
                        'group flex gap-3 px-5 py-3.5 transition-colors hover:bg-page focus-visible:bg-page focus-visible:outline-none',
                        !item.read && 'bg-brand-50/50 dark:bg-brand-500/5'
                      )}
                    >
                      <span
                        className={cn(
                          'mt-1.5 size-2 shrink-0 rounded-full',
                          item.read ? 'bg-transparent' : 'bg-brand-600'
                        )}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className={cn('block text-sm leading-snug text-ink', !item.read && 'font-semibold')}>
                          {item.title}
                        </span>
                        {item.description ? (
                          <span className="mt-0.5 line-clamp-2 block text-[13px] leading-snug text-ink-muted">
                            {item.description}
                          </span>
                        ) : null}
                        <span className="mt-1 block text-[11px] text-ink-muted">{timeAgo(item.createdAt)}</span>
                      </span>
                      <ChevronRight
                        className="mt-1 size-4 shrink-0 text-ink-muted opacity-0 transition group-hover:opacity-100"
                        aria-hidden
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex flex-col items-center px-6 py-16 text-center">
                <span className="mb-3 grid size-12 place-items-center rounded-2xl bg-page text-ink-muted">
                  <Bell className="size-5" aria-hidden />
                </span>
                <p className="text-sm font-medium text-ink">No notifications yet</p>
                <p className="mt-1 text-xs text-ink-muted">
                  Tickets, leave, payslips and other updates will show up here.
                </p>
              </div>
            )}
          </div>

          {inbox?.allHref ? (
            <div className="shrink-0 border-t border-line p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <Link
                href={inbox.allHref}
                onClick={() => setOpen(false)}
                className="focus-ring block rounded-lg py-2 text-center text-sm font-medium text-brand-600 transition hover:bg-page"
              >
                View all notifications
              </Link>
            </div>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/**
 * A one-line nudge to turn on device notifications, shown only while it can
 * actually be fixed with a click (never asked, or dismissed). Blocked and
 * unsupported states belong to the full toggle on the notifications page.
 */
function PushPrompt() {
  const [state, setState] = React.useState<PushState | null>(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    getPushState().then(setState).catch(() => setState(null))
  }, [])

  if (state !== 'default' && state !== 'disabled') return null

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-line bg-page px-5 py-3">
      <BellOff className="size-4 shrink-0 text-ink-muted" aria-hidden />
      <p className="min-w-0 flex-1 text-xs text-ink-muted">Get alerts on this device even when the app is closed.</p>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setState(await enablePush().catch(() => state))
          setBusy(false)
        }}
        className="focus-ring shrink-0 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
      >
        {busy ? 'Enabling…' : 'Enable'}
      </button>
    </div>
  )
}

function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'Just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}
