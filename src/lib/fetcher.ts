'use client'

/**
 * The client's single way of talking to the API.
 *
 * Every route in this app answers `{ error, fields? }` on failure, so unwrapping
 * that shape belongs in one place rather than in every form. Callers get either
 * data or a thrown `ApiClientError` carrying the message the server wrote for
 * the user — never a raw status code to interpret themselves.
 */

export class ApiClientError extends Error {
  status: number
  fields?: Record<string, string>
  /**
   * The whole error body, for the handful of failures that carry something
   * actionable beyond the message — a 409 from `POST /api/timesheets` returns
   * the id of the week that already exists so the caller can offer to open it
   * instead of stopping at "you already have one".
   */
  payload?: Record<string, unknown>

  constructor(
    message: string,
    status: number,
    fields?: Record<string, string>,
    payload?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'ApiClientError'
    this.status = status
    this.fields = fields
    this.payload = payload
  }
}

async function request<T>(url: string, init: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      ...init,
      headers: { Accept: 'application/json', ...(init.headers ?? {}) },
    })
  } catch {
    throw new ApiClientError('You appear to be offline. Please check your connection.', 0)
  }

  const isJson = res.headers.get('content-type')?.includes('application/json')
  const payload = isJson ? await res.json().catch(() => null) : null

  if (!res.ok) {
    throw new ApiClientError(
      payload?.error || 'Something went wrong. Please try again.',
      res.status,
      payload?.fields,
      payload ?? undefined
    )
  }

  return (payload ?? {}) as T
}

export function apiGet<T>(url: string): Promise<T> {
  return request<T>(url, { method: 'GET' })
}

export function apiPost<T>(url: string, body?: unknown): Promise<T> {
  return request<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export function apiPatch<T>(url: string, body?: unknown): Promise<T> {
  return request<T>(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export function apiDelete<T>(url: string): Promise<T> {
  return request<T>(url, { method: 'DELETE' })
}

/**
 * Two-phase upload: ask for a presigned PUT, send the bytes straight to R2, then
 * finalize so the server validates what actually landed and writes the row.
 *
 * The bytes never pass through a serverless function — a 25MB visa document
 * would otherwise have to be buffered in a lambda that bills by the millisecond
 * and caps request bodies well below that.
 */
export async function uploadFile(
  file: File,
  purpose: 'photo' | 'payslip' | 'employee_doc' | 'work_auth' | 'logo' | 'general',
  extra: Record<string, unknown> = {}
): Promise<{ key: string; fileName: string; contentType: string; documentId?: string }> {
  const presigned = await apiPost<{ url: string; key: string }>('/api/files/presign', {
    fileName: file.name,
    contentType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
    purpose,
  })

  /*
   * Content-Type only. `Content-Length` is a forbidden header name — fetch
   * strips it and sets its own — and the presigned url signs nothing but `host`,
   * so there is no header here that can break the signature.
   *
   * The two failure modes are worth telling apart. A THROW means the request
   * never completed a round trip: almost always the bucket's CORS policy does
   * not list this origin (the preflight is refused, and the browser reports it to
   * script as an opaque network error). A RESPONSE with a bad status means R2
   * answered and declined — an expired signature, usually.
   */
  let put: Response
  try {
    put = await fetch(presigned.url, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    })
  } catch {
    throw new ApiClientError(
      'Could not reach file storage. If this keeps happening the storage bucket ' +
        'is not accepting uploads from this site (CORS).',
      0
    )
  }

  if (!put.ok) {
    console.error('[upload] storage rejected the PUT', put.status, await put.text().catch(() => ''))
    throw new ApiClientError('The upload did not complete. Please try again.', 502)
  }

  const finalized = await apiPost<{ key: string; contentType: string; documentId?: string }>(
    '/api/files/finalize',
    {
      key: presigned.key,
      fileName: file.name,
      contentType: file.type || 'application/octet-stream',
      purpose,
      ...extra,
    }
  )

  return {
    key: finalized.key,
    fileName: file.name,
    contentType: finalized.contentType,
    documentId: finalized.documentId,
  }
}
