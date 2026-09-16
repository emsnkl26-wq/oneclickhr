import { withErrorHandler, jsonOk } from '@/lib/api'
import { apiRequireTenantUser } from '@/lib/auth/guards'
import { publicVapidKey } from '@/lib/push/vapid'

export const dynamic = 'force-dynamic'

/**
 * What the browser needs before it can subscribe: whether push is on, and the
 * application server key to subscribe against.
 *
 * WHY THIS IS A REQUEST RATHER THAN `process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY`
 * READ IN THE COMPONENT. Both are public values, so this is not about secrecy.
 * It is about a STALE one. A `NEXT_PUBLIC_` variable is inlined into the bundle
 * at BUILD time, so rotating the keypair in the hosting dashboard changes what
 * the server signs with immediately and what the browser subscribes with not at
 * all — until something happens to trigger a rebuild. In the gap, every browser
 * mints endpoints against the old key and every push to them is refused with a
 * 403 that looks, from the outside, like push simply not working.
 *
 * Reading it at REQUEST time makes the answer and the signing key the same fact,
 * so a rotation is coherent the moment it is deployed.
 *
 * Behind the session guard even though the key is public, because the shape of
 * the answer ("this deployment has push configured") is operational detail with
 * no reason to be readable by anonymous callers — and because every caller of
 * this endpoint is a signed-in page anyway.
 */
async function handleGET() {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response

  const publicKey = publicVapidKey()

  return jsonOk({
    // `configured` is not merely "the variable is set": vapidConfig() has
    // already refused a malformed or half-configured pair, so a false here means
    // the client should stop rather than ask the user for a permission that
    // could never be used. See the fail-closed note in src/lib/push/vapid.ts.
    configured: !!publicKey,
    publicKey,
  })
}

export const GET = withErrorHandler(handleGET)
