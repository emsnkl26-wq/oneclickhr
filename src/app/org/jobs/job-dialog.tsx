'use client'

import * as React from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Textarea, Select, DateField, Checkbox } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogBody, DialogFooter,
} from '@/components/ui/primitives'
import { apiPost, apiPatch, ApiClientError } from '@/lib/fetcher'
import { JOB_TYPES, JOB_WORKPLACES, SALARY_PERIODS } from '@/lib/schemas'
// The values live in a directive-free module so the two Server Components that
// prepare them can import `toFormValues` without it becoming a client-reference
// proxy. See the header of src/lib/job-form.ts.
import { EMPTY_JOB_FORM as EMPTY, type JobFormValues } from '@/lib/job-form'
import type { JobType, JobWorkplace, SalaryPeriod } from '@/types/db'

export type { JobFormValues }

export interface DepartmentOption {
  id: string
  name: string
}

const TYPE_LABELS: Record<JobType, string> = {
  full_time: 'Full time',
  part_time: 'Part time',
  contract: 'Contract',
  internship: 'Internship',
  temporary: 'Temporary',
}

const WORKPLACE_LABELS: Record<JobWorkplace, string> = {
  onsite: 'On site',
  remote: 'Remote',
  hybrid: 'Hybrid',
}

/**
 * Create or edit a posting. One dialog for both.
 *
 * TWO EXITS, and the split is the important part. `Save draft` stores the role
 * and stops; `Publish now` stores it and puts it on the public internet. Both
 * are labelled for what they do, and only the draft button is the form's
 * `type="submit"` — so pressing Enter in a text field saves, never publishes.
 * Putting a page in front of the world should take a deliberate click on a
 * button that says so.
 *
 * `endpoint` is a prop rather than a constant so the super-admin console can
 * reuse the whole dialog for Oneclickhr's own postings, which go through
 * /api/super/jobs. The two forms ask for exactly the same things.
 */
