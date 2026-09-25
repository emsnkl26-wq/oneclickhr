'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Download, FileText, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Textarea, Select } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import { apiPatch, uploadResume, ApiClientError } from '@/lib/fetcher'
import { COUNTRY_CODES, countryName } from '@/lib/geo'

export interface CandidateProfileValues {
  fullName: string
  email: string
  headline: string
  phone: string
  location: string
  country: string
  linkedinUrl: string
  portfolioUrl: string
  yearsExperience: string
  currentCompany: string
  noticePeriod: string
  workAuthorization: string
  summary: string
  skills: string[]
  /** Name of the saved CV, or null when there is none. */
  resumeName: string | null
}

const MAX_BYTES = 10 * 1024 * 1024

export function CandidateProfileForm({ initial }: { initial: CandidateProfileValues }) {
  const router = useRouter()
  const [values, setValues] = React.useState(initial)
  const [skillDraft, setSkillDraft] = React.useState('')
  const [newResume, setNewResume] = React.useState<{ key: string; fileName: string } | null>(null)
  const [removeResume, setRemoveResume] = React.useState(false)
  const [uploading, setUploading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [fields, setFields] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)
  const fileRef = React.useRef<HTMLInputElement>(null)

  const set = <K extends keyof CandidateProfileValues>(key: K, value: CandidateProfileValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }))

  function addSkill() {
    const skill = skillDraft.trim().slice(0, 40)
    setSkillDraft('')
    if (!skill || values.skills.length >= 30) return
    if (values.skills.some((s) => s.toLowerCase() === skill.toLowerCase())) return
    set('skills', [...values.skills, skill])
  }

  async function onPickFile(file: File | undefined) {
    if (!file) return
    if (file.size > MAX_BYTES) {
      toast.error('Keep your CV under 10MB.')
      return
    }
    setUploading(true)
    try {
      setNewResume(await uploadResume(file))
      setRemoveResume(false)
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'That upload did not work.')
    } finally {
      setUploading(false)
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setFields({})
    setSaving(true)
    try {
      await apiPatch('/api/candidate/profile', {
        fullName: values.fullName,
        headline: values.headline,
        phone: values.phone,
        location: values.location,
        country: values.country,
        linkedinUrl: values.linkedinUrl,
        portfolioUrl: values.portfolioUrl,
        yearsExperience: values.yearsExperience,
        currentCompany: values.currentCompany,
        noticePeriod: values.noticePeriod,
        workAuthorization: values.workAuthorization,
        summary: values.summary,
        skills: values.skills,
        resumeKey: newResume?.key,
        resumeName: newResume?.fileName,
        removeResume,
      })
      toast.success('Profile saved')
      if (newResume) set('resumeName', newResume.fileName)
      if (removeResume) set('resumeName', null)
      setNewResume(null)
      setRemoveResume(false)
      router.refresh()
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message)
        setFields(err.fields ?? {})
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setSaving(false)
    }
  }

  const shownResume = newResume?.fileName ?? (removeResume ? null : values.resumeName)

  return (
    <form onSubmit={onSubmit} className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Card>
        <CardHeader>
          <CardTitle>About you</CardTitle>
          <CardDescription>Hiring teams see this with every application you send.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormError message={error} />
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Full name" error={fields.fullName} required>
              <Input
                value={values.fullName}
                onChange={(e) => set('fullName', e.target.value)}
                maxLength={120}
                required
              />
            </FormField>
            <FormField label="Email" hint="Your sign-in address.">
              <Input value={values.email} readOnly disabled />
            </FormField>
          </div>
          <FormField label="Headline" error={fields.headline}>
            <Input
              value={values.headline}
              onChange={(e) => set('headline', e.target.value)}
              placeholder="Senior DevOps engineer · AWS, Kubernetes"
              maxLength={160}
            />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Phone" error={fields.phone}>
              <Input
                type="tel"
                value={values.phone}
                onChange={(e) => set('phone', e.target.value)}
                maxLength={40}
              />
            </FormField>
            <FormField label="City / region" error={fields.location}>
              <Input
                value={values.location}
                onChange={(e) => set('location', e.target.value)}
                maxLength={160}
              />
            </FormField>
            <FormField label="Country" error={fields.country}>
              <Select value={values.country} onChange={(e) => set('country', e.target.value)}>
                <option value="">Not set</option>
                {COUNTRY_CODES.map((code) => (
                  <option key={code} value={code}>
                    {countryName(code)}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Work authorization" error={fields.workAuthorization}>
              <Input
                value={values.workAuthorization}
                onChange={(e) => set('workAuthorization', e.target.value)}
                placeholder="US citizen, H-1B, GC…"
                maxLength={80}
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
                  maxLength={80}
                />
              </FormField>
            </div>
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
          </div>
          <FormField label="Summary" error={fields.summary}>
            <Textarea
              rows={5}
              value={values.summary}
              onChange={(e) => set('summary', e.target.value)}
              maxLength={4000}
              placeholder="A few lines on what you do best and what you are looking for."
            />
          </FormField>
          <FormField label="Skills" error={fields.skills} hint="Press Enter after each one.">
            <div className="space-y-2">
              <Input
                value={skillDraft}
                onChange={(e) => setSkillDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault()
                    addSkill()
                  }
                }}
                onBlur={addSkill}
                placeholder="Terraform, Python, AWS"
              />
              {values.skills.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {values.skills.map((skill) => (
                    <span
                      key={skill}
                      className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700"
                    >
                      {skill}
                      <button
                        type="button"
                        aria-label={`Remove ${skill}`}
                        onClick={() => set('skills', values.skills.filter((s) => s !== skill))}
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </FormField>
        </CardContent>
      </Card>

      <div className="space-y-5 lg:sticky lg:top-6">
        <Card>
          <CardHeader>
            <CardTitle>Your CV</CardTitle>
            <CardDescription>Sent with an application when you choose it. PDF or Word, up to 10MB.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {shownResume ? (
              <div className="flex items-center gap-3 rounded-lg border border-line p-3">
                <FileText className="size-4 shrink-0 text-brand-600" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{shownResume}</span>
                {!newResume && values.resumeName ? (
                  <Button asChild size="icon" variant="ghost" aria-label="Download your CV">
                    <a href="/api/candidate/resume">
                      <Download />
                    </a>
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="Remove this CV"
                  onClick={() => {
                    if (newResume) setNewResume(null)
                    else setRemoveResume(true)
                  }}
                >
                  <X />
                </Button>
              </div>
            ) : (
              <p className="text-sm text-ink-muted">No CV saved yet.</p>
            )}
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              loading={uploading}
              onClick={() => fileRef.current?.click()}
            >
              <Upload />
              {shownResume ? 'Replace CV' : 'Upload CV'}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.doc,.docx"
              className="sr-only"
              tabIndex={-1}
              onChange={(e) => {
                void onPickFile(e.target.files?.[0])
                e.target.value = ''
              }}
            />
            {newResume || removeResume ? (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Save your profile to keep this change.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Button type="submit" className="w-full" size="lg" loading={saving} disabled={uploading}>
          Save profile
        </Button>
      </div>
    </form>
  )
}
