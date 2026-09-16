'use client'

/**
 * The browser half of push: register the worker, ask once, keep the server's
 * idea of this device honest.
 *
 * NOTHING HERE THROWS. Push is unavailable in more ordinary situations than it
 * is available in — an iPhone before 16.4, any iOS browser outside an installed
 * home-screen app, a private window, an enterprise policy, a page that is not on
 * a secure origin, a user who said no six months ago. Every one of those is a
 * normal Tuesday rather than an error, so each is reported as a STATE and the
 * caller renders it. A thrown exception here would surface as a toast telling
 * somebody their browser is broken when it is merely their browser.
 */

export type PushState =
  /** No Notification/PushManager/serviceWorker, or not a secure origin. */
  | 'unsupported'
  /** Supported, but this deployment has no VAPID keys. */
  | 'unconfigured'
  /** Never asked, or asked and dismissed. We may ask again. */
  | 'default'
  /** Granted AND this browser is registered with the server. */
  | 'enabled'
  /** Permission granted but no active subscription — the toggle is off. */
  | 'disabled'
  /** Blocked at the browser level. We cannot ask again; only the user can undo. */
  | 'denied'

/**
 * Feature detection, in the order that gives the most useful answer.
 *
 * `isSecureContext` is checked first because every other API here exists on an
 * insecure origin and simply refuses to work — so testing for them produces
 * "supported", then an opaque failure at `register()`. localhost counts as
 * secure, which is what makes development work without a certificate.
 */
export function isPushSupported(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.isSecureContext &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4)
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i)
  return output
}

