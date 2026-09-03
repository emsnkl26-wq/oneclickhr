import 'server-only'

/**
 * Cloudflare R2 (S3-compatible) object storage.
 *
 * ONE PRIVATE BUCKET. Nothing in it is publicly readable — not payslips, not
 * visa documents, not even org logos. Every read is a presigned GET minted
 * server-side, with a short TTL, only after the calling route has re-verified
 * that this user may see that object.
 *
 * KEY CONVENTION — `<tenant_id>/<uuid>.<ext>`
 * The tenant id prefix is not decoration: it is how a route can cheaply prove an
 * object belongs to the caller's tenant (`keyBelongsToTenant`) before signing
 * anything. The basename is a random UUID, NEVER the client's filename, so
 * nothing attacker-controlled ends up in a storage path.
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomUUID } from 'crypto'

const PUT_TTL_SECONDS = 5 * 60
const DEFAULT_GET_TTL_SECONDS = 15 * 60 // §3 cap: signed URLs live at most 15 min

/**
 * Read one R2 variable, defensively.
 *
 * A dashboard is not a shell. Pasting `R2_ENDPOINT="https://…"` into Vercel
 * stores the QUOTES as part of the value, and a trailing newline survives a copy
 * out of a terminal — neither is visible in the UI afterwards. The SDK then
 * builds `new URL('"https://…')`, throws `TypeError: Invalid URL`, and every
 * presign answers 500 with nothing in the response to say why. Stripping the
 * wrapper here costs nothing and removes a whole class of unexplainable outage.
 */
