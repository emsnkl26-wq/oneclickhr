import { timingSafeEqual } from 'node:crypto'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { withErrorHandler, parseBody, jsonOk, jsonError } from '@/lib/api'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

/**
 * Ingest a contact enquiry from the public marketing site (oneclickhr-landing).
 *
 * This is a SERVER-TO-SERVER endpoint: the landing site's own `/api/contact`
 * route forwards here, so there is no browser and no session. It is guarded by a
 * shared secret (`ENQUIRY_INGEST_SECRET`) rather than auth — the caller has no
 * user — and writes through the service-role client, because `contact_enquiries`
 * is a platform table only super admins read (065). The enquiry then shows up in
 * the super console at /super/enquiries.
 */
const enquirySchema = z.object({
  name: z.string().trim().min(1).max(160),
  email: z.string().trim().email().max(254),
  company: z.string().trim().min(1).max(200),
  teamSize: z.string().trim().max(60).optional().nullable(),
  enquiry: z.string().trim().max(160).optional().nullable(),
  message: z.string().trim().min(1).max(5000),
})

/** Constant-time compare; lengths are checked first because timingSafeEqual throws on a mismatch. */
function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

async function handlePOST(request: NextRequest) {
  // Fails closed: an unset secret, a missing header and a wrong header all get
  // the same 401, so an unconfigured server never accepts writes and the
  // response does not reveal which case it was.
  const secret = process.env.ENQUIRY_INGEST_SECRET
  if (!secret) {
    console.error('[enquiries] ENQUIRY_INGEST_SECRET is not set; refusing ingest')
    return jsonError('Not authorized.', 401)
  }
  const provided = request.headers.get('x-enquiry-secret')
  if (!provided || !secretsMatch(provided, secret)) {
    return jsonError('Not authorized.', 401)
  }

  const input = await parseBody(request, enquirySchema)

  const forwarded = request.headers.get('x-forwarded-for')
  const ip = forwarded ? forwarded.split(',')[0]!.trim() : request.headers.get('x-real-ip')

  const admin = createAdminClient()
  const { error } = await admin.from('contact_enquiries').insert({
    name: input.name,
    email: input.email,
    company: input.company,
    team_size: input.teamSize ?? null,
    enquiry: input.enquiry ?? null,
    message: input.message,
    source: 'landing',
    ip: ip || null,
    user_agent: request.headers.get('user-agent')?.slice(0, 500) ?? null,
  })

  if (error) {
    console.error('[enquiries] insert failed', error)
    return jsonError('Could not record the enquiry.', 500)
  }

  return jsonOk({ ok: true }, 201)
}

export const POST = withErrorHandler(handlePOST)
