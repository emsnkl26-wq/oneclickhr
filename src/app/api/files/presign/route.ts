import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError } from '@/lib/api'
import { apiRequireTenantUser } from '@/lib/auth/guards'
import { presignSchema } from '@/lib/schemas'
import { buildKey, extensionOf, presignPut, r2ConfigProblem } from '@/lib/r2'
/*
 * The POLICY module, deliberately — not `@/lib/upload`. Presigning needs the
 * size and type rules and nothing else; importing the validation pipeline would
 * load DOMPurify/jsdom into this function at cold start, and a failure there
 * kills the route before `withErrorHandler` can turn it into a JSON error.
 */
import { checkPresignClaims } from '@/lib/upload-policy'
import { rateLimit, limitKey } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * Which purposes an employee may upload for. Everything else is org-only.
 *
 * `employee_doc` and `work_auth` joined the list with self-service onboarding
 * (014): the résumé, the ID proof and the visa copy are the employee's own
 * paperwork, and asking them to email it to an admin who then uploads it is the
 * chore that flow exists to remove. It widens what an employee may STORE, not
 * what they may READ — `documents_insert` still pins `owner_id` to them and
 * `documents_select` still shows an employee only their own rows.
 */
const EMPLOYEE_PURPOSES = new Set(['photo', 'general', 'employee_doc', 'work_auth'])

const FOLDERS: Record<string, string> = {
  photo: 'photos',
  logo: 'branding',
  payslip: 'payslips',
  employee_doc: 'documents',
  work_auth: 'work-auth',
  general: 'files',
}

/**
 * Phase one of an upload: hand back a short-lived presigned PUT.
 *
 * The KEY IS BUILT HERE, on the server, from the caller's own tenant id. The
 * client never proposes a path, so it cannot write into another tenant's prefix
 * or overwrite an existing object — the basename is a fresh UUID every time.
 *
 * The claim checks below are a courtesy (fail fast, before a 25MB upload), not
 * the security boundary. That is `/api/files/finalize`, which inspects the bytes
 * that actually arrived.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  /*
   * A configuration fault is a 503 that SAYS WHAT IS WRONG, not a 500. Only
   * variable names travel — never a value — so this is safe to show to the org
   * admin who is the one person able to fix it.
   */
  const problem = r2ConfigProblem()
  if (problem) {
    console.error('[presign] R2 configuration:', problem)
    return jsonError(problem, 503)
  }

  const limited = await rateLimit(limitKey('presign', ctx.userId), 60, 10 * 60 * 1000)
  if (!limited.ok) return jsonError('Too many uploads. Please wait a moment.', 429)

  const input = await parseBody(request, presignSchema)

  if (ctx.role !== 'org' && !EMPLOYEE_PURPOSES.has(input.purpose)) {
    return jsonError('You do not have permission to upload this kind of file.', 403)
  }

  const ext = extensionOf(input.fileName)
  const claims = checkPresignClaims(input.purpose, input.contentType, input.sizeBytes, ext)
  if (!claims.ok) return jsonError(claims.error, 400)

  const key = buildKey(ctx.tenantId, FOLDERS[input.purpose] ?? 'files', ext)

  /*
   * Signing is pure local computation, so a throw here means the SDK could not
   * even build the request — a malformed endpoint or credential, nothing the
   * user did. Answering 503 with the error's TYPE keeps the cause visible in the
   * browser (where this failure is actually noticed) while the full error goes
   * to the server log. A bare 500 tells the person on the page nothing at all.
   */
  let url: string
  try {
    url = await presignPut(key, input.contentType)
  } catch (err) {
    console.error('[presign] could not sign an upload url', err)
    return jsonError(
      `File storage rejected the request (${(err as Error).name || 'error'}). ` +
        'Check the R2 credentials and endpoint for this deployment.',
      503
    )
  }

  return jsonOk({ url, key })
}

export const POST = withErrorHandler(handlePOST)
