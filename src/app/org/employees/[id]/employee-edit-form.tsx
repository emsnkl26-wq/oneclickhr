'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Select, DateField } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import { Switch } from '@/components/ui/primitives'
import { apiPatch, ApiClientError } from '@/lib/fetcher'

interface EmployeeFormState {
  id: string
  fullName: string
  phone: string
  employeeCode: string
  designation: string
  departmentId: string
  dateOfJoining: string
  timezone: string
  isActive: boolean
}

export function EmployeeEditForm({
  employee, departments,
}: {
  employee: EmployeeFormState
  departments: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [form, setForm] = React.useState(employee)
  const [error, setError] = React.useState<string | null>(null)
  const [fields, setFields] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)

  function set<K extends keyof EmployeeFormState>(key: K, value: EmployeeFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setFields({})
    setSubmitting(true)
    try {
      await apiPatch(`/api/org/employees/${employee.id}`, {
        fullName: form.fullName,
        phone: form.phone || undefined,
        employeeCode: form.employeeCode || undefined,
        designation: form.designation || undefined,
        departmentId: form.departmentId || null,
        dateOfJoining: form.dateOfJoining || null,
        timezone: form.timezone,
        isActive: form.isActive,
      })
      toast.success('Employee updated')
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
    <Card>
      <CardHeader>
        <CardTitle>Details</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <FormError message={error} />

          <FormField label="Full name" error={fields.fullName} required>
            <Input
              value={form.fullName}
              onChange={(e) => set('fullName', e.target.value)}
              required
            />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Phone">
              <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} />
            </FormField>
            <FormField label="Employee code" error={fields.employeeCode}>
              <Input
                value={form.employeeCode}
                onChange={(e) => set('employeeCode', e.target.value)}
              />
            </FormField>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Designation">
              <Input
                value={form.designation}
                onChange={(e) => set('designation', e.target.value)}
              />
            </FormField>
            <FormField label="Department">
              <Select
                value={form.departmentId}
                onChange={(e) => set('departmentId', e.target.value)}
              >
                <option value="">No department</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Date of joining">
              <DateField
                value={form.dateOfJoining}
                onChange={(e) => set('dateOfJoining', e.target.value)}
              />
            </FormField>
            <FormField label="Timezone">
              <Input value={form.timezone} onChange={(e) => set('timezone', e.target.value)} />
            </FormField>
          </div>

          <div className="flex items-start gap-3 rounded-lg bg-page p-3.5">
            <Switch
              id="employee-active"
              checked={form.isActive}
              onCheckedChange={(checked) => set('isActive', checked)}
            />
            <label htmlFor="employee-active" className="cursor-pointer">
              <span className="block text-sm font-medium">Account is active</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">
                Turning this off removes access immediately — on their very next request, not
                whenever their session expires. History is kept.
              </span>
            </label>
          </div>

          <Button type="submit" loading={submitting}>
            Save changes
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
