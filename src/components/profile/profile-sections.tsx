'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Trash2, Briefcase, GraduationCap, Tag, X } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Textarea, DateField, Checkbox } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter,
} from '@/components/ui/primitives'
import { apiPost, apiPatch, apiDelete, ApiClientError } from '@/lib/fetcher'
import { formatDateLabel } from '@/lib/time'
import type { EmployeeEducation, EmployeeExperience } from '@/types/db'

/*
 * The three list sections of the profile.
 *
 * They share one shape — a titled card, a list of rows, an "Add" button and a
 * dialog — and one prop that decides everything else: `readOnly`. The org views
 * an employee's profile through the SAME components, so what the reviewer reads
 * is exactly what the employee sees, and there is no second renderer to keep in
 * step. Only the edit affordances disappear.
 */

export type ExperienceItem = Pick<
  EmployeeExperience,
  'id' | 'company_name' | 'role_title' | 'start_date' | 'end_date' | 'is_current' | 'summary'
>

export type EducationItem = Pick<
  EmployeeEducation,
  'id' | 'institution' | 'degree' | 'field_of_study' | 'completion_year'
>

/* ------------------------------------------------------------- Experience */

export function ExperienceSection({
  items,
  readOnly,
}: {
  items: ExperienceItem[]
  readOnly?: boolean
}) {
  const router = useRouter()
  const [editing, setEditing] = React.useState<ExperienceItem | null>(null)
  const [adding, setAdding] = React.useState(false)
  const [removing, setRemoving] = React.useState<ExperienceItem | null>(null)
  const [busy, setBusy] = React.useState(false)

  async function remove() {
    if (!removing) return
    setBusy(true)
    try {
      await apiDelete(`/api/employee/experience/${removing.id}`)
      toast.success('Entry removed')
      setRemoving(null)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>Work experience</CardTitle>
          <CardDescription>Roles held before and alongside this one.</CardDescription>
        </div>
        {readOnly ? null : (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            <Plus />
            Add
          </Button>
        )}
      </CardHeader>

      {items.length === 0 ? (
        <CardContent>
          <p className="text-sm text-ink-muted">
            {readOnly ? 'Nothing recorded yet.' : 'Add the roles you have held so far.'}
          </p>
        </CardContent>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((item) => (
            <li key={item.id} className="flex items-start gap-3 px-5 py-4">
              <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-page text-ink-muted">
                <Briefcase className="size-4" aria-hidden />
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{item.role_title}</p>
                <p className="truncate text-sm text-ink-muted">{item.company_name}</p>
                <p className="tabular mt-0.5 text-xs text-ink-muted">
                  {formatDateLabel(item.start_date)} –{' '}
                  {item.is_current ? 'Present' : formatDateLabel(item.end_date)}
                </p>
                {item.summary ? (
                  <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
                    {item.summary}
                  </p>
                ) : null}
              </div>

              {readOnly ? null : (
                <div className="flex shrink-0 items-center">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Edit ${item.role_title}`}
                    onClick={() => setEditing(item)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove ${item.role_title}`}
                    onClick={() => setRemoving(item)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <ExperienceDialog
        open={adding || !!editing}
        item={editing}
        onClose={() => {
          setAdding(false)
          setEditing(null)
        }}
        onSaved={() => {
          setAdding(false)
          setEditing(null)
          router.refresh()
        }}
      />

      <ConfirmRemove
        open={!!removing}
        title="Remove this role?"
        description={removing ? `${removing.role_title} at ${removing.company_name}` : ''}
        busy={busy}
        onCancel={() => setRemoving(null)}
        onConfirm={remove}
      />
    </Card>
  )
}

function ExperienceDialog({
  open, item, onClose, onSaved,
}: {
  open: boolean
  item: ExperienceItem | null
  onClose: () => void
  onSaved: () => void
}) {
  const [companyName, setCompanyName] = React.useState('')
  const [roleTitle, setRoleTitle] = React.useState('')
  const [startDate, setStartDate] = React.useState('')
  const [endDate, setEndDate] = React.useState('')
  const [isCurrent, setIsCurrent] = React.useState(false)
  const [summary, setSummary] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [fields, setFields] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setCompanyName(item?.company_name ?? '')
    setRoleTitle(item?.role_title ?? '')
    setStartDate(item?.start_date ?? '')
    setEndDate(item?.end_date ?? '')
    setIsCurrent(item?.is_current ?? false)
    setSummary(item?.summary ?? '')
    setError(null)
    setFields({})
  }, [open, item])

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setFields({})
    setSubmitting(true)

    const body = {
      companyName,
      roleTitle,
      startDate: startDate || null,
      endDate: isCurrent ? null : endDate || null,
      isCurrent,
      summary: summary || undefined,
    }

    try {
      if (item) await apiPatch(`/api/employee/experience/${item.id}`, body)
      else await apiPost('/api/employee/experience', body)
      toast.success(item ? 'Role updated' : 'Role added')
      onSaved()
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
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>{item ? 'Edit role' : 'Add a role'}</DialogTitle>
          </DialogHeader>

          <DialogBody className="space-y-4">
            <FormError message={error} />

            <FormField label="Company" error={fields.companyName} required>
              <Input
                value={companyName}
                onChange={(event) => setCompanyName(event.target.value)}
                placeholder="Acme Corporation"
                required
              />
            </FormField>

            <FormField label="Role / title" error={fields.roleTitle} required>
              <Input
                value={roleTitle}
                onChange={(event) => setRoleTitle(event.target.value)}
                placeholder="Senior Data Engineer"
                required
              />
            </FormField>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Start date" error={fields.startDate}>
                <DateField
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                />
              </FormField>
              <FormField label="End date" error={fields.endDate}>
                <DateField
                  value={isCurrent ? '' : endDate}
                  min={startDate || undefined}
                  disabled={isCurrent}
                  onChange={(event) => setEndDate(event.target.value)}
                />
              </FormField>
            </div>

            <label className="flex cursor-pointer items-center gap-2.5 text-sm">
              <Checkbox
                checked={isCurrent}
                onChange={(event) => setIsCurrent(event.target.checked)}
              />
              I still work here
            </label>

            <FormField label="Summary" error={fields.summary}>
              <Textarea
                rows={3}
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                placeholder="What you were responsible for."
              />
            </FormField>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              {item ? 'Save changes' : 'Add role'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* -------------------------------------------------------------- Education */

export function EducationSection({
  items,
  readOnly,
}: {
  items: EducationItem[]
  readOnly?: boolean
}) {
  const router = useRouter()
  const [editing, setEditing] = React.useState<EducationItem | null>(null)
  const [adding, setAdding] = React.useState(false)
  const [removing, setRemoving] = React.useState<EducationItem | null>(null)
  const [busy, setBusy] = React.useState(false)

  async function remove() {
    if (!removing) return
    setBusy(true)
    try {
      await apiDelete(`/api/employee/education/${removing.id}`)
      toast.success('Entry removed')
      setRemoving(null)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>Education</CardTitle>
          <CardDescription>Degrees and qualifications.</CardDescription>
        </div>
        {readOnly ? null : (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            <Plus />
            Add
          </Button>
        )}
      </CardHeader>

      {items.length === 0 ? (
        <CardContent>
          <p className="text-sm text-ink-muted">
            {readOnly ? 'Nothing recorded yet.' : 'Add where you studied.'}
          </p>
        </CardContent>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((item) => (
            <li key={item.id} className="flex items-start gap-3 px-5 py-4">
              <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-page text-ink-muted">
                <GraduationCap className="size-4" aria-hidden />
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{item.degree}</p>
                <p className="truncate text-sm text-ink-muted">{item.institution}</p>
                <p className="tabular mt-0.5 text-xs text-ink-muted">
                  {item.field_of_study ? `${item.field_of_study} · ` : ''}
                  {item.completion_year ?? 'Year not set'}
                </p>
              </div>

              {readOnly ? null : (
                <div className="flex shrink-0 items-center">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Edit ${item.degree}`}
                    onClick={() => setEditing(item)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove ${item.degree}`}
                    onClick={() => setRemoving(item)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <EducationDialog
        open={adding || !!editing}
        item={editing}
        onClose={() => {
          setAdding(false)
          setEditing(null)
        }}
        onSaved={() => {
          setAdding(false)
          setEditing(null)
          router.refresh()
        }}
      />

      <ConfirmRemove
        open={!!removing}
        title="Remove this qualification?"
        description={removing ? `${removing.degree} — ${removing.institution}` : ''}
        busy={busy}
        onCancel={() => setRemoving(null)}
        onConfirm={remove}
      />
    </Card>
  )
}

function EducationDialog({
  open, item, onClose, onSaved,
}: {
  open: boolean
  item: EducationItem | null
  onClose: () => void
  onSaved: () => void
}) {
  const [institution, setInstitution] = React.useState('')
  const [degree, setDegree] = React.useState('')
  const [fieldOfStudy, setFieldOfStudy] = React.useState('')
  const [completionYear, setCompletionYear] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [fields, setFields] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setInstitution(item?.institution ?? '')
    setDegree(item?.degree ?? '')
    setFieldOfStudy(item?.field_of_study ?? '')
    setCompletionYear(item?.completion_year ? String(item.completion_year) : '')
    setError(null)
    setFields({})
  }, [open, item])

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setFields({})
    setSubmitting(true)

    const body = {
      institution,
      degree,
      fieldOfStudy: fieldOfStudy || undefined,
      completionYear: completionYear ? Number(completionYear) : null,
    }

    try {
      if (item) await apiPatch(`/api/employee/education/${item.id}`, body)
      else await apiPost('/api/employee/education', body)
      toast.success(item ? 'Qualification updated' : 'Qualification added')
      onSaved()
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
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>{item ? 'Edit qualification' : 'Add a qualification'}</DialogTitle>
          </DialogHeader>

          <DialogBody className="space-y-4">
            <FormError message={error} />

            <FormField label="Institution" error={fields.institution} required>
              <Input
                value={institution}
                onChange={(event) => setInstitution(event.target.value)}
                placeholder="University of Hyderabad"
                required
              />
            </FormField>

            <FormField label="Degree" error={fields.degree} required>
              <Input
                value={degree}
                onChange={(event) => setDegree(event.target.value)}
                placeholder="B.Tech"
                required
              />
            </FormField>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Field of study" error={fields.fieldOfStudy}>
                <Input
                  value={fieldOfStudy}
                  onChange={(event) => setFieldOfStudy(event.target.value)}
                  placeholder="Computer Science"
                />
              </FormField>
              <FormField label="Year of completion" error={fields.completionYear}>
                <Input
                  value={completionYear}
                  onChange={(event) =>
                    setCompletionYear(event.target.value.replace(/[^0-9]/g, '').slice(0, 4))
                  }
                  inputMode="numeric"
                  placeholder="2021"
                />
              </FormField>
            </div>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              {item ? 'Save changes' : 'Add qualification'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ----------------------------------------------------------------- Skills */

/**
 * Tag input.
 *
 * Saved on every add and remove rather than behind a Save button: a tag editor
 * that needs confirming is the one people leave half-finished, and the whole set
 * is one small array so each write is cheap. The server deduplicates
 * case-insensitively, so the list here only has to avoid the obvious repeat.
 */
export function SkillsSection({
  skills: initial,
  readOnly,
}: {
  skills: string[]
  readOnly?: boolean
}) {
  const [skills, setSkills] = React.useState<string[]>(initial)
  const [draft, setDraft] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  async function persist(next: string[]) {
    const previous = skills
    setSkills(next)
    setBusy(true)
    try {
      const result = await apiPatch<{ skills: string[] }>('/api/employee/skills', { skills: next })
      // Adopt the server's list: it deduplicated and trimmed, and disagreeing
      // with it would leave the pills out of step with what was stored.
      if (Array.isArray(result?.skills)) setSkills(result.skills)
    } catch (err) {
      setSkills(previous)
      toast.error(err instanceof ApiClientError ? err.message : 'Could not save your skills')
    } finally {
      setBusy(false)
    }
  }

  function add() {
    const value = draft.trim()
    if (!value) return
    if (skills.some((skill) => skill.toLowerCase() === value.toLowerCase())) {
      setDraft('')
      return
    }
    setDraft('')
    void persist([...skills, value])
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Skills</CardTitle>
        <CardDescription>
          {readOnly ? 'What this person has listed.' : 'Add the tools and techniques you work with.'}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {skills.length === 0 ? (
          <p className="text-sm text-ink-muted">
            {readOnly ? 'No skills listed.' : 'No skills added yet.'}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {skills.map((skill) => (
              <span
                key={skill}
                className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 py-1 pl-3 pr-1.5 text-[13px] font-medium text-brand-700 ring-1 ring-inset ring-brand-200"
              >
                {skill}
                {readOnly ? (
                  <span className="pr-1.5" />
                ) : (
                  <button
                    type="button"
                    aria-label={`Remove ${skill}`}
                    disabled={busy}
                    onClick={() => persist(skills.filter((current) => current !== skill))}
                    className="focus-ring grid size-5 place-items-center rounded-full transition hover:bg-brand-100 disabled:opacity-50"
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}

        {readOnly ? null : (
          <div className="flex items-center gap-2">
            <Input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                // Enter and comma both commit — people type skill lists either way.
                if (event.key === 'Enter' || event.key === ',') {
                  event.preventDefault()
                  add()
                }
              }}
              placeholder="Python, SQL, Airflow…"
              aria-label="Add a skill"
              disabled={busy}
            />
            <Button type="button" variant="secondary" onClick={add} disabled={busy || !draft.trim()}>
              <Tag />
              Add
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/* ---------------------------------------------------------------- Shared */

function ConfirmRemove({
  open, title, description, busy, onCancel, onConfirm,
}: {
  open: boolean
  title: string
  description: string
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DialogBody className="pb-4">
          <p className="text-sm text-ink-muted">{description}</p>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Keep it
          </Button>
          <Button variant="danger" loading={busy} onClick={onConfirm}>
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
