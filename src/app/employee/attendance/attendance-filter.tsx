'use client'

import * as React from 'react'
import { useProgressRouter } from '@/lib/use-progress-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FormField } from '@/components/ui/form-field'

export function AttendanceFilter({ from, to }: { from: string; to: string }) {
  const router = useProgressRouter()
  const [start, setStart] = React.useState(from)
  const [end, setEnd] = React.useState(to)

  function apply(event: React.FormEvent) {
    event.preventDefault()
    router.push(`/employee/attendance?from=${start}&to=${end}`)
  }

  return (
    <form onSubmit={apply} className="card-surface flex flex-wrap items-end gap-3 p-4">
      <FormField label="From" className="w-40">
        <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
      </FormField>
      <FormField label="To" className="w-40">
        <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
      </FormField>
      <Button type="submit">Apply</Button>
      <Button
        type="button"
        variant="ghost"
        onClick={() => router.push('/employee/attendance')}
      >
        This month
      </Button>
    </form>
  )
}
