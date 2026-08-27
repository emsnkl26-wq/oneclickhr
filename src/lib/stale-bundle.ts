/**
 * Recognising "the browser asked for a bundle this deploy no longer serves".
 *
 * Every deploy renames the JS/CSS chunks and retires the old ones. A tab that
 * was open beforehand is holding markup pointing at the previous build, so its
 * next navigation requests a file that now 404s and React throws the failure
 * into the nearest error boundary. The page is fine; the deploy stranded it.
 *
 * This lives in a plain module — no `'use client'` — so both the boundary and
 * the tests can read it as an ordinary function. (A Server Component importing
 * a value out of a client module gets a proxy instead of the value; see
 * `scripts/check-client-boundary.ts`.)
 */

/** Shapes browsers actually produce for a chunk or dynamic import that 404s. */
const STALE_BUNDLE_PATTERNS = [
  /ChunkLoadError/i,                              // the name React/webpack gives it
  /Loading chunk \S+ failed/i,                    // webpack, JS
  /Loading CSS chunk/i,                           // webpack, CSS
  /Failed to fetch dynamically imported module/i, // Chrome
  /error loading dynamically imported module/i,   // Firefox
  /Importing a module script failed/i,            // Safari
]

export function isStaleBundleError(error: { name?: string; message?: string } | null): boolean {
  if (!error) return false
  const text = `${error.name ?? ''} ${error.message ?? ''}`
  return STALE_BUNDLE_PATTERNS.some((pattern) => pattern.test(text))
}
