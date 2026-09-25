import Image from 'next/image'
import { BRAND, BRAND_ASSETS, type BrandAsset, type BrandLogoVariant } from '@/lib/brand'
import { cn } from '@/lib/utils'

/**
 * Which surface the logo sits on.
 *
 *   auto   follows the theme — the right choice for anything that inherits
 *          `bg-card`, `bg-page` or `bg-sidebar`.
 *   light  always the artwork made for LIGHT backgrounds (dark lettering).
 *   dark   always the artwork made for DARK backgrounds (white lettering) — for
 *          a panel that is dark in both themes, like the sign-in brand panel.
 */
export type LogoTone = 'auto' | 'light' | 'dark'

const ART: Record<BrandLogoVariant, { light: BrandAsset; dark: BrandAsset }> = {
  horizontal: { light: BRAND_ASSETS.horizontal, dark: BRAND_ASSETS.horizontalDark },
  wordmark: { light: BRAND_ASSETS.wordmark, dark: BRAND_ASSETS.wordmarkDark },
  vertical: { light: BRAND_ASSETS.vertical, dark: BRAND_ASSETS.verticalDark },
  // The mark is orange-on-anything: one file serves both surfaces.
  mark: { light: BRAND_ASSETS.mark, dark: BRAND_ASSETS.mark },
}

interface BrandLogoProps {
  variant?: BrandLogoVariant
  /** Rendered height in CSS pixels; width follows the artwork's proportions. */
  height?: number
  tone?: LogoTone
  className?: string
  /** True for a logo in the first screenful, so it is fetched before the rest. */
  priority?: boolean
  /** Pass an empty string when the logo sits next to the name in text. */
  alt?: string
}

/**
 * The OneclickHR logo, in whichever lockup and ink the surface needs.
 *
 * Theme switching is CSS, not React state. Both files are in the markup and
 * Tailwind's `dark:` variant shows one — the root layout puts the `dark` class
 * on <html> before first paint, so there is no frame where the wrong one shows,
 * and this stays a server component.
 *
 * `unoptimized` is deliberate: these are small pre-sized PNGs, and the image
 * optimizer would re-encode gradient artwork to lossy WebP for no saving.
 */
export function BrandLogo({
  variant = 'horizontal',
  height = 32,
  tone = 'auto',
  className,
  priority = false,
  alt = BRAND.name,
}: BrandLogoProps) {
  const { light, dark } = ART[variant]
  const size = (asset: BrandAsset) => ({
    width: Math.round((height * asset.width) / asset.height),
    height,
  })
  const sameArt = light.src === dark.src

  const image = (asset: BrandAsset, extra: string, label: string) => (
    <Image
      src={asset.src}
      alt={label}
      {...size(asset)}
      priority={priority}
      unoptimized
      className={cn('shrink-0 select-none', extra, className)}
      draggable={false}
    />
  )

  if (sameArt || tone === 'light') return image(light, '', alt)
  if (tone === 'dark') return image(dark, '', alt)

  return (
    <>
      {image(light, 'dark:hidden', alt)}
      {image(dark, 'hidden dark:block', '')}
    </>
  )
}