export function JobDialog({
  open, job, departments = [], endpoint = '/api/org/jobs', isPublished = false, onClose, onSaved,
}: {
  open: boolean
  job?: JobFormValues
  departments?: DepartmentOption[]
  endpoint?: string
  /** True when the job being edited is already live — hides the publish action. */
  isPublished?: boolean
  onClose: () => void
  /** `published` says which button finished the job, so the toast can match. */
  onSaved: (published: boolean) => void
}) {
  const [values, setValues] = React.useState<JobFormValues>(job ?? EMPTY)
  const [skillDraft, setSkillDraft] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [fields, setFields] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)
  const [publishing, setPublishing] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setValues(job ?? EMPTY)
    setSkillDraft('')
    setError(null)
    setFields({})
  }, [open, job])

  /** Nothing to offer when the role is already live. */
  const showPublish = !isPublished

  const set = <K extends keyof JobFormValues>(key: K, value: JobFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }))

  function addSkill() {
    const skill = skillDraft.trim()
    if (!skill) return
    // Case-insensitive, so "React" and "react" do not both end up as chips.
    const exists = values.skills.some((s) => s.toLowerCase() === skill.toLowerCase())
    if (!exists && values.skills.length < 30) {
      set('skills', [...values.skills, skill.slice(0, 40)])
    }
    setSkillDraft('')
  }

  /**
   * Save, and optionally publish in the same gesture.
   *
   * Publishing is TWO requests, deliberately: the save, then a status change.
   * The create endpoint refuses to accept a status at all (`jobSchema` has no
   * such field), so there is no request body that can put a half-written posting
   * onto a public page — the second call is an explicit, separately-authorized
   * act. Two round trips behind one click is a fair price for that.
   *
   * If the publish half fails the draft still exists, so the error says so
   * rather than implying the whole thing was lost.
   */
  async function submit(event: React.FormEvent, publish: boolean) {
    event.preventDefault()
    setError(null)
    setFields({})
    if (publish) setPublishing(true)
    else setSubmitting(true)

    /*
     * Empty strings become undefined, not ''. `optionalNumber` in the schema
     * accepts '' and maps it to null, but `optionalText` would store a blank
     * where the column means "unspecified" — and a job page rendering an empty
     * location line looks broken rather than unspecified.
     */
    const body = {
      title: values.title,
      description: values.description,
      responsibilities: values.responsibilities || undefined,
      requirements: values.requirements || undefined,
      departmentId: values.departmentId || null,
      employmentType: values.employmentType,
      workplace: values.workplace,
      location: values.location || undefined,
      experienceMin: values.experienceMin,
      experienceMax: values.experienceMax,
      salaryMin: values.salaryMin,
      salaryMax: values.salaryMax,
      salaryCurrency: values.salaryCurrency || 'INR',
      salaryPeriod: values.salaryPeriod,
      salaryDisclosed: values.salaryDisclosed,
      openings: values.openings || 1,
      skills: values.skills,
      closesAt: values.closesAt || null,
    }

    try {
      let id = job?.id
      if (id) await apiPatch(`${endpoint}/${id}`, body)
      else id = (await apiPost<{ id: string }>(endpoint, body)).id

      if (publish && id) {
        try {
          await apiPatch(`${endpoint}/${id}`, { status: 'published' })
        } catch (err) {
          // The save SUCCEEDED. Saying "something went wrong" here would send
          // someone back to retype a description that is already stored.
          setError(
            err instanceof ApiClientError
              ? `Saved, but publishing failed: ${err.message}`
              : 'Saved as a draft, but publishing failed. You can publish it from the list.'
          )
          return
        }
      }

      onSaved(publish)
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message)
        setFields(err.fields ?? {})
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setSubmitting(false)
      setPublishing(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="lg">
        <form onSubmit={(e) => submit(e, false)}>
          <DialogHeader>
            <DialogTitle>{job?.id ? 'Edit job' : 'New job'}</DialogTitle>
            <DialogDescription>
              {job?.id
                ? 'Changes go live immediately on published roles.'
                : 'This saves as a draft. You choose when to publish it.'}
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-4">
            <FormError message={error} />

            <FormField label="Job title" error={fields.title} required>
              <Input
                value={values.title}
                onChange={(e) => set('title', e.target.value)}
                placeholder="Senior care coordinator"
                required
              />
            </FormField>

            <FormField
              label="About the role"
              error={fields.description}
              required
              hint="This is the first thing a candidate reads. Line breaks are kept."
            >
              <Textarea
                rows={6}
                value={values.description}
                onChange={(e) => set('description', e.target.value)}
                placeholder="What the role is, who it reports to, and what the team does."
                required
              />
            </FormField>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Responsibilities" error={fields.responsibilities}>
                <Textarea
                  rows={4}
                  value={values.responsibilities}
                  onChange={(e) => set('responsibilities', e.target.value)}
                  placeholder="One per line."
                />
              </FormField>
              <FormField label="Requirements" error={fields.requirements}>
                <Textarea
                  rows={4}
                  value={values.requirements}
                  onChange={(e) => set('requirements', e.target.value)}
                  placeholder="One per line."
                />
              </FormField>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label="Employment type">
                <Select
                  value={values.employmentType}
                  onChange={(e) => set('employmentType', e.target.value as JobType)}
                >
                  {JOB_TYPES.map((type) => (
                    <option key={type} value={type}>{TYPE_LABELS[type]}</option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Workplace">
                <Select
                  value={values.workplace}
                  onChange={(e) => set('workplace', e.target.value as JobWorkplace)}
                >
                  {JOB_WORKPLACES.map((place) => (
                    <option key={place} value={place}>{WORKPLACE_LABELS[place]}</option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Openings" error={fields.openings}>
                <Input
                  type="number"
                  min={1}
                  max={999}
                  value={values.openings}
                  onChange={(e) => set('openings', e.target.value)}
                />
              </FormField>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                label="Location"
                error={fields.location}
                hint="Shown on the posting, even for remote roles."
              >
                <Input
                  value={values.location}
                  onChange={(e) => set('location', e.target.value)}
                  placeholder="Bengaluru, India"
                />
              </FormField>
              {departments.length ? (
                <FormField label="Department" error={fields.departmentId}>
                  <Select
                    value={values.departmentId}
                    onChange={(e) => set('departmentId', e.target.value)}
                    placeholder="No department"
                  >
                    <option value="">No department</option>
                    {departments.map((dept) => (
                      <option key={dept.id} value={dept.id}>{dept.name}</option>
                    ))}
                  </Select>
                </FormField>
              ) : (
                <FormField label="Closing date" error={fields.closesAt} hint="Optional.">
                  <DateField
                    value={values.closesAt}
                    onChange={(e) => set('closesAt', e.target.value)}
                  />
                </FormField>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label="Experience from" error={fields.experienceMin} hint="Years.">
                <Input
                  type="number"
                  min={0}
                  max={60}
                  value={values.experienceMin}
                  onChange={(e) => set('experienceMin', e.target.value)}
                />
              </FormField>
              <FormField label="Experience to" error={fields.experienceMax} hint="Years.">
                <Input
                  type="number"
                  min={0}
                  max={60}
                  value={values.experienceMax}
                  onChange={(e) => set('experienceMax', e.target.value)}
                />
              </FormField>
              {departments.length ? (
                <FormField label="Closing date" error={fields.closesAt} hint="Optional.">
                  <DateField
                    value={values.closesAt}
                    onChange={(e) => set('closesAt', e.target.value)}
                  />
                </FormField>
              ) : null}
            </div>

            <FormField
              label="Skills"
              error={fields.skills}
              hint="Press Enter after each one. These appear as tags on the posting."
            >
              <div className="space-y-2">
                <Input
                  value={skillDraft}
                  onChange={(e) => setSkillDraft(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter adds a skill; it must not submit the whole form.
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault()
                      addSkill()
                    }
                  }}
                  onBlur={addSkill}
                  placeholder="Safeguarding, rota planning, NVQ Level 3"
                />
                {values.skills.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {values.skills.map((skill) => (
                      <span
                        key={skill}
                        className="inline-flex items-center gap-1 rounded-full bg-page px-2.5 py-1 text-xs font-medium text-ink ring-1 ring-inset ring-line"
                      >
                        {skill}
                        <button
                          type="button"
                          aria-label={`Remove ${skill}`}
                          onClick={() =>
                            set('skills', values.skills.filter((s) => s !== skill))
                          }
                          className="text-ink-muted transition hover:text-ink"
                        >
                          <X className="size-3" aria-hidden />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </FormField>

            <div className="rounded-lg border border-line p-4">
              <div className="grid gap-4 sm:grid-cols-4">
                <FormField label="Salary from" error={fields.salaryMin}>
                  <Input
                    type="number"
                    min={0}
                    value={values.salaryMin}
                    onChange={(e) => set('salaryMin', e.target.value)}
                  />
                </FormField>
                <FormField label="Salary to" error={fields.salaryMax}>
                  <Input
                    type="number"
                    min={0}
                    value={values.salaryMax}
                    onChange={(e) => set('salaryMax', e.target.value)}
                  />
                </FormField>
                <FormField label="Currency" error={fields.salaryCurrency}>
                  <Input
                    value={values.salaryCurrency}
                    maxLength={3}
                    onChange={(e) => set('salaryCurrency', e.target.value.toUpperCase())}
                    placeholder="INR"
                  />
                </FormField>
                <FormField label="Per">
                  <Select
                    value={values.salaryPeriod}
                    onChange={(e) => set('salaryPeriod', e.target.value as SalaryPeriod)}
                  >
                    {SALARY_PERIODS.map((period) => (
                      <option key={period} value={period}>{period}</option>
                    ))}
                  </Select>
                </FormField>
              </div>
              <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-sm">
                <Checkbox
                  checked={values.salaryDisclosed}
                  onChange={(e) => set('salaryDisclosed', e.target.checked)}
                />
                <span>
                  Show the salary on the public posting
                  <span className="block text-xs text-ink-muted">
                    Leave this off to keep the range for your own planning only. Postings that
                    show a salary get noticeably more applications.
                  </span>
                </span>
              </label>
            </div>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={showPublish ? 'secondary' : 'default'}
              loading={submitting}
              disabled={publishing}
            >
              {job?.id ? 'Save changes' : 'Save draft'}
            </Button>
            {/*
              * Publishing is offered here so the common case — write a role,
              * put it up — is one dialog rather than "save, close, find the row,
              * press publish". It disappears once the job is already live, where
              * it would be a no-op button next to the one that does the work.
              */}
            {showPublish ? (
              <Button
                type="button"
                loading={publishing}
                disabled={submitting}
                onClick={(e) => submit(e, true)}
              >
                {job?.id ? 'Save & publish' : 'Publish now'}
              </Button>
            ) : null}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
