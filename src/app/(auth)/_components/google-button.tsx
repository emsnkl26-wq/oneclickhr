'use client'

import * as React from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'

/** Google's "G", in its own colours — the mark people look for on this button. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-4" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}

/**
 * Continue with Google — organization accounts only.
 *
 * The browser starts the OAuth round trip (Supabase keeps the PKCE verifier in
 * a cookie), and /auth/callback finishes it on the server, where the
 * one-address-one-way-in rule is enforced. `intent` only changes the wording
 * and where a brand-new Google account is sent; the callback decides the rest.
 */
export function GoogleButton({ intent }: { intent: 'login' | 'signup' }) {
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function start() {
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?intent=${intent}`,
        queryParams: { prompt: 'select_account' },
      },
    })
    if (oauthError) {
      setError('Google sign-in is not available right now. Please use your email and password.')
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <Button type="button" variant="secondary" size="lg" className="w-full" loading={busy} onClick={start}>
        {busy ? null : <GoogleMark />}
        {intent === 'signup' ? 'Sign up with Google' : 'Continue with Google'}
      </Button>
      {error ? <p className="text-center text-xs text-danger">{error}</p> : null}
    </div>
  )
}

/** The "or" rule between Google and the email form. */
export function OrDivider() {
  return (
    <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-wider text-ink-muted">
      <span className="h-px flex-1 bg-line" />
      or
      <span className="h-px flex-1 bg-line" />
    </div>
  )
}
