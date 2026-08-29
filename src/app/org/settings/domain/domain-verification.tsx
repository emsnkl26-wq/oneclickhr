'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import {
  BadgeCheck, Check, Copy, Globe, Pencil, Sparkles, Server,
} from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import { apiPatch, apiPost, ApiClientError } from '@/lib/fetcher'
import { formatLocal } from '@/lib/time'
import {
  metaTagFor, txtRecordFor, aiPromptFor, normalizeDomain,
} from '@/lib/domain'

/**
 * The whole verification experience, in one component because it is one task:
 * see the snippet, put it on the site, press the button.
 *
 * Three states, and only one of them is ever on screen:
 *   • no domain  → the address form
 *   • claimed    → the snippet + the check
 *   • verified   → a receipt, and a way to change it
 *
 * The AI prompt sits ABOVE the manual steps on purpose. Handing the tag to
 * whatever assistant already has the site open is the fastest route for most
 * people now, and the manual steps stay right underneath for everyone else —
 * neither is hidden behind a toggle.
 */
export function DomainVerification({
  domain, token, verifiedAt, method, timezone,
}: {
  domain: string | null
  token: string
  verifiedAt: string | null
  method: 'meta' | 'dns' | null
  timezone: string
}) {
  const router = useRouter()
  const [editing, setEditing] = React.useState(!domain)

  if (verifiedAt && domain && !editing) {
    return (
      <VerifiedCard
        domain={domain}
        verifiedAt={verifiedAt}
        method={method}
        timezone={timezone}
        onChange={() => setEditing(true)}
      />
    )
  }

  if (editing || !domain) {
    return (
      <DomainForm
        current={domain}
        onCancel={domain ? () => setEditing(false) : undefined}
        onSaved={() => {
          setEditing(false)
          router.refresh()
        }}
      />
    )
  }

  return (
    <PublishAndCheck domain={domain} token={token} onEdit={() => setEditing(true)} />
  )
}

/* ------------------------------------------------------------------- states */

function VerifiedCard({
  domain, verifiedAt, method, timezone, onChange,
}: {
  domain: string
  verifiedAt: string
  method: 'meta' | 'dns' | null
  timezone: string
  onChange: () => void
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-600">
            <BadgeCheck className="size-5" aria-hidden />
          </span>
          <div>
            <p className="text-[15px] font-semibold text-ink">{domain} is verified</p>
            <p className="mt-0.5 text-[13px] text-ink-muted">
              Confirmed on {formatLocal(verifiedAt, timezone, 'd MMM yyyy')}
              {method === 'dns' ? ' by DNS record' : ' by meta tag'}. This website is now reserved
              for your workspace — nobody else can verify it.
            </p>
            <p className="mt-2 text-xs text-ink-muted">
              You can leave the tag on your site. Removing it will not un-verify you.
            </p>
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={onChange} className="self-start sm:self-auto">
          <Pencil />
          Change website
        </Button>
      </CardContent>
    </Card>
  )
}

