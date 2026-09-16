'use client'

import * as React from 'react'
import { usePathname } from 'next/navigation'
import { toast } from 'sonner'
import { enablePush, ensurePushSubscription, isPushSupported } from '@/lib/push/client'

/** Portal home pages — the only places we ask for permission unprompted. */
const DASHBOARD_PATHS = new Set(['/employee', '/org'])
const ASKED_KEY = 'push:asked-this-session'

/**
 * Keeps this browser's push registration current, and asks for permission on
 * the dashboard. RENDERS NOTHING.
 *
 * Mounted once, in the app shell. On every page it re-announces an existing
 * subscription (endpoints rotate silently). On a portal home page, if the user
 * has never answered, it asks — once per browser session, so a dismissed prompt
 * does not come back on every navigation.
 *
 * Chromium browsers show the prompt straight from page load. Firefox and Safari
 * ignore a request without a user gesture, so when the permission is still
 * undecided afterwards a toast with an "Allow" button offers the gesture.
 */
export function PushBootstrap() {
  const pathname = usePathname()

  React.useEffect(() => {
    let cancelled = false

    const run = async () => {
      if (cancelled) return
      await ensurePushSubscription()

      if (cancelled || !DASHBOARD_PATHS.has(pathname)) return
      if (!isPushSupported() || Notification.permission !== 'default') return

      try {
        if (sessionStorage.getItem(ASKED_KEY)) return
        sessionStorage.setItem(ASKED_KEY, '1')
      } catch {
        /* storage unavailable — ask anyway */
      }

      const state = await enablePush()
      if (cancelled || state !== 'default' || Notification.permission !== 'default') return

      toast('Turn on notifications?', {
        description: 'Get timesheet decisions, replies and announcements as they happen.',
        duration: 15000,
        action: {
          label: 'Allow',
          onClick: () => {
            void enablePush().then((next) => {
              if (next === 'enabled') toast.success('Notifications are on for this browser')
              else if (next === 'service-blocked') {
                toast.error('Your browser’s push service is off. See Notifications for how to fix it.')
              }
            })
          },
        },
      })
    }

    const handle = window.setTimeout(() => void run(), 1200)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [pathname])

  return null
}
