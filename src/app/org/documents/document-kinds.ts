/**
 * The document-kind vocabulary — in its own module, and deliberately NOT in
 * `document-library.tsx`.
 *
 * It used to be exported from that file, which carries `'use client'`. When a
 * Server Component imports from a client module, the bundler replaces every
 * export with a client REFERENCE — a proxy the runtime hands to the browser,
 * not the value itself. So `DOCUMENT_KINDS` arrived at the page looking like an
 * array and threw `DOCUMENT_KINDS.includes is not a function` on first read,
 * taking the whole Documents page down with it.
 *
 * Nothing catches that on the way in: it type-checks, it builds, and it fails
 * only when the page is actually requested. Plain data that both a server page
 * and a client component need therefore lives in a plain module.
 */
export const DOCUMENT_KINDS = ['employee_doc', 'work_auth', 'general'] as const

export type DocumentKind = (typeof DOCUMENT_KINDS)[number]

/** Is this `?kind=` value one we actually filter by? */
export function isDocumentKind(value: string | undefined): value is DocumentKind {
  return !!value && (DOCUMENT_KINDS as readonly string[]).includes(value)
}
