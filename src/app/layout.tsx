import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { Toaster } from 'sonner'
import { ThemeProvider } from '@/components/theme-provider'
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
  title: {
    default: 'Oneclickhr',
    template: '%s · Oneclickhr',
  },
  description: 'Employee management for modern care organizations.',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  themeColor: '#16181F',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Blocking, pre-hydration: sets the `dark` class before first paint so
            there's no flash of the wrong theme. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}if(t==='dark'){document.documentElement.classList.add('dark')}}catch(e){}})()`,
          }}
        />
      </head>
      <body className="font-sans">
        <ThemeProvider>
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