function envVar(name: string): string {
  return (process.env[name] || '').trim().replace(/^["']|["']$/g, '').trim()
}

export const r2Config = {
  accountId: envVar('R2_ACCOUNT_ID'),
  accessKeyId: envVar('R2_ACCESS_KEY_ID'),
  secretAccessKey: envVar('R2_SECRET_ACCESS_KEY'),
  bucket: envVar('R2_BUCKET'),
  endpoint: envVar('R2_ENDPOINT'),
}

export function isR2Configured(): boolean {
  return !!(
    r2Config.accessKeyId &&
    r2Config.secretAccessKey &&
    r2Config.bucket &&
    (r2Config.endpoint || r2Config.accountId)
  )
}

/**
 * What is wrong with the configuration, in words a person can act on — or null
 * if it is usable. Names VARIABLES, never values: this string is safe to return
 * to an authenticated caller, and a secret must not travel in an error.
 *
 * Every case below is a real misconfiguration that used to surface as a bare
 * 500, which is the least useful thing an upload can do.
 */
export function r2ConfigProblem(): string | null {
  const missing: string[] = [
    ['R2_ACCESS_KEY_ID', r2Config.accessKeyId],
    ['R2_SECRET_ACCESS_KEY', r2Config.secretAccessKey],
    ['R2_BUCKET', r2Config.bucket],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k)

  if (!r2Config.endpoint && !r2Config.accountId) missing.push('R2_ENDPOINT or R2_ACCOUNT_ID')
  if (missing.length) return `File storage is not configured: ${missing.join(', ')} is not set.`

  let url: URL
  try {
    url = new URL(endpointUrl())
  } catch {
    return 'File storage is misconfigured: R2_ENDPOINT is not a valid URL.'
  }
  if (url.protocol !== 'https:') {
    return 'File storage is misconfigured: R2_ENDPOINT must start with https://.'
  }
  /*
   * Cloudflare's bucket page shows the S3 API endpoint WITH the bucket appended.
   * Pasting that whole string, with forcePathStyle, addresses
   * `/<bucket>/<bucket>/<key>` — every upload 404s in a way that looks like a
   * permissions problem. The bucket belongs in R2_BUCKET and nowhere else.
   */
  if (url.pathname.replace(/\/+$/, '')) {
    return (
      'File storage is misconfigured: R2_ENDPOINT must be the bare host ' +
      '(https://<account-id>.r2.cloudflarestorage.com) with no bucket path — ' +
      'the bucket name belongs in R2_BUCKET.'
    )
  }
  return null
}

function endpointUrl(): string {
  if (r2Config.endpoint) return r2Config.endpoint.replace(/\/+$/, '')
  return `https://${r2Config.accountId}.r2.cloudflarestorage.com`
}

let cached: S3Client | null = null

/**
 * The memoized client. Throws a clear error rather than returning a broken
 * client, and is never constructed at module load — importing this file must not
 * fail a build in an environment where R2 is not configured.
 */
export function getR2(): S3Client {
  if (cached) return cached
  const problem = r2ConfigProblem()
  if (problem) throw new Error(`[r2] ${problem}`)
  cached = new S3Client({
    region: 'auto',
    endpoint: endpointUrl(),
    forcePathStyle: true, // R2 addresses buckets in the path, not the host
    /*
     * SDK ≥3.729 computes a CRC32 for every PutObject by default. On a PRESIGNED
     * url that lands in the query string as `x-amz-checksum-crc32=AAAAAA==` — the
     * checksum of an EMPTY body, because at signing time there is no body. Any
     * storage backend that honours it then rejects the browser's real bytes as a
     * checksum mismatch. Nothing here needs SDK-side checksums: finalize re-reads
     * the stored object and validates it for real.
     */
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: {
      accessKeyId: r2Config.accessKeyId,
      secretAccessKey: r2Config.secretAccessKey,
    },
  })
  return cached
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/**
 * `<tenant_id>/<folder>/<uuid>.<ext>` — the only way a key is ever built.
 *
 * The extension is the LEADING run of safe characters, not every safe character
 * that survives a strip. Deleting the bad characters and joining what is left
 * turns `pdf?x=1` into `pdfx1` — harmless, but a nonsense extension that no
 * longer describes the file. Truncating at the first invalid character gives
 * `pdf`, which is both safe and true.
 */
export function buildKey(tenantId: string, folder: string, ext: string): string {
  const cleanExt = (/^[a-z0-9]+/.exec((ext || '').toLowerCase())?.[0] ?? '').slice(0, 8)
  const cleanFolder = (folder || 'files').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32)
  const base = randomUUID()
  return `${tenantId}/${cleanFolder}/${cleanExt ? `${base}.${cleanExt}` : base}`
}

/**
 * Does this key belong to this tenant?
 *
 * Every download route calls this before signing. The `${tenantId}/` prefix test
 * also rejects traversal attempts (`../`) and any absolute-looking key, because
 * a key that does not literally start with the caller's own tenant uuid cannot
 * pass regardless of what else is in it.
 */
export function keyBelongsToTenant(key: string, tenantId: string): boolean {
  if (!key || !tenantId) return false
  if (key.includes('..') || key.startsWith('/')) return false
  return key.startsWith(`${tenantId}/`)
}

export function extensionOf(filename: string): string {
  const dot = (filename || '').lastIndexOf('.')
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : ''
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/**
 * A presigned PUT the browser uploads to directly.
 *
 * NOTHING beyond `host` is signed. Content-Length is deliberately NOT baked into
 * the signature: `Content-Length` is a forbidden header name in fetch, so a
 * browser cannot set it and the value it sends is entirely up to the engine —
 * signing it turns a routine upload into a SignatureDoesNotMatch that no client
 * code can fix. The signature's job is to authorize writing THIS key, once,
 * within five minutes.
 *
 * Size and type are not taken on trust as a result — they never were. Finalize
 * re-HEADs the object for its true size and sniffs its real bytes, because a
 * signature proves intent, not content.
 */
export async function presignPut(key: string, contentType: string): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: r2Config.bucket,
    Key: key,
    ContentType: contentType || 'application/octet-stream',
  })
  return getSignedUrl(getR2(), cmd, { expiresIn: PUT_TTL_SECONDS })
}