function DomainForm({
  current, onSaved, onCancel,
}: {
  current: string | null
  onSaved: () => void
  onCancel?: () => void
}) {
  const [value, setValue] = React.useState(current ?? '')
  const [error, setError] = React.useState<string | null>(null)
  const [fieldError, setFieldError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  // Shown live under the field so `https://www.Acme.com/careers` visibly becomes
  // the `acme.com` we will actually go and check.
  const preview = normalizeDomain(value)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setFieldError(null)
    setSaving(true)
    try {
      await apiPatch('/api/org/domain', { domain: value })
      toast.success('Website saved')
      onSaved()
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFieldError(err.fields?.domain ?? null)
        if (!err.fields?.domain) setError(err.message)
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="size-4 text-ink-muted" aria-hidden />
          {current ? 'Change your company website' : 'Your company website'}
        </CardTitle>
        <CardDescription>
          {current
            ? 'Changing this clears your verification — you will need to confirm the new address.'
            : 'The address your customers visit. You will confirm it in the next step.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="max-w-md space-y-4">
          <FormError message={error} />
          <FormField
            label="Website"
            error={fieldError}
            hint={
              preview && preview !== value.trim().toLowerCase()
                ? `We will check ${preview}`
                : undefined
            }
            required
          >
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="acme.com"
              inputMode="url"
              autoComplete="url"
              autoFocus
              required
            />
          </FormField>
          <div className="flex items-center gap-2">
            <Button type="submit" loading={saving}>
              {current ? 'Save and re-verify' : 'Continue'}
            </Button>
            {onCancel ? (
              <Button type="button" variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function PublishAndCheck({
  domain, token, onEdit,
}: {
  domain: string
  token: string
  onEdit: () => void
}) {
  const router = useRouter()
  const [checking, setChecking] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const tag = metaTagFor(token)
  const prompt = aiPromptFor(domain, token)

  async function verify() {
    setError(null)
    setChecking(true)
    try {
      await apiPost('/api/org/domain/verify')
      toast.success(`${domain} verified`)
      router.refresh()
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'We could not check your website just now. Please try again.'
      )
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <Globe className="size-4 text-ink-muted" aria-hidden />
            Add this tag to {domain}
          </CardTitle>
          <CardDescription>
            One line, in the <code className="rounded bg-page px-1 py-0.5 text-[12px]">&lt;head&gt;</code>{' '}
            of your homepage. It is invisible to visitors.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          <CopyBlock label="Verification tag" value={tag} />

          {/* The fast path first. */}
          <section className="rounded-xl border border-line bg-page/60 p-4">
            <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink">
              <Sparkles className="size-4 text-brand-600" aria-hidden />
              Fastest: hand this to your AI assistant
            </h3>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
              Copy the prompt below and paste it into Claude Code, Cursor, Lovable, or whichever
              tool builds your site. It contains the tag and where it goes.
            </p>
            <CopyBlock label="Prompt" value={prompt} multiline className="mt-3" />
          </section>

          {/* And the path for everyone else, not hidden behind a toggle. */}
          <section>
            <h3 className="text-[13px] font-semibold text-ink">Or add it yourself</h3>
            <ol className="mt-2.5 space-y-2 text-[13px] leading-relaxed text-ink-muted">
              <Step n={1}>
                Open your website’s homepage code, or your site builder’s{' '}
                <strong className="font-medium text-ink">custom head code</strong> setting. In
                WordPress, Wix, Webflow, Squarespace and Framer it is under Settings → SEO or
                Custom&nbsp;code.
              </Step>
              <Step n={2}>
                Paste the tag inside{' '}
                <code className="rounded bg-page px-1 py-0.5 text-[12px]">&lt;head&gt;</code>,
                anywhere between it and{' '}
                <code className="rounded bg-page px-1 py-0.5 text-[12px]">&lt;/head&gt;</code>.
              </Step>
              <Step n={3}>
                Publish or deploy, then open{' '}
                <a
                  href={`https://${domain}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-medium text-brand-600 hover:underline"
                >
                  {domain}
                </a>{' '}
                to check the change is live.
              </Step>
              <Step n={4}>Come back here and press Verify.</Step>
            </ol>
          </section>

          <div className="border-t border-line pt-5">
            {error ? <FormError message={error} /> : null}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button onClick={verify} loading={checking} size="lg">
                {checking ? <>Checking {domain}…</> : <>Verify {domain}</>}
              </Button>
              <Button variant="ghost" onClick={onEdit} disabled={checking}>
                <Pencil />
                Wrong website?
              </Button>
            </div>
            <p className="mt-3 text-xs text-ink-muted">
              We fetch your homepage over HTTPS and look for the tag — nothing else. Everything in
              your workspace keeps working while this is pending.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Secondary route, for orgs whose marketing site they cannot edit. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-[14px]">
            <Server className="size-4 text-ink-muted" aria-hidden />
            Can’t edit your website? Use DNS instead
          </CardTitle>
          <CardDescription>
            Add this as a <strong className="font-medium text-ink">TXT</strong> record on{' '}
            {domain} (or on <code className="text-[12px]">_oneclickhr.{domain}</code>), then press
            Verify above. DNS changes can take a few minutes to spread. This is also the route to
            use if your site has no HTTPS — we will not read a verification tag over plain HTTP,
            because anyone on the network could have put it there.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CopyBlock label="TXT record value" value={txtRecordFor(token)} />
        </CardContent>
      </Card>
    </div>
  )
}

/* ------------------------------------------------------------------ pieces */

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="mt-px grid size-5 shrink-0 place-items-center rounded-full bg-ink/5 text-[11px] font-semibold text-ink">
        {n}
      </span>
      <span className="min-w-0">{children}</span>
    </li>
  )
}

/**
 * A snippet with a copy button.
 *
 * The value is the whole point of this screen, so it is selectable text in a
 * scrollable block rather than a truncated line — someone on a phone with no
 * clipboard permission still has to be able to read every character of the
 * token, and `break-all` on a 32-character hex string is what makes that work.
 */
function CopyBlock({
  label, value, multiline, className,
}: {
  label: string
  value: string
  multiline?: boolean
  className?: string
}) {
  const [copied, setCopied] = React.useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can be refused (insecure context, permission policy).
      // The text is on screen and selectable, so say so instead of failing mute.
      toast.error('Copy is blocked in this browser — select the text and copy it manually.')
    }
  }

  return (
    <div className={className}>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
          {label}
        </span>
        <Button type="button" variant="secondary" size="sm" onClick={copy}>
          {copied ? <Check className="text-emerald-600" /> : <Copy />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre
        className={`scrollbar-thin overflow-x-auto rounded-lg border border-line bg-ink/[0.03] px-3.5 py-3 text-[12.5px] leading-relaxed text-ink ${
          multiline ? 'max-h-64 overflow-y-auto whitespace-pre-wrap' : 'whitespace-pre-wrap break-all'
        }`}
      >
        <code>{value}</code>
      </pre>
    </div>
  )
}

