import { NextRequest } from 'next/server'
import { withErrorHandler, jsonOk, jsonError } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { rateLimit, limitKey } from '@/lib/rate-limit'
import { extractPayslipFromPdf } from '@/lib/payslip-extract'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/** 10MB, the same ceiling the résumé and payslip uploads use. */
const MAX_BYTES = 10 * 1024 * 1024

/**
 * Read a payslip PDF and hand back what is on it, so the issue dialog can
 * prefill itself (059).
 *
 * THE FILE IS NEVER STORED. It goes nowhere near R2 and nowhere near the
 * database: the admin already has this PDF, and the only thing wanted from it
 * is a form that is already filled in. A stored copy would be a retention
 * question — somebody's full salary history, in a bucket, for no reason — so
 * the bytes are read, parsed, and dropped when the request ends. That is also
 * why this takes the body directly instead of a presigned upload like every
 * other file route in this app: there is no object to presign.
 *
 * NOTHING IS ISSUED HERE. The response is a draft for a human to check. See the
 * box at the top of src/lib/payslip-extract.ts for why that boundary matters.
 *
 * ORG ONLY. Payslip figures are the most sensitive numbers in the product, and
 * an employee has no business parsing one for somebody else — `apiRequireOrg`
 * is what keeps this to administrators.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response

  /*
   * PDF parsing is the most CPU-expensive thing an authenticated user can ask
   * this app to do, so it is limited even behind the org gate.
   *
   * The ceiling is deliberately generous. Payroll is BATCH work — an admin
   * runs a month's payslips in one sitting — so a limit tight enough to be
   * interesting to an attacker would fire on the ordinary use of the feature,
   * which is the worst of both outcomes. 200 an hour is far more than a real
   * payroll run and far less than a way to burn CPU.
   */
  const limited = await rateLimit(
    limitKey('payslip-extract', gate.ctx.tenantId),
    200,
    60 * 60 * 1000
  )
  if (!limited.ok) {
    return jsonError('Too many payslips parsed in the last hour. Please try again later.', 429)
  }

  // Checked before the body is read, so an oversized file is refused without
  // being buffered. A lying header is caught by the length check after.
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (declared > MAX_BYTES) {
    return jsonError('Keep the payslip PDF under 10MB.', 413)
  }

  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await request.arrayBuffer())
  } catch {
    return jsonError('That upload did not arrive in one piece. Please try again.', 400)
  }

  if (bytes.byteLength === 0) return jsonError('No file was uploaded.', 400)
  if (bytes.byteLength > MAX_BYTES) return jsonError('Keep the payslip PDF under 10MB.', 413)

  const result = await extractPayslipFromPdf(bytes)
  if (!result.ok) {
    // A 422 rather than a 400: the request was well formed, the FILE was not
    // something we can read, and the message says which case it was.
    return jsonError(result.message, 422)
  }

  /*
   * NOT AUDITED. The audit log is a record of things that CHANGED, and this
   * changed nothing — no row was written and no file was kept. Issuing the
   * payslip that follows is audited, which is the act that matters.
   */
  return jsonOk({ extracted: result.data })
}

export const POST = withErrorHandler(handlePOST)