/** A short-lived presigned GET. Never call this before an authorization check. */
export async function presignGet(
  key: string,
  ttlSeconds: number = DEFAULT_GET_TTL_SECONDS,
  downloadFilename?: string
): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: r2Config.bucket,
    Key: key,
    ...(downloadFilename
      ? {
          ResponseContentDisposition: `attachment; filename="${sanitizeDispositionName(
            downloadFilename
          )}"`,
        }
      : {}),
  })
  return getSignedUrl(getR2(), cmd, { expiresIn: Math.min(ttlSeconds, DEFAULT_GET_TTL_SECONDS) })
}

export interface HeadResult {
  size: number
  contentType?: string
}

/** The authoritative size and type of a stored object. */
export async function headObject(key: string): Promise<HeadResult> {
  const res = await getR2().send(new HeadObjectCommand({ Bucket: r2Config.bucket, Key: key }))
  return { size: Number(res.ContentLength ?? 0), contentType: res.ContentType }
}

/** Read the first `bytes` of an object — enough to fingerprint it, cheaply. */
export async function getObjectHead(key: string, bytes: number): Promise<Buffer> {
  const res = await getR2().send(
    new GetObjectCommand({
      Bucket: r2Config.bucket,
      Key: key,
      Range: `bytes=0-${Math.max(0, bytes - 1)}`,
    })
  )
  const arr = await (res.Body as unknown as { transformToByteArray(): Promise<Uint8Array> })
    .transformToByteArray()
  return Buffer.from(arr)
}

export async function getObject(key: string): Promise<Buffer> {
  const res = await getR2().send(new GetObjectCommand({ Bucket: r2Config.bucket, Key: key }))
  const arr = await (res.Body as unknown as { transformToByteArray(): Promise<Uint8Array> })
    .transformToByteArray()
  return Buffer.from(arr)
}

export async function putObject(
  key: string,
  body: Buffer | Uint8Array | string,
  contentType: string
): Promise<void> {
  await getR2().send(
    new PutObjectCommand({
      Bucket: r2Config.bucket,
      Key: key,
      Body: typeof body === 'string' ? Buffer.from(body) : body,
      ContentType: contentType || 'application/octet-stream',
    })
  )
}

/** Best-effort delete — used to roll back an upload that failed validation. */
export async function deleteObject(key: string): Promise<void> {
  try {
    await getR2().send(new DeleteObjectCommand({ Bucket: r2Config.bucket, Key: key }))
  } catch (err) {
    console.warn('[r2] delete failed (orphaned object left behind)', key, err)
  }
}

/** Strip anything that would break — or inject into — a Content-Disposition header. */
function sanitizeDispositionName(name: string): string {
  return (name || 'download').replace(/[\r\n"\\]/g, '_').slice(0, 200)
}

export interface ListedObject {
  key: string
  lastModified: Date | null
  size: number
}

/**
 * List objects under a prefix, one page at a time.
 *
 * Added for the orphaned-résumé sweep (/api/cron/jobs-gc), which is the only
 * thing in this product that has to reason about what is in the bucket rather
 * than about a key it already holds. Deliberately paged rather than exhaustive:
 * a sweep that tried to enumerate the whole prefix in one invocation would be
 * the first thing to break when the portal gets busy.
 */
export async function listObjects(
  prefix: string,
  limit = 1000,
  continuationToken?: string
): Promise<{ objects: ListedObject[]; nextToken?: string }> {
  const res = await getR2().send(
    new ListObjectsV2Command({
      Bucket: r2Config.bucket,
      Prefix: prefix,
      MaxKeys: Math.min(Math.max(limit, 1), 1000),
      ContinuationToken: continuationToken,
    })
  )

  return {
    objects: (res.Contents ?? [])
      .filter((item): item is typeof item & { Key: string } => !!item.Key)
      .map((item) => ({
        key: item.Key,
        lastModified: item.LastModified ?? null,
        size: Number(item.Size ?? 0),
      })),
    nextToken: res.IsTruncated ? res.NextContinuationToken : undefined,
  }
}
