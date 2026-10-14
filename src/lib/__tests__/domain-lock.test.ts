import { describe, it, expect } from 'vitest'
import { domainLockState, DOMAIN_VERIFY_DAYS } from '@/lib/domain-lock'

const NOW = Date.parse('2026-10-14T08:00:00.000Z')
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString()
const HOUR = 3_600_000
const DAY = 86_400_000

/**
 * This function decides whether a paying — well, a free — customer can use the
 * product at all, so the cases that matter are the boundaries and the missing
 * data, not the happy path.
 */
describe('domainLockState', () => {
  it('never locks a verified workspace, whatever its deadline says', () => {
    const state = domainLockState({
      domain: 'acme.com',
      domainVerified: true,
      domainVerifyDueAt: at(-30 * DAY),
    })
    expect(state.locked).toBe(false)
    expect(state.pending).toBe(false)
  })

  it('warns, but does not lock, while there is time left', () => {
    const state = domainLockState(
      { domain: 'acme.com', domainVerified: false, domainVerifyDueAt: at(2 * DAY) },
      NOW
    )
    expect(state.locked).toBe(false)
    expect(state.pending).toBe(true)
    expect(state.daysLeft).toBe(2)
  })

  it('locks once the deadline has passed', () => {
    const state = domainLockState(
      { domain: 'acme.com', domainVerified: false, domainVerifyDueAt: at(-1 * HOUR) },
      NOW
    )
    expect(state.locked).toBe(true)
    expect(state.pending).toBe(false)
  })

  /**
   * `daysUntilDeadline` rounds UP, so a deadline forty minutes gone still reads
   * as 0 days. Comparing the rounded day would leave a workspace unlocked for
   * most of the day its time ran out.
   */
  it('locks on the instant, not on the rounded day', () => {
    const justGone = domainLockState(
      { domain: 'acme.com', domainVerified: false, domainVerifyDueAt: at(-40 * 60_000) },
      NOW
    )
    // `Math.ceil` of a small negative is -0, which every comparison in the app
    // treats as 0 (`-0 < 0` is false, `-0 === 0` is true). Asserted this way
    // rather than with `toBe(0)`, which uses Object.is and distinguishes them.
    expect(justGone.daysLeft === 0).toBe(true)
    expect(justGone.locked).toBe(true)

    const almostGone = domainLockState(
      { domain: 'acme.com', domainVerified: false, domainVerifyDueAt: at(40 * 60_000) },
      NOW
    )
    expect(almostGone.daysLeft).toBe(1)
    expect(almostGone.locked).toBe(false)
  })

  /**
   * The failure mode that must never happen: a column that is absent, because
   * a migration has not run, locking every customer out of the product.
   */
  it('never locks a workspace with no deadline recorded', () => {
    expect(
      domainLockState({ domain: 'acme.com', domainVerified: false, domainVerifyDueAt: null }).locked
    ).toBe(false)
    expect(domainLockState(null).locked).toBe(false)
    expect(domainLockState(undefined).locked).toBe(false)
  })

  it('keeps the window it documents', () => {
    expect(DOMAIN_VERIFY_DAYS).toBe(3)
  })
})
