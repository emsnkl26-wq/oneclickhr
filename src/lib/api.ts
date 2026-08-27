import 'server-only'

/**
 * Route Handler plumbing: one error shape, one validation path, one place where
 * an unexpected throw becomes a 500.
 *
 * The rule about error text: messages that reach a client are written for the
 * person reading them and never echo internals. A Postgres error string can
 * carry table names, column names and constraint definitions — useful in a log,
 * a free schema map for anyone poking at the API.
 */
import { NextResponse } from 'next/server'
import { z, ZodError, type ZodTypeAny } from 'zod'

export class ApiError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function jsonOk<T>(data: T, status = 200) {
  return NextResponse.json(data as Record<string, unknown>, { status })
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

/**
 * Wrap a handler so nothing escapes as an unhandled rejection. ApiError carries
 * its own status; a ZodError becomes a 400 with field-level detail (safe — it
 * describes the request, not the database); anything else is logged in full and
 * answered with a generic 500.
 */
export function withErrorHandler<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>
) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await handler(...args)
    } catch (err) {
      if (err instanceof ApiError) {
        return jsonError(err.message, err.status)
      }
      if (err instanceof ZodError) {
        return NextResponse.json(
          { error: summarizeZodError(err), fields: fieldErrors(err) },
          { status: 400 }
        )
      }
      console.error('[api] unhandled error', err)
      return jsonError('Something went wrong. Please try again.', 500)
    }
  }
}

/**
 * The banner text for a failed validation.
 *
 * `fields` is only useful to a form that renders errors against its inputs, and
 * not every surface can — a grid inside a confirmation dialog has nowhere to put
 * them. When the request failed for exactly one reason, that reason IS the
 * message: "Pick a project or describe the task for this line" tells someone
 * what to do, where "Please check the highlighted fields" sends them looking for
 * a highlight that may not exist. Several reasons at once fall back to the
 * generic line, because concatenating them produces a paragraph nobody reads.
 *
 * Safe to echo: these strings are written in `schemas.ts` and describe the
 * REQUEST, never the database.
 */
export function summarizeZodError(err: ZodError): string {
  const messages = new Set(err.issues.map((issue) => issue.message).filter(Boolean))
  const [only] = Array.from(messages)
  return messages.size === 1 && only ? only : 'Please check the highlighted fields'
}

export function fieldErrors(err: ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_'
    if (!out[key]) out[key] = issue.message
  }
  return out
}

/**
 * Parse a JSON body against a schema. Throws ApiError/ZodError for the wrapper.
 *
 * Generic over the SCHEMA rather than over a single value type, and returns
 * `z.output<S>`. That distinction matters: any schema using `.transform()`,
 * `.default()` or `.optional()` has a different input type from its output type
 * (`z.string().optional().transform(v => v ?? null)` accepts `string |
 * undefined` and produces `string | null`). Typing this as `ZodSchema<T>` pins
 * both sides to the same `T`, which every such schema then fails to satisfy.
 */
export async function parseBody<S extends ZodTypeAny>(
  request: Request,
  schema: S
): Promise<z.output<S>> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    throw new ApiError('Expected a JSON body', 400)
  }
  return schema.parse(raw) as z.output<S>
}

/** Parse query params against a schema (all values arrive as strings). */
export function parseQuery<S extends ZodTypeAny>(request: Request, schema: S): z.output<S> {
  const params = Object.fromEntries(new URL(request.url).searchParams.entries())
  return schema.parse(params) as z.output<S>
}

/**
 * Translate a Postgres/PostgREST error into something a user can act on, without
 * leaking schema details.
 */
export function friendlyDbError(error: { code?: string; message?: string } | null): string {
  if (!error) return 'Something went wrong. Please try again.'
  switch (error.code) {
    case '23505':
      return 'That already exists. Please use a different value.'
    case '23503':
      return 'That record is still referenced elsewhere and cannot be changed.'
    case '23514':
      return 'Some of the values are outside the allowed range.'
    case '42501':
    case 'PGRST301':
      return 'You do not have permission to do that.'
    case 'PGRST116':
      return 'Not found.'
    default:
      console.error('[db]', error.code, error.message)
      return 'Something went wrong. Please try again.'
  }
}

/** A UUID string, or a 400. Use for every id that arrives from a URL or body. */
export const uuidSchema = z.string().uuid('Invalid identifier')

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
})
