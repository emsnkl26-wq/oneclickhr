/**
 * The optional picture on an announcement.
 *
 * ONE COLUMN, TWO SHAPES. `notifications.image_url` (032) holds either an R2
 * object key from the ordinary two-phase upload, or an external `https://` URL
 * somebody pasted in. They are told apart HERE, by shape, and nowhere else — a
 * second "kind" column would be one more thing that could disagree with the
 * value sitting beside it.
 *
 * NO DIRECTIVE AT THE TOP, ON PURPOSE. The composer validates as you type and
 * the API handler validates what arrives, so client and server both import
 * this. Same reasoning as src/lib/geo.ts.
 */

/**
 * Why this value cannot be stored, or null when it is fine.
 *
 * `http://` is refused rather than upgraded. Every page this renders on is
 * https, so a plain-http image is blocked as mixed content by the browser
 * anyway — failing here, with a sentence explaining it, beats a picture that
 * silently never appears.
 */
export function notificationImageProblem(value: string | null | undefined): string | null {
  const image = (value ?? '').trim()
  if (!image) return null

  if (/^https:\/\//i.test(image)) {
    try {
      new URL(image)
    } catch {
      return 'That does not look like a valid link'
    }
    return null
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(image)) {
    // Anything else with a scheme: http, data:, javascript:, file: …
    return 'Use an https:// link, or upload the image instead'
  }

  // Otherwise it must be one of our own storage keys, which the API re-checks
  // against the caller's tenant before it is stored.
  return null
}

/** True when the stored value is an external link rather than one of our keys. */
export function isExternalImage(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

/**
 * What to put in `<img src>`.
 *
 * An external link is used as-is; a storage key goes through /api/files/view,
 * which is the ONLY read path for the private bucket and re-checks the tenant
 * on every request before redirecting to a short-lived signed URL.
 */
export function notificationImageSrc(value: string | null | undefined): string | null {
  const image = (value ?? '').trim()
  if (!image) return null
  return isExternalImage(image) ? image : `/api/files/view?key=${encodeURIComponent(image)}`
}
