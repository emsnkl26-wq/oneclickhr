'use client'

import * as React from 'react'
import { Bell, BellOff, BellRing, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  getPushState,
  enablePush,
  disablePush,
  type PushState,
} from '@/lib/push/client'

/**
 * The one place a person turns browser notifications on or off.
 *
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │ EVERY STATE GETS ITS OWN SENTENCE.                                     │
 * │                                                                        │
 * │ The tempting shape here is a switch that is either on or off. It is    │
 * │ the wrong shape, because "off" covers at least five genuinely          │
 * │ different situations — never asked, asked and dismissed, blocked in    │
 * │ browser settings, unsupported browser, push not configured on the      │
 * │ server — and exactly one of them (the first two) can be fixed by       │
 * │ clicking the switch. Rendering the other three as an off switch means  │
 * │ somebody on an iPhone taps it repeatedly, nothing happens, and they    │
 * │ conclude the product is broken.                                        │
 * │                                                                        │
 * │ `denied` is the one worth being most careful about: permission can     │
 * │ only be restored from the browser's own settings, and JavaScript is    │
 * │ not allowed to prompt again or to open that panel. A button there      │
 * │ would be a button that cannot work, so the copy explains where to go   │
 * │ instead.                                                               │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Nothing here is a preference stored on the server. The subscription IS the
 * preference: a row in `push_subscriptions` means this browser receives, its
 * absence means it does not, and there is no third place for the two to
 * disagree.
 */

interface Presentation {
  icon: React.ComponentType<{ className?: string }>
  tone: string
  title: string
  description: string
}

const PRESENTATION: Record<PushState, Presentation> = {
  enabled: {
    icon: BellRing,
    tone: 'text-brand-600',
    title: 'Notifications are on for this browser',
    description:
      'You will be alerted here as things happen, even when this tab is closed. Important updates are also emailed to you.',
  },
  disabled: {
    icon: BellOff,
    tone: 'text-ink-muted',
    title: 'Notifications are off for this browser',
    description:
      'Turn them on to hear about timesheet decisions, replies and announcements without checking back.',
  },
  default: {
    icon: Bell,
    tone: 'text-ink-muted',
    title: 'Get notified as things happen',
    description:
      'Your browser will ask for permission. You can turn this off again at any time, and it only affects this browser.',
  },
  denied: {
    icon: BellOff,
    tone: 'text-ink-muted',
    title: 'Notifications are blocked in your browser',
    description:
      'This has to be changed where your browser keeps site permissions — open the padlock or site-settings icon next to the address bar and allow notifications for this site, then reload.',
  },
  unsupported: {
    icon: BellOff,
    tone: 'text-ink-muted',
    title: 'This browser cannot show notifications',
    description:
      'On an iPhone or iPad, add this site to your Home Screen first — Safari only allows notifications for installed sites. Everything still reaches you by email and in the list below.',
  },
  unconfigured: {
    icon: BellOff,
    tone: 'text-ink-muted',
    title: 'Browser notifications are not set up',
    description:
      'This workspace has not been configured for push notifications yet. Your notifications still appear here and important ones are emailed.',
  },
}

export function PushToggle({ className }: { className?: string }) {
  /*
   * `null` is LOADING, and it is a distinct state rather than an optimistic
   * guess at 'default'. Resolving the real one needs `Notification.permission`,
   * the service worker registration and a round trip to /api/push/config —
   * none of which exist during the server render. Guessing means the card
   * renders "Turn on notifications" and then flips to "already on" a moment
   * later, in front of somebody who has had it on for weeks.
   */
  const [state, setState] = React.useState<PushState | null>(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    getPushState().then((resolved) => {
      if (!cancelled) setState(resolved)
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function turnOn() {
    setBusy(true)
    try {
      // Called straight out of the click handler — see the box on
      // ensurePushSubscription() for why that matters.
      const next = await enablePush()
      setState(next)

      if (next === 'enabled') toast.success('Notifications are on for this browser')
      else if (next === 'denied') {
        toast.error('Your browser blocked notifications. You can allow them in site settings.')
      } else if (next === 'default') {
        // Dismissed rather than refused. Nothing went wrong and nothing changed.
        toast('No problem — you can turn these on whenever you like.')
      } else if (next === 'unconfigured') {
        toast.error('Push notifications are not set up for this workspace yet.')
      } else {
        toast.error('Could not turn on notifications. Please try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  async function turnOff() {
    setBusy(true)
    try {
      const next = await disablePush()
      setState(next)
      if (next === 'disabled') toast.success('Notifications are off for this browser')
      else toast.error('Could not turn off notifications. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (state === null) {
    return (
      <Card className={className}>
        <div className="flex items-center gap-3 p-5 text-sm text-ink-muted">
          <Loader2 className="size-4 animate-spin" />
          Checking notification settings…
        </div>
      </Card>
    )
  }

  const presentation = PRESENTATION[state]
  const Icon = presentation.icon
  const canAsk = state === 'default' || state === 'disabled'

  return (
    <Card className={className}>
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Icon className={`mt-0.5 size-5 shrink-0 ${presentation.tone}`} />
          <div className="min-w-0">
            <p className="font-medium">{presentation.title}</p>
            <p className="mt-1 text-sm leading-relaxed text-ink-muted">
              {presentation.description}
            </p>
          </div>
        </div>

        {canAsk ? (
          <Button className="shrink-0" loading={busy} onClick={turnOn}>
            <Bell />
            Turn on
          </Button>
        ) : state === 'enabled' ? (
          <Button variant="secondary" className="shrink-0" loading={busy} onClick={turnOff}>
            <BellOff />
            Turn off
          </Button>
        ) : (
          /*
           * denied / unsupported / unconfigured — no button at all, because
           * there is no action this page can take. See the box above.
           */
          null
        )}
      </div>
    </Card>
  )
}
