/* eslint-disable */
/**
 * Oneclickhr service worker — notifications only.
 *
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │ THERE IS DELIBERATELY NO `fetch` HANDLER.                              │
 * │                                                                        │
 * │ A service worker that handles fetch sits in front of EVERY request the │
 * │ app makes, forever, including the ones carrying session cookies. This  │
 * │ one exists to receive pushes, and receiving pushes needs no fetch      │
 * │ interception at all. Adding one "for offline support" would put a      │
 * │ cache in front of a multi-tenant HR product — where a stale response   │
 * │ served to the next person to sign in on that browser is a data leak,   │
 * │ not a slow page — and would do it in a file that updates on its own    │
 * │ schedule, independently of the deploy that broke it.                   │
 * │                                                                        │
 * │ Every route in this app is `force-dynamic` and behind auth. There is   │
 * │ nothing here worth caching and a great deal worth not caching.         │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Plain ES5-ish JavaScript with no build step, because this file is served
 * verbatim from `public/` and is not part of the bundle. It cannot import from
 * `src/`, so the few constants it needs are repeated here — and chosen so that
 * repeating them cannot rot (see the origin check in `openTarget`, which
 * replaces what would otherwise be a duplicated list of routes).
 */

var ICON = '/icons/notification-192.png'
var BADGE = '/icons/badge-96.png'
var FALLBACK_URL = '/employee/notifications'

/*
 * Take over immediately on install rather than waiting for every tab to close.
 *
 * The usual argument against `skipWaiting` is that it can swap the worker under
 * a page whose JavaScript expects the old one. That argument does not apply to a
 * worker with no fetch handler and no cache: there is no contract between the
 * page and this file to break. What DOES apply is the cost of waiting — a fix to
 * push handling would otherwise reach a user who keeps one tab open forever
 * approximately never.
 */
self.addEventListener('install', function (event) {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim())
})

/**
 * Read the payload defensively.
 *
 * `event.data` can be absent entirely: a push service may deliver a wake-up with
 * no body, and Chrome synthesises one when a payload fails to decrypt. Neither
 * is a reason to show nothing — a notification the user cannot see is worse than
 * a generic one they can act on — so anything unreadable degrades to a nudge
 * pointing at the notifications list.
 */
function readPayload(event) {
  var fallback = {
    title: 'New notification',
    body: 'Open the portal to read it.',
    url: FALLBACK_URL,
  }

  if (!event.data) return fallback

  try {
    var parsed = event.data.json()
    if (!parsed || typeof parsed !== 'object') return fallback
    return {
      title: typeof parsed.title === 'string' && parsed.title ? parsed.title : fallback.title,
      body: typeof parsed.body === 'string' ? parsed.body : '',
      url: typeof parsed.url === 'string' && parsed.url ? parsed.url : fallback.url,
      id: typeof parsed.id === 'string' ? parsed.id : undefined,
      tag: typeof parsed.tag === 'string' ? parsed.tag : undefined,
      image: typeof parsed.image === 'string' ? parsed.image : undefined,
    }
  } catch (err) {
    // Not JSON. Some services deliver a bare string; show it rather than lose it.
    try {
      var text = event.data.text()
      if (text) return { title: 'New notification', body: text.slice(0, 300), url: fallback.url }
    } catch (innerErr) {
      /* fall through */
    }
    return fallback
  }
}

self.addEventListener('push', function (event) {
  var payload = readPayload(event)

  var options = {
    body: payload.body,
    icon: ICON,
    badge: BADGE,
    /*
     * `tag` groups; `renotify` makes a replacement still alert.
     *
     * Without renotify, the second comment on a card replaces the first
     * SILENTLY — the shade updates but nothing buzzes — which reads as the
     * product having dropped the message. Chrome requires a tag whenever
     * renotify is set, so the two travel together or neither is sent.
     */
    tag: payload.tag || payload.id || undefined,
    renotify: payload.tag ? true : false,
    /*
     * FALSE, so the notification sits in the shade until it is dealt with.
     *
     * These are decisions people are waiting on — a timesheet returned for
     * changes, a payment confirmed. An auto-dismissing toast for something with
     * a payroll deadline attached is the wrong default; a notification that
     * waits can be swiped away in a second by anyone who does not care.
     */
    requireInteraction: false,
    /*
     * Carried through to the click handler. `notification.data` is the only
     * channel between the two events — the closure here is gone by the time
     * anyone taps, because the worker is very likely to have been shut down and
     * restarted in between.
     */
    data: { url: payload.url, id: payload.id || null },
  }

  if (payload.image) options.image = payload.image

  event.waitUntil(self.registration.showNotification(payload.title, options))
})

