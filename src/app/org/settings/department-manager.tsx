'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, Building2 } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FormError } from '@/components/ui/form-field'
import { apiPost, apiDelete, ApiClientError } from '@/lib/fetcher'

export function DepartmentManager({
  departments,
}: {
  departments: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [name, setName] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  async function onAdd(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await apiPost('/api/org/departments', { name })
      setName('')
      toast.success('Department added')
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  async function onDelete(id: string, label: string) {
    try {
      await apiDelete(`/api/org/departments/${id}`)
      toast.success(`${label} removed`)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Something went wrong')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Departments</CardTitle>
        <CardDescription>
          Used to group employees and to target notifications.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={onAdd} className="flex gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Engineering"
            aria-label="New department name"
            required
          />
          <Button type="submit" loading={submitting} disabled={!name.trim()}>
            <Plus />
            Add
          </Button>
        </form>

        <FormError message={error} />

        {departments.length === 0 ? (
          <div className="flex items-center gap-3 rounded-lg bg-page px-4 py-6 text-sm text-ink-muted">
            <Building2 className="size-5 shrink-0" aria-hidden />
            No departments yet. Employees can still be added without one.
          </div>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {departments.map((department) => (
              <li key={department.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <span className="flex-1 truncate text-sm">{department.name}</span>
                <button
                  type="button"
                  onClick={() => onDelete(department.id, department.name)}
                  aria-label={`Remove ${department.name}`}
                  className="focus-ring rounded p-1 text-ink-muted transition hover:text-danger"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="text-xs leading-relaxed text-ink-muted">
          Removing a department does not remove its people — they simply become unassigned.
        </p>
      </CardContent>
    </Card>
  )
}
