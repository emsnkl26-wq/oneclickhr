import type { MetadataRoute } from 'next'
import { BRAND } from '@/lib/brand'

/**
 * The web app manifest — what "Add to Home Screen" and "Install app" read.
 *
 * `start_url` is `/`, which is a router: it forwards a signed-in user to their
 * portal and everyone else to sign-in. There is no separate "app" entry point.
 *
 * This is NOT a promise of offline support. The service worker (public/sw.js)
 * handles push notifications only and deliberately has no fetch handler, so an
 * installed copy needs the network exactly as the site does.
 *
 * `background_color` is what the OS paints while the app launches, before the
 * first frame — the brand charcoal, so it never flashes white on the way in.
 * Both icons are served from /icons, which middleware lets through signed out.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND.name,
    short_name: BRAND.name,
    description: BRAND.description,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: BRAND.colors.charcoal,
    theme_color: BRAND.colors.primary,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
