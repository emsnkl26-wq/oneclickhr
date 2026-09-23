'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { DeleteEmployeeDialog } from '@/components/profile/delete-employee-dialog'

/**
 * The one irreversible action on an employee, kept at the foot of the page and
 * apart from everything else so it is never clicked on the way to something
 * routine. Deactivation (from the employee list) stays the reversible option.
 */
export function EmployeeDangerZone({ employeeId, name }: { employeeId: string; name: string | null }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)

  return (
    <Card className="border-danger/30">
      <CardHeader>
        <CardTitle className="text-danger">Delete employee</CardTitle>
        <CardDescription>
          Permanently removes their account and everything recorded against them. To keep their
          history, deactivate them from the employee list instead.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="danger" onClick={() => setOpen(true)}>
          <Trash2 />
          Delete employee
        </Button>
      </CardContent>

      <DeleteEmployeeDialog
        open={open}
        onOpenChange={setOpen}
        name={name}
        endpoint={`/api/org/employees/${employeeId}?permanent=true`}
        onDeleted={() => {
          router.push('/org/employees')
          router.refresh()
        }}
      />
    </Card>
  )
}
