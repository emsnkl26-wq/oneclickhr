'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { UserCheck, UserMinus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/primitives'
import { apiDelete, apiPost, ApiClientError } from '@/lib/fetcher'

/**
 * Whether this person still works here.
 *
 * IT USED TO BE A SWITCH ON THE EDIT FORM, between "Job portal access" and
 * "Save changes", and that was wrong in two ways at once. It read as one more
 * preference among a dozen, so the single most consequential thing on the page
 * looked like the least; and because the form submitted it with everything
 * else, saving a corrected phone number re-asserted access as a side effect.
 *
 * So it is its own section, at the foot of the page where the decisions that
 * are not routine live, and it acts IMMEDIATELY on its own confirmation rather
 * than on a shared Save button — there is no draft state in which somebody is
 * half removed.
 *
 * THE COPY IS THE FEATURE. "Account is active" described a column. What an
 * administrator actually needs to know before clicking is what the person loses
 * (the portal, now), what the organization loses (nothing — every record is
 * kept), and that it can be undone. All three are said in full, both ways
 * round, so the reversibility is as plain as the consequence.
 */
export function AccountAccess({
  employeeId,
  name,
  isActive,
}: {
  employeeId: string
  name: string | null
  isActive: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  const who = name?.trim() || 'this employee'

  async function apply() {
    setBusy(true)
    try {
      if (isActive) {
        await apiDelete(`/api/org/employees/${employeeId}`)
        toast.success(`${who} has left the organization`)
      } else {
        await apiPost(`/api/org/employees/${employeeId}`)
        toast.success(`${who} is back on the team`)
      }
      setOpen(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card-surface overflow-hidden">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
        <span
          className={`grid size-10 shrink-0 place-items-center rounded-xl ${
            isActive ? 'bg-page text-ink-muted' : 'bg-amber-50 text-amber-600'
          }`}
        >
          {isActive ? (
            <UserMinus className="size-5" aria-hidden />
          ) : (
            <UserCheck className="size-5" aria-hidden />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold">
            {isActive ? 'Remove from the organization' : 'They have left the organization'}
          </h2>
          {isActive ? (
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-muted">
              Use this when someone leaves. They lose access to the employee portal{' '}
              <strong className="font-medium text-ink">immediately</strong> — on their very next
              request, not whenever their session happens to expire — and they disappear from the
              team list, from the employee count and from every place in the system where a person
              can be picked. <strong className="font-medium text-ink">Nothing is deleted.</strong>{' '}
              Their attendance, leave, timesheets, payslips and documents stay exactly as they are,
              and if they ever rejoin you can bring them back here with all of it intact.
            </p>
          ) : (
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-muted">
              They cannot sign in, and they are hidden everywhere a current employee would appear.
              Everything recorded about them has been kept. Bring them back and they sign in again
              with their existing password, with their whole history where they left it — they will
              take one of your employee places again.
            </p>
          )}
        </div>

        <Button
          variant={isActive ? 'secondary' : 'default'}
          className={isActive ? 'text-danger' : undefined}
          onClick={() => setOpen(true)}
        >
          {isActive ? (
            <>
              <UserMinus />
              Remove from organization
            </>
          ) : (
            <>
              <UserCheck />
              Bring them back
            </>
          )}
        </Button>
      </div>

      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {isActive ? (
                <UserMinus className="size-5 text-danger" />
              ) : (
                <UserCheck className="size-5 text-emerald-600" />
              )}
              {isActive ? `Remove ${who} from the organization?` : `Bring ${who} back?`}
            </DialogTitle>
            <DialogDescription>
              {isActive
                ? 'Their sign-in stops working on their very next request and they disappear from the team. Every record about them is kept, and you can bring them back at any time.'
                : 'They rejoin the team, can sign in again with their existing password, and take one of your employee places.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant={isActive ? 'danger' : 'default'}
              loading={busy}
              onClick={apply}
            >
              {isActive ? 'Remove from organization' : 'Bring them back'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