function bufferToBase64Url(buffer: ArrayBuffer | null): string {
  if (!buffer) return ''
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

let configPromise: Promise<{ configured: boolean; publicKey: string | null }> | null = null

/** Memoized per page: several components may ask, the answer cannot change. */
function pushConfig(): Promise<{ configured: boolean; publicKey: string | null }> {
  if (!configPromise) {
    configPromise = fetch('/api/push/config', { headers: { Accept: 'application/json' } })
      .then((res) => (res.ok ? res.json() : { configured: false, publicKey: null }))
      .catch(() => ({ configured: false, publicKey: null }))
  }
  return configPromise
}

/**
 * Register the worker, or return the existing registration.
 *
 * `ready` rather than the promise `register()` returns, because the latter
 * resolves as soon as the file is ACCEPTED — before the worker is active — and
 * `pushManager.subscribe()` on an installing worker fails. `ready` waits for an
 * active one, which is the state we actually need.
 */
async function registration(): Promise<ServiceWorkerRegistration | null> {
  try {
    await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    return await navigator.serviceWorker.ready
  } catch (err) {
    console.warn('[push] service worker registration failed', err)
    return null
  }
}

async function postSubscription(subscription: PushSubscription): Promise<boolean> {
  try {
    const res = await fetch('/api/push/subscribe', {
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
    return res.ok
  } catch {
    return false
  }
}

/**
 * Report where this browser stands WITHOUT asking for anything.
 *
 * Deliberately side-effect free, so the UI can render the right control on first
 * paint. `enablePush` is the only function here that can produce a prompt, and
 * it is only ever called from a click — see the note on it.
 */
export async function getPushState(): Promise<PushState> {
  if (!isPushSupported()) return 'unsupported'

  const config = await pushConfig()
  if (!config.configured || !config.publicKey) return 'unconfigured'

  if (Notification.permission === 'denied') return 'denied'
  if (Notification.permission !== 'granted') return 'default'

  const reg = await registration()
  if (!reg) return 'unsupported'

  const existing = await reg.pushManager.getSubscription()
  return existing ? 'enabled' : 'disabled'
}

/**
 * Keep the server's row for this browser current. Called on every page load.
 *
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │ THIS NEVER PROMPTS. It returns early unless permission has ALREADY     │
 * │ been granted.                                                          │
 * │                                                                        │
 * │ Chrome and Firefox both refuse a permission request that is not tied   │
 * │ to a user gesture, and Chrome permanently blocks an origin that asks   │
 * │ from a page load — one automatic prompt and the workspace can never    │
 * │ ask again, on any device that saw it. So the split is strict:          │
 * │ `enablePush` prompts and is wired to a click; this one is the          │
 * │ housekeeping that runs by itself.                                      │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * The re-announcement is what makes the system reliable rather than merely
 * functional. A subscription is rotated by the browser without telling us, and
 * `pushsubscriptionchange` is not fired dependably on every engine; re-sending
 * the current endpoint on each load means the server is never more than one
 * page view behind the truth. It is also what re-attaches a shared browser to
 * whoever is signed in NOW — the upsert in /api/push/subscribe takes the row
 * over on endpoint conflict.
 */
export async function ensurePushSubscription(): Promise<PushState> {
  try {
    if (!isPushSupported()) return 'unsupported'
    if (Notification.permission !== 'granted') {
      return Notification.permission === 'denied' ? 'denied' : 'default'
    }

    const config = await pushConfig()
    if (!config.configured || !config.publicKey) return 'unconfigured'

    const reg = await registration()
    if (!reg) return 'unsupported'

    let subscription = await reg.pushManager.getSubscription()

    /*
     * A subscription minted against a DIFFERENT application server key is
     * useless — the push service answers 403 for the rest of its life, because
     * the key is baked into the endpoint. That happens after a VAPID rotation,
     * and it is invisible: `getSubscription()` returns a perfectly healthy
     * looking object. Comparing the stored key against the current one and
     * re-subscribing on a mismatch is the only way a rotation ever heals.
     */
    if (subscription) {
      const current = bufferToBase64Url(subscription.options?.applicationServerKey ?? null)
      if (current && current !== config.publicKey) {
        await subscription.unsubscribe().catch(() => undefined)
        subscription = null
      }
    }

    if (!subscription) {
      // Permission is already granted, so this resolves without a prompt.
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(config.publicKey) as BufferSource,
      })
    }

    const ok = await postSubscription(subscription)
    return ok ? 'enabled' : 'disabled'
  } catch (err) {
    console.warn('[push] could not refresh the subscription', err)
    return 'disabled'
  }
}

/**
 * Ask for permission and register. CALL ONLY FROM A USER GESTURE — see the box
 * on `ensurePushSubscription` for what happens otherwise.
 */
export async function enablePush(): Promise<PushState> {
  try {
    if (!isPushSupported()) return 'unsupported'

    const config = await pushConfig()
    if (!config.configured || !config.publicKey) return 'unconfigured'

    /*
     * Register BEFORE prompting.
     *
     * The permission dialog is modal on most platforms, so a registration
     * started afterwards runs while the user is looking at a dialog and has
     * every chance to still be installing when they hit Allow — at which point
     * `subscribe()` fails on a worker that is not active yet, and the user has
     * granted permission for nothing. Getting the worker ready first costs a few
     * milliseconds on a page where nothing is waiting.
     */
    const reg = await registration()
    if (!reg) return 'unsupported'

    const permission = await Notification.requestPermission()
    if (permission === 'denied') return 'denied'
    // Dismissed rather than refused: the dialog was closed without an answer, so
    // the permission is still 'default' and we may ask again another day.
    if (permission !== 'granted') return 'default'

    const existing = await reg.pushManager.getSubscription()
    const subscription =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(config.publicKey) as BufferSource,
      }))

    const ok = await postSubscription(subscription)
    if (!ok) {
      /*
       * The server would not record it, so do not leave a live subscription
       * behind. Keeping it would put the browser in a state where it believes it
       * is subscribed and the server has never heard of it — and `getPushState`
       * would report 'enabled' to a device that can never receive anything.
       */
      await subscription.unsubscribe().catch(() => undefined)
      return 'disabled'
    }

    return 'enabled'
  } catch (err) {
    console.warn('[push] could not enable notifications', err)
    return 'disabled'
  }
}

/**
 * Turn this browser off. Permission is untouched — turning it back on is a click
 * rather than a trip into browser settings.
 */
export async function disablePush(): Promise<PushState> {
  try {
    if (!isPushSupported()) return 'unsupported'

    const reg = await navigator.serviceWorker.getRegistration('/')
    const subscription = await reg?.pushManager.getSubscription()
    if (!subscription) return 'disabled'

    /*
     * SERVER FIRST, then the browser.
     *
     * `unsubscribe()` is what makes `subscription.endpoint` unavailable, and the
     * endpoint is the only handle the server has on this row. Unsubscribing
     * first and then failing the request leaves a row nobody can address again,
     * attached to a device that keeps receiving until the push service finally
     * 410s it.
     */
    await fetch('/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    }).catch(() => undefined)

    await subscription.unsubscribe().catch(() => undefined)
    return 'disabled'
  } catch (err) {
    console.warn('[push] could not disable notifications', err)
    return 'enabled'
  }
}
