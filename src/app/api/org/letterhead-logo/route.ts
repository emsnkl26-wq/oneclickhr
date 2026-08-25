import { NextResponse } from 'next/server'
import { withErrorHandler, jsonOk } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { keyBelongsToTenant, headObject, getObject } from '@/lib/r2'

export const dynamic = 'force-dynamic'

/**
 * The org's own logo, as a `data:` URL, for embedding in a generated PDF.
 *
 * WHY THIS EXISTS RATHER THAN REUSING `/api/files/view`. That route 302s to a
 * signed R2 URL, which is perfect for an `<img src>` — the browser follows the
 * redirect and never needs permission to READ the bytes. Embedding a logo in a
 * PDF does need to read them, and a cross-origin `fetch` to the storage host
 * requires the bucket's CORS policy to allow GET from this origin. Most buckets
 * are configured for the PUT that uploads need and nothing else, so the logo
 * would silently vanish from every document on a correctly-working deployment.
 *
 * This route is same-origin, so no CORS question arises. It streams a small
 * image through the function once per document — an acceptable cost for the one
 * asset that has to be readable rather than merely displayable.
 *
 * SCOPE IS DELIBERATELY NARROW. It takes no `key` parameter at all: it reads the
 * caller's OWN tenant's `logo_url` and nothing else, so there is no reference
 * here that could be pointed at another object.
 */

/** Logos are capped at 2MB by the upload policy; refuse anything larger. */
const MAX_BYTES = 2 * 1024 * 1024

/**
 * jsPDF's `addImage` handles PNG and JPEG reliably and nothing else — an SVG
 * has no raster to embed, and WebP support varies by build. Sniffed from the
 * leading bytes rather than trusted from a stored content type.
 */
function rasterFormat(bytes: Buffer): 'PNG' | 'JPEG' | null {
  if (bytes.length < 4) return null
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'PNG'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'JPEG'
  return null
}

/** Answered as "no logo" rather than as an error — a letterhead survives without one. */
const NO_LOGO = { dataUrl: null as string | null, format: null as string | null }

async function handleGET() {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const supabase = await createSupabaseServerClient()
  const { data: tenant } = await supabase
    .from('tenants')
    .select('logo_url')
    .eq('id', ctx.tenantId)
    .maybeSingle()

  const key = tenant?.logo_url
  if (!key || !keyBelongsToTenant(key, ctx.tenantId)) return jsonOk(NO_LOGO)

  try {
    const head = await headObject(key)
    if (!head.size || head.size > MAX_BYTES) return jsonOk(NO_LOGO)

    const bytes = await getObject(key)
    const format = rasterFormat(bytes)
    if (!format) return jsonOk(NO_LOGO)

    const response = NextResponse.json({
      dataUrl: `data:${format === 'PNG' ? 'image/png' : 'image/jpeg'};base64,${bytes.toString('base64')}`,
      format,
    })
    // Private to this browser and short-lived: a logo changes rarely, and a
    // stale one for ten minutes is better than re-streaming it per document.
    response.headers.set('Cache-Control', 'private, max-age=600')
    response.headers.set('Vary', 'Cookie')
    return response
  } catch (err) {
    console.error('[letterhead] could not read the logo', err)
    return jsonOk(NO_LOGO)
  }
}

export const GET = withErrorHandler(handleGET)
