/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
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
     * Every route in this app is `force-dynamic`, and Next's default of 0
     * seconds for dynamic segments means going back to a page you were on two
     * seconds ago re-renders it on the server from scratch. 30 seconds makes
     * back/forward and the common tab-hopping loop instant, and costs nothing in
     * staleness: every mutation in this codebase finishes with
     * `router.refresh()`, which invalidates the cache outright.
     */
    staleTimes: {
      dynamic: 30,
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
