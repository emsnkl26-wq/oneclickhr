'use client'

import * as React from 'react'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Textarea, Select, DateField, Checkbox } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import {
  Avatar, AvatarFallback, AvatarImage,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogBody, DialogFooter,
} from '@/components/ui/primitives'
import { apiPost, apiPatch, ApiClientError } from '@/lib/fetcher'
import { initials } from '@/lib/utils'
import { PROJECT_STATUSES } from '@/lib/schemas'
import type { EmployeeOption } from './project-workspace'
import type { ProjectStatus } from '@/types/db'

export interface ProjectFormValues {
  id?: string
  name: string
  clientName: string
  endClientName: string
  description: string
  startDate: string
  endDate: string
  status: ProjectStatus
  employeeIds: string[]
}

const EMPTY: ProjectFormValues = {
  name: '',
  clientName: '',
  endClientName: '',
  description: '',
  startDate: '',
  endDate: '',
  status: 'active',
  employeeIds: [],
}

/**
 * Create or edit a project. One dialog for both, because they ask for exactly
 * the same things — the only difference is which verb the request uses.
 *
 * The team picker is a filterable checklist rather than a multi-select: an org
 * with a hundred people needs to find three of them, and a list you can type
 * into does that better than a dropdown you have to scroll.
 */
export function ProjectDialog({
  open, employees, project, onClose, onSaved,
}: {
  open: boolean
  employees: EmployeeOption[]
  project?: ProjectFormValues
  onClose: () => void
  onSaved: () => void
}) {
  const [values, setValues] = React.useState<ProjectFormValues>(project ?? EMPTY)
  const [search, setSearch] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [fields, setFields] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)

  // Reset every time the dialog opens, so an edit never inherits the values of
  // whatever was open before it.
  React.useEffect(() => {
    if (!open) return
    setValues(project ?? EMPTY)
    setSearch('')
    setError(null)
    setFields({})
  }, [open, project])

  const set = <K extends keyof ProjectFormValues>(key: K, value: ProjectFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }))

  const toggleMember = (id: string) =>
    setValues((current) => ({
      ...current,
      employeeIds: current.employeeIds.includes(id)
        ? current.employeeIds.filter((memberId) => memberId !== id)
        : [...current.employeeIds, id],
    }))

  const term = search.trim().toLowerCase()
  const visible = term
    ? employees.filter((person) =>
        `${person.full_name ?? ''} ${person.email ?? ''} ${person.designation ?? ''}`
          .toLowerCase()
          .includes(term)
      )
    : employees

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setFields({})
    setSubmitting(true)

    const body = {
      name: values.name,
      clientName: values.clientName || undefined,
      endClientName: values.endClientName || undefined,
      description: values.description || undefined,
      startDate: values.startDate || null,
      endDate: values.endDate || null,
      status: values.status,
      employeeIds: values.employeeIds,
    }

    try {
      if (project?.id) await apiPatch(`/api/org/projects/${project.id}`, body)
      else await apiPost('/api/org/projects', body)
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
      <DialogContent size="lg">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>{project?.id ? 'Edit project' : 'New project'}</DialogTitle>
            <DialogDescription>
              The project ID is assigned automatically once you save.
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-4">
            <FormError message={error} />

            <FormField label="Project name" error={fields.name} required>
              <Input
                value={values.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="Data platform migration"
                required
              />
            </FormField>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                label="Client"
                error={fields.clientName}
                hint="The company the work is billed to."
              >
                <Input
                  value={values.clientName}
                  onChange={(e) => set('clientName', e.target.value)}
                />
              </FormField>
              <FormField
                label="End client"
                error={fields.endClientName}
                hint="Where the employee actually sits, if different."
              >
                <Input
                  value={values.endClientName}
                  onChange={(e) => set('endClientName', e.target.value)}
                />
              </FormField>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label="Start date" error={fields.startDate}>
                <DateField
                  value={values.startDate}
                  onChange={(e) => set('startDate', e.target.value)}
                />
              </FormField>
              <FormField label="End date" error={fields.endDate}>
                <DateField
                  min={values.startDate || undefined}
                  value={values.endDate}
                  onChange={(e) => set('endDate', e.target.value)}
                />
              </FormField>
              <FormField label="Status">
                <Select
                  value={values.status}
                  onChange={(e) => set('status', e.target.value as ProjectStatus)}
                >
                  {PROJECT_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status.charAt(0).toUpperCase() + status.slice(1)}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>

            <FormField label="Notes" error={fields.description}>
              <Textarea
                rows={2}
                value={values.description}
                onChange={(e) => set('description', e.target.value)}
                placeholder="Scope, statement of work reference, anything the team should know."
              />
            </FormField>

            <FormField
              label={`Assigned employees (${values.employeeIds.length})`}
              error={fields.employeeIds}
              hint="Only assigned people can log hours against this project."
            >
              <div className="rounded-lg border border-line">
                <div className="relative border-b border-line">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
                    aria-hidden
                  />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Filter people"
                    aria-label="Filter people"
                    className="h-10 w-full rounded-t-lg bg-transparent pl-9 pr-3 text-sm outline-none placeholder:text-ink-muted/70"
                  />
                </div>
                <div className="scrollbar-thin max-h-56 overflow-y-auto p-1">
                  {visible.length === 0 ? (
                    <p className="px-3 py-6 text-center text-sm text-ink-muted">
                      No one matches that.
                    </p>
                  ) : (
                    visible.map((person) => (
                      <label
                        key={person.id}
                        className="flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 transition hover:bg-page"
                      >
                        <Checkbox
                          checked={values.employeeIds.includes(person.id)}
                          onChange={() => toggleMember(person.id)}
                        />
                        <Avatar className="size-7">
                          {person.photo_url ? (
                            <AvatarImage
                              src={`/api/files/view?key=${encodeURIComponent(person.photo_url)}`}
                              alt=""
                            />
                          ) : null}
                          <AvatarFallback className="text-[10px]">
                            {initials(person.full_name, person.email)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {person.full_name || person.email}
                          </span>
                          <span className="block truncate text-xs text-ink-muted">
                            {person.designation || 'No designation'}
                          </span>
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </div>
            </FormField>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              {project?.id ? 'Save changes' : 'Create project'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
