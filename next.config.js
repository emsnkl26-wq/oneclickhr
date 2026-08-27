/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  /*
   * Next's built-in trailing-slash redirect runs BEFORE middleware, which makes
   * it invisible and unfixable from there. That matters for exactly one class of
   * caller: a webhook sender whose URL was typed with a trailing slash gets a
   * 308 it either refuses to follow on a POST or re-issues as a GET — the
   * handler never runs, and the auth action it was serving fails with no useful
   * error anywhere. Turning the automatic redirect off lets middleware REWRITE
   * those paths instead (method, body and signature headers intact) and issue
   * the ordinary redirect itself for everything else. See middleware.ts.
   */
  skipTrailingSlashRedirect: true,
  eslint: {
    // Lint is a separate `npm run lint` gate; a style nit must not fail a deploy.
    ignoreDuringBuilds: true,
  },
  serverExternalPackages: ['unpdf', 'isomorphic-dompurify', 'file-type'],

  /*
   * Barrel files are a real cost here. `lucide-react` alone re-exports well over
   * a thousand modules, and `recharts`/`date-fns` are not much better; without
   * this every route that touches one pulls the whole index into its compile
   * graph. Next rewrites the imports to the exact submodules instead.
   */
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      'recharts',
      'date-fns',
      'date-fns-tz',
      '@dnd-kit/core',
      '@dnd-kit/sortable',
    ],

    /*
     * Client-side Router Cache.
     *
     * Dynamic segments are NOT cached, which is Next's own default and is the
     * only setting this app can be correct under.
     *
     * The previous 30 seconds rested on "every mutation finishes with
     * `router.refresh()`, which invalidates the cache outright". That holds
     * right up until the mutation NAVIGATES — create a timesheet, get pushed to
     * the new week, press Back — and there it does not: `router.refresh()`
     * followed immediately by `router.push()` starts a second transition that
     * discards the first, so the refresh never lands and Back replays a list
     * rendered before the row existed. The employee is shown "No timesheets yet"
     * over a week they just created, concludes their hours are gone, and opens
     * the week again from scratch. The same shape appears wherever a create
     * hands off to a detail page (help desk, letters).
     *
     * Every route here is `force-dynamic` and behind auth, so nothing is
     * shareable between users anyway; the cost of refetching is one round trip
     * against a global progress bar, and the cost of NOT refetching is an HR
     * record that appears to have vanished.
     */
    staleTimes: {
      dynamic: 0,
      static: 180,
    },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ]
  },
}

module.exports = nextConfig
