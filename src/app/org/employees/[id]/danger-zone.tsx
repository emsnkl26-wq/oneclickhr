'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { DeleteEmployeeDialog } from '@/components/profile/delete-employee-dialog'

/**
 * Permanent deletion, deliberately QUIET.
 *
 * It used to be a bordered red card with a filled red button — the loudest
 * thing on the page, below a plain grey toggle that did the thing almost
 * everybody actually wants. That is backwards twice: it drew the eye to the one
 * action that is almost never right, and it invited the mis-click it then had to
 * defend against.
 *
 * So it is a line of text with an underlined link, directly under the removal
 * section that is the real answer for a leaver. No panel, no icon, no colour
 * except on the word itself. Nobody arrives here by accident, and anybody
 * looking for it will still find it in the one place it could be.
 *
 * NOTHING about the confirmation is softened to match. `DeleteEmployeeDialog`
 * still requires the person's name to be typed out before the button unlocks —
 * being unobtrusive is about not inviting the click, not about making it
 * cheaper once invited.
 */
export function EmployeeDangerZone({
  employeeId,
  name,
}: {
  employeeId: string
  name: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)

  return (
    <div className="px-1 pb-2">
      <p className="text-[13px] leading-relaxed text-ink-muted">
        If this record should never have existed — a duplicate, or a test account —{' '}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="focus-ring rounded font-medium text-danger underline underline-offset-2 hover:text-danger/80"
        >
          delete it permanently
        </button>
        . That erases their account and everything recorded against them, cannot be undone, and is
        not what you want for somebody who has simply left.
      </p>

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
    </div>
  )
}
