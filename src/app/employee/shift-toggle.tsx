'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { LogIn, LogOut } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { StatusChip } from '@/components/ui/patterns'
import { apiPost, ApiClientError } from '@/lib/fetcher'
import { formatLocal } from '@/lib/time'
import { formatHours, cn } from '@/lib/utils'

interface ShiftState {
  clockedIn: boolean
  loginTime: string | null
  logoutTime: string | null
  totalHours: number | null
  isLate: boolean
}

/**
 * The shift on/off toggle — clock in, clock out.
 *
 * The elapsed counter ticks locally for feedback, but the recorded hours come
 * entirely from the server (it timestamps both ends and computes the difference).
 * A browser clock that is wrong, or a tab left open overnight, cannot influence
 * what lands in the attendance record.
 */
export function ShiftToggle({
  initialState, timezone, shiftStart,
}: {
  initialState: ShiftState
  timezone: string
  shiftStart: string
}) {
  const router = useRouter()
  const [state, setState] = React.useState(initialState)
  const [busy, setBusy] = React.useState(false)
  const [elapsed, setElapsed] = React.useState('')

  React.useEffect(() => setState(initialState), [initialState])

  // Live elapsed time while the shift is open.
  React.useEffect(() => {
    if (!state.clockedIn || !state.loginTime) {
      setElapsed('')
      return
    }
    const tick = () => {
      const ms = Date.now() - new Date(state.loginTime!).getTime()
      const hours = Math.floor(ms / 3_600_000)
      const minutes = Math.floor((ms % 3_600_000) / 60_000)
      const seconds = Math.floor((ms % 60_000) / 1000)
      setElapsed(
        `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(
          seconds
        ).padStart(2, '0')}`
      )
    }
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [state.clockedIn, state.loginTime])

  async function toggle() {
    setBusy(true)
    const action = state.clockedIn ? 'out' : 'in'
    try {
      const result = await apiPost<{
        clockedIn: boolean
        loginTime?: string
        isLate?: boolean
        totalHours?: number
      }>('/api/employee/clock', { action })

      if (action === 'in') {
        setState({
          clockedIn: true,
          loginTime: result.loginTime ?? new Date().toISOString(),
          logoutTime: null,
          totalHours: null,
          isLate: !!result.isLate,
        })
        toast.success(result.isLate ? 'Clocked in — marked as late' : 'Clocked in')
      } else {
        setState((prev) => ({
          ...prev,
          clockedIn: false,
          logoutTime: new Date().toISOString(),
          totalHours: result.totalHours ?? null,
        }))
        toast.success(`Clocked out — ${formatHours(result.totalHours ?? 0)} recorded`)
      }
      router.refresh()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Something went wrong')
      // The server is the source of truth about shift state; re-sync rather than
      // guessing what happened.
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  const finished = !state.clockedIn && !!state.logoutTime

  return (
    <div
      className={cn(
        'card-surface flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between',
        state.clockedIn && 'border-brand-200 bg-brand-50/40'
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[13px] font-medium text-ink-muted">
            {state.clockedIn ? 'Shift in progress' : finished ? 'Shift complete' : 'Not clocked in'}
          </p>
          {state.isLate ? <StatusChip status="late" label="Late" /> : null}
        </div>

        {state.clockedIn ? (
          <>
            <p className="tabular mt-2 text-[34px] font-bold leading-none tracking-[-0.03em] text-brand-ink">
              {elapsed || '00:00:00'}
            </p>
            <p className="tabular mt-2 text-[13px] text-ink-muted">
              Started at {formatLocal(state.loginTime!, timezone, 'HH:mm')}
            </p>
          </>
        ) : finished ? (
          <>
            <p className="tabular mt-2 text-[34px] font-bold leading-none tracking-[-0.03em]">
              {formatHours(state.totalHours)}
            </p>
            <p className="tabular mt-2 text-[13px] text-ink-muted">
              {formatLocal(state.loginTime!, timezone, 'HH:mm')} –{' '}
              {formatLocal(state.logoutTime!, timezone, 'HH:mm')}
            </p>
          </>
        ) : (
          <>
            <p className="mt-2 text-[22px] font-bold leading-tight tracking-[-0.02em]">
              Ready when you are
            </p>
            <p className="mt-1.5 text-[13px] text-ink-muted">
              Your shift starts at {shiftStart} ({timezone}).
            </p>
          </>
        )}
      </div>

      <Button
        size="lg"
        variant={state.clockedIn ? 'danger' : 'default'}
        loading={busy}
        disabled={finished}
        onClick={toggle}
        className="shrink-0 sm:min-w-[170px]"
      >
        {state.clockedIn ? <LogOut /> : <LogIn />}
        {state.clockedIn ? 'Clock out' : finished ? 'Done for today' : 'Clock in'}
      </Button>
    </div>
  )
}
