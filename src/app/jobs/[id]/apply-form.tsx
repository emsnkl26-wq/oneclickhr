'use client'

import * as React from 'react'
import { CheckCircle2, FileText, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import { apiPost, uploadResume, ApiClientError } from '@/lib/fetcher'
import { cn } from '@/lib/utils'

export interface ApplyPrefill {
  fullName: string
  email: string
  phone: string
}

/** Mirrors RESUME_EXTENSIONS on the server. The server is the real gate. */
const ACCEPT = '.pdf,.doc,.docx'
const MAX_BYTES = 10 * 1024 * 1024

/**
 * The application form.
 *
 * Written for someone who is NOT a user of this product and has no reason to
 * persist through friction, which drives three choices:
 *
 *   • Four required fields and nothing else. Everything past the CV is optional,
 *     because a form that demands a notice period before it will accept a
 *     candidate loses candidates.
 *   • The CV uploads AS SOON AS IT IS PICKED, not on submit. It is the slowest
 *     part by an order of magnitude, and doing it while the applicant is still
 *     typing their cover note means submit feels instant. An upload that never
 *     gets submitted is swept nightly, so the cost of being early is nothing.
 *   • Success replaces the form outright. Leaving a filled-in form on screen
 *     after a 201 invites a second submit, which the unique index would answer
 *     with "you have already applied" — technically correct and, to someone who
 *     just applied once, alarming.
 *
 * `prefill` arrives only when a signed-in employee is browsing. The server links
 * the row to their profile from the session either way; these values are a
 * courtesy, not a claim, and they re-parse on the server like anything else.
 */
export function ApplyForm({
  jobId,
  jobTitle,
  prefill,
}: {
  jobId: string
  jobTitle: string
  prefill?: ApplyPrefill
}) {
  const [values, setValues] = React.useState({
    fullName: prefill?.fullName ?? '',
    email: prefill?.email ?? '',
    phone: prefill?.phone ?? '',
    location: '',
    linkedinUrl: '',
    portfolioUrl: '',
    currentCompany: '',
    yearsExperience: '',
    noticePeriod: '',
    coverLetter: '',
    /* The honeypot. Never shown, never filled by a person. */
    website: '',
  })

  const [resume, setResume] = React.useState<{ key: string; fileName: string } | null>(null)
  const [uploading, setUploading] = React.useState(false)
  const [uploadError, setUploadError] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [fields, setFields] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)
  const [done, setDone] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const set = (key: keyof typeof values, value: string) =>
    setValues((current) => ({ ...current, [key]: value }))

  async function onPickFile(file: File | undefined) {
    if (!file) return
    setUploadError(null)

    // A local check purely so a 12MB file fails in a millisecond rather than
    // after a minute of uploading. The server checks the bytes that land.
    if (file.size > MAX_BYTES) {
      setUploadError('Keep your CV under 10MB.')
      return
    }

    setUploading(true)
    try {
      setResume(await uploadResume(file, jobId))
    } catch (err) {
      setUploadError(
        err instanceof ApiClientError ? err.message : 'That upload did not work. Please try again.'
      )
    } finally {
      setUploading(false)
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setFields({})
    setSubmitting(true)

    try {
      await apiPost('/api/jobs/apply', {
        jobId,
        fullName: values.fullName,
        email: values.email,
        phone: values.phone || undefined,
        location: values.location || undefined,
        linkedinUrl: values.linkedinUrl || undefined,
        portfolioUrl: values.portfolioUrl || undefined,
        currentCompany: values.currentCompany || undefined,
        yearsExperience: values.yearsExperience,
        noticePeriod: values.noticePeriod || undefined,
        coverLetter: values.coverLetter || undefined,
        resumeKey: resume?.key || undefined,
        resumeName: resume?.fileName || undefined,
        website: values.website || undefined,
      })
      setDone(true)
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message)
        setFields(err.fields ?? {})
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="card-surface p-8 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-emerald-50 text-emerald-600">
          <CheckCircle2 className="size-6" aria-hidden />
        </span>
        <h2 className="mt-4 text-lg font-semibold text-ink">Application sent</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-muted">
          Your application for <strong className="text-ink">{jobTitle}</strong> is with the hiring
          team. We have emailed a confirmation to {values.email}. They will contact you directly if
          they would like to take it further.
        </p>
        <Button variant="secondary" className="mt-5" asChild>
          <a href="/jobs">Browse more roles</a>
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="card-surface space-y-4 p-5 sm:p-6">
      <div>
        <h2 className="text-base font-semibold text-ink">Apply for this role</h2>
        <p className="mt-1 text-sm text-ink-muted">
          No account needed. Fields marked with an asterisk are required.
        </p>
      </div>

      <FormError message={error} />

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Full name" error={fields.fullName} required>
          <Input
            value={values.fullName}
            onChange={(e) => set('fullName', e.target.value)}
            autoComplete="name"
            required
          />
        </FormField>
        <FormField label="Email" error={fields.email} required>
          <Input
            type="email"
            value={values.email}
            onChange={(e) => set('email', e.target.value)}
            autoComplete="email"
            required
          />
        </FormField>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Phone" error={fields.phone}>
          <Input
            type="tel"
            value={values.phone}
            onChange={(e) => set('phone', e.target.value)}
            autoComplete="tel"
          />
        </FormField>
        <FormField label="Where you are based" error={fields.location}>
          <Input
            value={values.location}
            onChange={(e) => set('location', e.target.value)}
            placeholder="Bengaluru, India"
          />
        </FormField>
      </div>

      <FormField label="CV" error={uploadError ?? fields.resumeKey} hint="PDF or Word, up to 10MB.">
        {resume ? (
          <div className="flex items-center gap-3 rounded-lg border border-line bg-page px-3.5 py-3">
            <FileText className="size-4 shrink-0 text-ink-muted" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-sm text-ink">{resume.fileName}</span>
            <button
              type="button"
              onClick={() => {
                setResume(null)
                if (inputRef.current) inputRef.current.value = ''
              }}
              aria-label="Remove the attached CV"
              className="focus-ring rounded p-1 text-ink-muted transition hover:text-ink"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        ) : (
          <label
            className={cn(
              'flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-line px-4 py-6 text-sm text-ink-muted transition hover:border-brand-600 hover:text-ink',
              uploading && 'pointer-events-none opacity-60'
            )}
          >
            <Upload className="size-4" aria-hidden />
            {uploading ? 'Uploading…' : 'Choose a file'}
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              className="sr-only"
              onChange={(e) => onPickFile(e.target.files?.[0])}
            />
          </label>
        )}
      </FormField>

      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label="Current company" error={fields.currentCompany}>
          <Input
            value={values.currentCompany}
            onChange={(e) => set('currentCompany', e.target.value)}
          />
        </FormField>
        <FormField label="Years of experience" error={fields.yearsExperience}>
          <Input
            type="number"
            min={0}
            max={60}
            step="0.5"
            value={values.yearsExperience}
            onChange={(e) => set('yearsExperience', e.target.value)}
          />
        </FormField>
        <FormField label="Notice period" error={fields.noticePeriod}>
          <Input
            value={values.noticePeriod}
            onChange={(e) => set('noticePeriod', e.target.value)}
            placeholder="30 days"
          />
        </FormField>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="LinkedIn" error={fields.linkedinUrl}>
          <Input
            type="url"
            value={values.linkedinUrl}
            onChange={(e) => set('linkedinUrl', e.target.value)}
            placeholder="https://linkedin.com/in/…"
          />
        </FormField>
        <FormField label="Portfolio or website" error={fields.portfolioUrl}>
          <Input
            type="url"
            value={values.portfolioUrl}
            onChange={(e) => set('portfolioUrl', e.target.value)}
            placeholder="https://…"
          />
        </FormField>
      </div>

      <FormField
        label="Why you are a good fit"
        error={fields.coverLetter}
        hint="Optional, but it is the part hiring teams actually read."
      >
        <Textarea
          rows={5}
          value={values.coverLetter}
          onChange={(e) => set('coverLetter', e.target.value)}
          placeholder="A few sentences about your experience and what draws you to this role."
        />
      </FormField>

      {/*
        * The honeypot.
        *
        * Present in the DOM rather than `display:none` — some bots skip hidden
        * inputs but fill everything else they find. `tabIndex` and `aria-hidden`
        * keep it away from keyboard users and screen readers, and
        * `autoComplete="off"` stops a browser helpfully filling it in for a real
        * person, which would silently discard their application.
        *
        * Hidden by CLIPPING (`sr-only`), not by `left:-9999px`. The off-screen
        * trick relies on the browser not counting negative-left overflow toward
        * the scrollable area — true in LTR, not something to bet a horizontal
        * scrollbar on across every browser and an RTL locale. A 1px clipped box
        * cannot affect layout at all.
        */}
      <div className="sr-only" aria-hidden>
        <label htmlFor="website-hp">Leave this field empty</label>
        <input
          id="website-hp"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={values.website}
          onChange={(e) => set('website', e.target.value)}
        />
      </div>

      {/* Stacks below `sm` — side by side, the sentence squeezed the button to
          two cramped lines on a phone. */}
      <div className="flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <p className="text-xs leading-relaxed text-ink-muted">
          Your details are shared with the hiring organization only.
        </p>
        <Button
          type="submit"
          className="w-full sm:w-auto"
          loading={submitting}
          disabled={uploading}
        >
          Submit application
        </Button>
      </div>
    </form>
  )
}