/**
 * Where a tap should land, resolved safely.
 *
 * The payload is written by our own server, so this check looks redundant — and
 * is not. It runs in the user's browser on data that arrived over the network,
 * and the one invariant worth enforcing there is that a notification can only
 * ever navigate to THIS origin. `new URL(url, origin)` collapses every way of
 * expressing somewhere else — an absolute `https://elsewhere/`, a protocol-
 * relative `//elsewhere/`, a `javascript:` — into a URL whose origin can simply
 * be compared. Anything that fails goes to the notifications list instead.
 *
 * An origin comparison rather than a list of known paths, deliberately: a list
 * duplicated from `src/lib/notifications/routes.ts` into a file that cannot
 * import it is a list that will disagree with it one day, and the failure would
 * be a working notification that refuses to open.
 */
function openTarget(raw) {
  try {
    var resolved = new URL(raw || FALLBACK_URL, self.location.origin)
    if (resolved.origin !== self.location.origin) return self.location.origin + FALLBACK_URL
    return resolved.href
  } catch (err) {
    return self.location.origin + FALLBACK_URL
  }
}

self.addEventListener('notificationclick', function (event) {
  event.notification.close()

  var target = openTarget(event.notification.data && event.notification.data.url)

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(function (clientList) {
        /*
         * Reuse a tab rather than opening a new one.
         *
         * Someone who taps four notifications over a morning should not end up
         * with four tabs of the same workspace. Preference order: a tab already
         * showing the exact destination, then any tab of this app (navigated to
         * the destination), and only failing both, a new window.
         *
         * `navigate()` is not implemented everywhere and rejects on some
         * engines, so a failure falls back to focusing what we found — the user
         * lands in the app rather than nowhere.
         */
        for (var i = 0; i < clientList.length; i++) {
          if (clientList[i].url === target && 'focus' in clientList[i]) {
            return clientList[i].focus()
          }
        }

        for (var j = 0; j < clientList.length; j++) {
          var client = clientList[j]
          if (client.url.indexOf(self.location.origin) === 0 && 'navigate' in client) {
            return client
              .focus()
              .then(function (focused) {
                return (focused || client).navigate(target)
              })
              .catch(function () {
                return client.focus()
              })
          }
        }

        if (self.clients.openWindow) return self.clients.openWindow(target)
        return undefined
      })
      .catch(function (err) {
        // Never leave a tap doing nothing at all.
        if (self.clients.openWindow) return self.clients.openWindow(target)
        return undefined
      })
  )
})

/**
 * The browser rotated this subscription out from under us.
 *
 * Fired when a push service retires an endpoint and issues a replacement — on
 * its own schedule, with no user action, and often while no tab of ours is open.
 * If nothing handles it, the row in `push_subscriptions` points at an endpoint
 * that now 410s, every push to that device fails, and the user concludes push
 * stopped working. The page-load re-announcement in `ensurePushSubscription`
 * eventually repairs it, but "eventually" is the next time they open the app —
 * which for the notifications that matter most is exactly too late.
 *
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │ THE APPLICATION SERVER KEY IS THE AWKWARD PART.                        │
 * │                                                                        │
 * │ Re-subscribing needs the VAPID public key, and this event can fire     │
 * │ with no page running to supply it. `event.oldSubscription` carries it  │
 * │ in `options.applicationServerKey` — as an ArrayBuffer — but not on     │
 * │ every engine, so the fallback fetches /api/push/config. That request   │
 * │ carries the session cookie (same-origin fetch defaults to sending it), │
 * │ and if the session has since expired it 401s, we give up, and the      │
 * │ next page load fixes it. That is the correct outcome: a signed-out     │
 * │ browser should not be re-registering for anybody's notifications.      │
 * └────────────────────────────────────────────────────────────────────────┘
 */
function bufferToBase64Url(buffer) {
  var bytes = new Uint8Array(buffer)
  var binary = ''
  for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return self.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToUint8Array(base64Url) {
  var padding = '='.repeat((4 - (base64Url.length % 4)) % 4)
  var base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/')
  var raw = self.atob(base64)
  var output = new Uint8Array(raw.length)
  for (var i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i)
  return output
}

function applicationServerKey(event) {
  var existing =
    event.oldSubscription &&
    event.oldSubscription.options &&
    event.oldSubscription.options.applicationServerKey

  if (existing) {
    try {
      return Promise.resolve(new Uint8Array(existing))
    } catch (err) {
      /* fall through to the network */
    }
  }

  return fetch('/api/push/config', { headers: { Accept: 'application/json' } })
    .then(function (res) {
      if (!res.ok) return null
      return res.json()
    })
    .then(function (body) {
      if (!body || !body.publicKey) return null
      return base64UrlToUint8Array(body.publicKey)
    })
    .catch(function () {
      return null
    })
}

self.addEventListener('pushsubscriptionchange', function (event) {
  event.waitUntil(
    applicationServerKey(event)
      .then(function (key) {
        if (!key) return null
        return self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        })
      })
      .then(function (subscription) {
        if (!subscription) return null
        return fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            endpoint: subscription.endpoint,
            keys: {
              p256dh: bufferToBase64Url(subscription.getKey('p256dh')),
              auth: bufferToBase64Url(subscription.getKey('auth')),
            },
          }),
        })
      })
      .catch(function (err) {
        // Nothing useful to do here. The next page load re-announces.
        return undefined
      })
  )
})
