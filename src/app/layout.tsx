import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { Toaster } from 'sonner'
import { ThemeProvider } from '@/components/theme-provider'
import { RouteProgress } from '@/components/shell/route-progress'
import { BRAND, BRAND_ASSETS, brandOgImage } from '@/lib/brand'
import { appUrl } from '@/lib/env'
import '@/app/globals.css'

// Importing this for its side effect: environment validation runs once per
// server instance, at boot, before any request is served.
import '@/lib/env'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
})

export const metadata: Metadata = {
  // Makes every relative image URL below absolute. Link-preview crawlers do not
  // resolve a relative og:image, and without this Next guesses localhost.
  metadataBase: new URL(appUrl()),
  title: {
    default: BRAND.title,
    template: `%s · ${BRAND.name}`,
  },
  description: BRAND.description,
  applicationName: BRAND.name,
  robots: { index: false, follow: false },

  // `/favicon.ico` (multi-size) is what browsers ask for by default and what
  // older ones stop at; the PNGs are for the ones that read the <link> tags.
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: BRAND_ASSETS.favicon32.src, type: 'image/png', sizes: '32x32' },
      { url: BRAND_ASSETS.favicon16.src, type: 'image/png', sizes: '16x16' },
    ],
    apple: [{ url: BRAND_ASSETS.appleTouch.src, sizes: '180x180', type: 'image/png' }],
  },
  // Served by src/app/manifest.ts.
  manifest: '/manifest.webmanifest',

  openGraph: {
    type: 'website',
    siteName: BRAND.name,
    title: BRAND.title,
    description: BRAND.description,
    images: [brandOgImage(BRAND_ASSETS.ogDefault, BRAND.title)],
  },
  twitter: {
    card: 'summary_large_image',
    title: BRAND.title,
    description: BRAND.description,
    images: [BRAND_ASSETS.ogDefault.src],
  },
}

export const viewport: Viewport = {
  // Browser chrome follows the app's theme rather than one fixed colour.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: BRAND.themeColor.light },
    { media: '(prefers-color-scheme: dark)', color: BRAND.themeColor.dark },
  ],
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Blocking, pre-hydration: sets the `dark` class and the collapsed
            state of the sidebar rail before first paint, so neither the theme
            nor the layout flashes the wrong way round on load. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}if(t==='dark'){document.documentElement.classList.add('dark')}if(localStorage.getItem('sidebar')==='collapsed'){document.documentElement.setAttribute('data-sidebar','collapsed')}}catch(e){}})()`,
          }}
        />
      </head>
      <body className="font-sans">
        <ThemeProvider>
          {/* Acknowledges every in-app navigation on the tick it is clicked,
              long before the server has anything to say. */}
          <RouteProgress />
          {children}
          <Toaster
            position="top-right"
            toastOptions={{
              className: 'rounded-xl border border-line shadow-card',
              style: { background: 'hsl(var(--card))', color: 'hsl(var(--text))' },
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  )
}
