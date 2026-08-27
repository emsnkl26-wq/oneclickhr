'use client'

/**
 * The boundary of last resort.
 *
 * `error.tsx` is rendered INSIDE the root layout, so it cannot catch a failure
 * in that layout — a bad font fetch, a throw from `@/lib/env`, a provider that
 * blows up on mount. When that happens Next looks for this file instead, and it
 * must supply its own `<html>` and `<body>` because the ones it would have
 * inherited are the thing that failed.
 *
 * For the same reason it cannot use the app's components, theme provider or
 * Tailwind layer with any confidence: the stylesheet import lives in the layout
 * that just failed. Everything here is inline and self-contained on purpose,
 * including a dark-mode-aware palette via `color-scheme`.
 */

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          colorScheme: 'light dark',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        }}
      >
        <main style={{ maxWidth: '28rem', textAlign: 'center' }}>
          <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>
            Oneclickhr could not start
          </h1>
          <p style={{ marginTop: '0.75rem', fontSize: '0.875rem', lineHeight: 1.6, opacity: 0.75 }}>
            Something failed before the page could be drawn. Your data has not been affected. Please
            reload, and tell your administrator if it continues.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: '1.5rem',
              padding: '0.5rem 1.125rem',
              borderRadius: '0.625rem',
              border: '1px solid currentColor',
              background: 'transparent',
              color: 'inherit',
              font: 'inherit',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
          {error.digest ? (
            <p style={{ marginTop: '1.5rem', fontSize: '0.75rem', opacity: 0.6 }}>
              Reference: {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  )
}
