'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { BadgeCheck, Globe, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StatusChip } from '@/components/ui/patterns'
import { apiPatch, ApiClientError } from '@/lib/fetcher'
import { deadlineLabel } from '@/lib/domain'

/**
 * The two levers behind "contact us and we will sort it out" (061): a
 * workspace's seat limit, and its domain-verification deadline.
 *
 * Both sit on the organization's own page rather than in a settings screen of
 * their own, because the question that leads here is always about one customer
 * — "they emailed asking for more seats", "they cannot publish the tag before
 * Monday" — and the answer wants their headcount and their domain in view.
 *
 * `locked` and `daysLeft` are computed on the SERVER and passed in. Deriving
 * them here would mean a second clock and a hydration mismatch on a panel whose
 * whole job is to be exact about a date.
 */
export function WorkspaceLimits({
  tenantId,
  employeeLimit,
  activeEmployees,
  domain,
  domainVerified,
  daysLeft,
  locked,
}: {
  tenantId: string
  employeeLimit: number
  /** Active employee accounts — what the limit is actually measured against. */
  activeEmployees: number
  domain: string | null
  domainVerified: boolean
  daysLeft: number | null
  locked: boolean
}) {
  const router = useRouter()
  const [limit, setLimit] = React.useState(String(employeeLimit))
  const [busy, setBusy] = React.useState<'seats' | 'grace' | 'verify' | null>(null)

  async function send(
    what: 'seats' | 'grace' | 'verify',
    body: Record<string, unknown>,
    done: string
  ) {
    setBusy(what)
    try {
      await apiPatch(`/api/super/tenants/${tenantId}/limits`, body)
      toast.success(done)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'That change could not be saved')
    } finally {
      setBusy(null)
    }
  }

  const parsed = Number.parseInt(limit, 10)
  const limitValid = Number.isInteger(parsed) && parsed >= 0 && parsed <= 100_000
  const limitChanged = limitValid && parsed !== employeeLimit

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="size-4 text-ink-muted" aria-hidden />
            Employee seats
          </CardTitle>
          <CardDescription>
            Every workspace gets 20. Raise it here when an organization asks us for more — they
            cannot change it themselves.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-ink-muted">
            Using{' '}
            <strong className="font-semibold text-ink">
              {activeEmployees} of {employeeLimit}
            </strong>
            . Deactivated people do not hold a seat.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="number"
              min={0}
              max={100000}
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
              aria-label="Employee seat limit"
              className="w-32"
            />
            <Button
              size="sm"
              loading={busy === 'seats'}
              disabled={!limitChanged || busy !== null}
              onClick={() => send('seats', { employeeLimit: parsed }, `Seat limit set to ${parsed}`)}
            >
              Save limit
            </Button>
            {[50, 100, 250].map((preset) => (
              <Button
                key={preset}
                size="sm"
                variant="secondary"
                disabled={busy !== null || preset === employeeLimit}
                onClick={() => {
                  setLimit(String(preset))
                  void send('seats', { employeeLimit: preset }, `Seat limit set to ${preset}`)
                }}
              >
                {preset}
              </Button>
            ))}
          </div>
          {limit.trim() && !limitValid ? (
            <p className="text-[13px] text-danger">Enter a whole number between 0 and 100,000.</p>
          ) : null}
        </CardContent>
      </Card>

      <Card className={locked ? 'border-danger/30' : undefined}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="size-4 text-ink-muted" aria-hidden />
            Company website
          </CardTitle>
          <CardDescription>
            Unverified workspaces are paused three days after signup. Give them more time, or
            confirm it yourself if they proved it to you another way.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-ink">{domain || 'No website claimed'}</span>
            {domainVerified ? (
              <StatusChip status="active" label="Verified" />
            ) : locked ? (
              <StatusChip status="inactive" label="Paused — overdue" tone="danger" />
            ) : (
              <StatusChip
                status="pending"
                label={daysLeft === null ? 'Unverified' : deadlineLabel(daysLeft)}
                tone="warning"
              />
            )}
          </div>

          {domainVerified ? (
            <p className="text-[13px] text-ink-muted">
              Nothing to do — this workspace has proven it owns {domain}.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {[3, 7, 30].map((days) => (
                  <Button
                    key={days}
                    size="sm"
                    variant="secondary"
                    disabled={busy !== null}
                    loading={busy === 'grace'}
                    onClick={() =>
                      send(
                        'grace',
                        { domainGraceDays: days },
                        `They now have ${days} days to verify`
                      )
                    }
                  >
                    +{days} days
                  </Button>
                ))}
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={!domain || busy !== null}
                loading={busy === 'verify'}
                onClick={() =>
                  send('verify', { domainVerified: true }, `${domain} marked as verified`)
                }
              >
                <BadgeCheck />
                Mark verified manually
              </Button>
              <p className="text-[13px] leading-relaxed text-ink-muted">
                Marking it verified reserves {domain || 'that website'} for this workspace for good.
                Check it really is their company first — it is what stops a second workspace being
                opened for them, and it refuses if someone else has already proven it.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
