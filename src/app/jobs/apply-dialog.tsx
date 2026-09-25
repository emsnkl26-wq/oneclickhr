'use client'

/**
 * Apply for one role, from a signed-in account (052).
 *
 * Prefilled from the job seeker's profile — including the CV they saved there,
 * which they can send as-is or swap for a new upload. The email is the
 * account's own and is not editable: it is where every update about this
 * application will go.
 *
 * The CV uploads as soon as it is picked, not on submit, so submitting feels
 * instant; an upload that is never used is swept nightly.
 */

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CheckCircle2, FileText, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter,
} from '@/components/ui/primitives'
import { apiPost, uploadResume, ApiClientError } from '@/lib/fetcher'
import { cn } from '@/lib/utils'
import type { ApplicantPrefill } from '@/lib/job-viewer'

const ACCEPT = '.pdf,.doc,.docx'
const MAX_BYTES = 10 * 1024 * 1024

export function ApplyDialog({
  open, job, prefill, savedResumeName, applicationsPath, onClose, onApplied,
}: {
  open: boolean
  job: { id: string; title: string; companyName: string } | null
  prefill: ApplicantPrefill
  savedResumeName: string | null
  applicationsPath: string
  onClose: () => void
  onApplied: (jobId: string) => void
}) {
  const router = useRouter()
  const [values, setValues] = React.useState(prefill)
  const [coverLetter, setCoverLetter] = React.useState('')
  const [honeypot, setHoneypot] = React.useState('')
  const [useSaved, setUseSaved] = React.useState(!!savedResumeName)
  const [resume, setResume] = React.useState<{ key: string; fileName: string } | null>(null)
  const [uploading, setUploading] = React.useState(false)
  const [uploadError, setUploadError] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [fields, setFields] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)
  const [done, setDone] = React.useState(false)
  const fileRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (!open) return
    setValues(prefill)
    setCoverLetter('')
    setHoneypot('')
    setUseSaved(!!savedResumeName)
    setResume(null)
    setUploadError(null)
    setError(null)
    setFields({})
    setDone(false)
  }, [open, prefill, savedResumeName])

  const set = (key: keyof ApplicantPrefill, value: string) =>
    setValues((current) => ({ ...current, [key]: value }))

  async function onPickFile(file: File | undefined) {
    if (!file || !job) return
    setUploadError(null)
    if (file.size > MAX_BYTES) {
      setUploadError('Keep your CV under 10MB.')
      return
    }
    setUploading(true)
    try {
      setResume(await uploadResume(file, job.id))
      setUseSaved(false)
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
    if (!job) return
    setError(null)
    setFields({})
    setSubmitting(true)
    try {
      await apiPost('/api/jobs/apply', {
        jobId: job.id,
        fullName: values.fullName,
        phone: values.phone || undefined,
        location: values.location || undefined,
        linkedinUrl: values.linkedinUrl || undefined,
        portfolioUrl: values.portfolioUrl || undefined,
        currentCompany: values.currentCompany || undefined,
        yearsExperience: values.yearsExperience,
        noticePeriod: values.noticePeriod || undefined,
        coverLetter: coverLetter || undefined,
        resumeKey: resume?.key || undefined,
        resumeName: resume?.fileName || undefined,
        useSavedResume: !resume && useSaved,
        website: honeypot || undefined,
      })
      setDone(true)
      onApplied(job.id)
      router.refresh()
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

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !submitting && onClose()}>
      <DialogContent size="lg">
        {done ? (
          <div className="px-6 py-10 text-center">
            <span className="mx-auto grid size-12 place-items-center rounded-full bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="size-6" aria-hidden />
            </span>
            <h2 className="mt-4 text-lg font-semibold text-ink">Application sent</h2>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-muted">
              Your application for <strong className="text-ink">{job?.title}</strong> is with{' '}
              {job?.companyName}. We emailed a confirmation to {values.email}, and you can follow its
              progress any time.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <Button variant="secondary" onClick={onClose}>
                Keep browsing
              </Button>
              <Button asChild>
                <Link href={applicationsPath}>Track my applications</Link>
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit}>
            <DialogHeader>
              <DialogTitle>Apply — {job?.title}</DialogTitle>
              <DialogDescription>
                {job?.companyName}. Updates about this application go to {values.email}.
              </DialogDescription>
            </DialogHeader>

            <DialogBody className="space-y-4">
              <FormError message={error} />

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Full name" error={fields.fullName} required>
                  <Input
                    value={values.fullName}
                    onChange={(e) => set('fullName', e.target.value)}
                    autoComplete="name"
                    maxLength={120}
                    required
                  />
                </FormField>
                <FormField label="Email" hint="Your account email.">
                  <Input value={values.email} readOnly disabled />
                </FormField>
                <FormField label="Phone" error={fields.phone}>
                  <Input
                    type="tel"
                    value={values.phone}
                    onChange={(e) => set('phone', e.target.value)}
                    autoComplete="tel"
                    maxLength={40}
                  />
                </FormField>
                <FormField label="Where you are based" error={fields.location}>
                  <Input
                    value={values.location}
                    onChange={(e) => set('location', e.target.value)}
                    maxLength={160}
                  />
                </FormField>
                <FormField label="LinkedIn" error={fields.linkedinUrl}>
                  <Input
                    type="url"
                    value={values.linkedinUrl}
                    onChange={(e) => set('linkedinUrl', e.target.value)}
                    placeholder="https://www.linkedin.com/in/…"
                  />
                </FormField>
                <FormField label="Portfolio or website" error={fields.portfolioUrl}>
                  <Input
                    type="url"
                    value={values.portfolioUrl}
                    onChange={(e) => set('portfolioUrl', e.target.value)}
                    placeholder="https://"
                  />
                </FormField>
                <FormField label="Current company" error={fields.currentCompany}>
                  <Input
                    value={values.currentCompany}
                    onChange={(e) => set('currentCompany', e.target.value)}
                    maxLength={160}
                  />
                </FormField>
                <div className="grid grid-cols-2 gap-4">
                  <FormField label="Years of experience" error={fields.yearsExperience}>
                    <Input
                      type="number"
                      min={0}
                      max={60}
                      step={0.5}
                      value={values.yearsExperience}
                      onChange={(e) => set('yearsExperience', e.target.value)}
                    />
                  </FormField>
                  <FormField label="Notice period" error={fields.noticePeriod}>
                    <Input
                      value={values.noticePeriod}
                      onChange={(e) => set('noticePeriod', e.target.value)}
                      placeholder="2 weeks"
                      maxLength={80}
                    />
                  </FormField>
                </div>
              </div>

              <FormField label="CV" error={fields.resumeKey ?? uploadError ?? undefined}>
                <div className="space-y-2">
                  {savedResumeName && !resume ? (
                    <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-line p-3">
                      <input
                        type="checkbox"
                        checked={useSaved}
                        onChange={(e) => setUseSaved(e.target.checked)}
                        className="size-4 accent-[hsl(var(--brand-600))]"
                      />
                      <FileText className="size-4 shrink-0 text-ink-muted" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-sm">
                        Send my saved CV — <span className="font-medium">{savedResumeName}</span>
                      </span>
                    </label>
                  ) : null}
                  {resume ? (
                    <div className="flex items-center gap-3 rounded-lg border border-line p-3">
                      <FileText className="size-4 shrink-0 text-brand-600" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {resume.fileName}
                      </span>
                      <button
                        type="button"
                        onClick={() => setResume(null)}
                        aria-label="Remove this CV"
                        className="rounded p-1 text-ink-muted hover:bg-page hover:text-ink"
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      disabled={uploading}
                      className={cn(
                        'focus-ring flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line px-3 py-4 text-sm text-ink-muted transition hover:border-brand-600/50 hover:text-ink',
                        uploading && 'opacity-60'
                      )}
                    >
                      <Upload className="size-4" aria-hidden />
                      {uploading
                        ? 'Uploading…'
                        : savedResumeName
                          ? 'Or upload a different CV (PDF or Word, up to 10MB)'
                          : 'Upload your CV (PDF or Word, up to 10MB)'}
                    </button>
                  )}
                  <input
                    ref={fileRef}
                    type="file"
                    accept={ACCEPT}
                    className="sr-only"
                    tabIndex={-1}
                    onChange={(e) => {
                      void onPickFile(e.target.files?.[0])
                      e.target.value = ''
                    }}
                  />
                </div>
              </FormField>

              <FormField label="Cover note" error={fields.coverLetter}>
                <Textarea
                  rows={4}
                  value={coverLetter}
                  onChange={(e) => setCoverLetter(e.target.value)}
                  maxLength={8000}
                  placeholder="Why this role, and anything the hiring team should know."
                />
              </FormField>

              {/* The honeypot: off-screen and unlabelled, never filled by a person. */}
              <div aria-hidden className="absolute -left-[10000px] h-0 w-0 overflow-hidden">
                <label>
                  Website
                  <input
                    tabIndex={-1}
                    autoComplete="off"
                    value={honeypot}
                    onChange={(e) => setHoneypot(e.target.value)}
                  />
                </label>
              </div>
            </DialogBody>

            <DialogFooter>
              <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" loading={submitting} disabled={uploading}>
                Submit application
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
