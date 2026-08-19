import 'server-only'

/**
 * CLIENT #3 of 3 — the service-role client. PRIVILEGED.
 *
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │ service_role BYPASSES RLS ENTIRELY.                                    │
 * │ There is no tenant isolation on anything this client touches unless    │
 * │ YOU write `.eq('tenant_id', tenantId)` into the query yourself, using  │
 * │ a tenant id resolved from the SESSION — never one taken from a request │
 * │ body or query string.                                                  │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Legitimate uses, and only these:
 *   • creating employee auth users (needs the Admin API)
 *   • super-admin cross-tenant reads (deliberately unscoped, gated by
 *     requireSuperAdmin())
 *   • cron jobs, which have no user session at all
 *   • decrypting a stored OAuth token (the column is not even readable by
 *     `authenticated` — see the column grant in 002_rls.sql)
 *
 * `import 'server-only'` makes importing this from a client component a BUILD
 * error, so the key can never reach a browser bundle.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let cached: SupabaseClient | null = null

export function createAdminClient(): SupabaseClient {
  if (cached) return cached

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'Admin client unavailable: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.'
    )
  }

  cached = createClient(url, key, {
    auth: {
      // No session, no refresh, no storage — this client is not a "user".
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { 'x-client-info': 'oneclickhr-ems/admin' },
    },
  })
  return cached
}

/**
 * Assert that a tenant id resolved from the session is present before running an
 * admin-client query. Call this at the top of any privileged tenant-scoped
 * operation so a `undefined` tenant can never silently widen into "all rows".
 */
export function assertTenantScope(tenantId: string | null | undefined): string {
  if (!tenantId || typeof tenantId !== 'string') {
    throw new Error('Refusing to run an admin query without a tenant scope')
  }
  return tenantId
}
