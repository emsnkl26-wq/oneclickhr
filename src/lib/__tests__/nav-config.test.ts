import { describe, it, expect } from 'vitest'
import { navFor } from '@/components/shell/nav-config'

/**
 * The sidebar, and the regression these tests exist to prevent.
 *
 * Tracking mode (025) narrows an employee's nav: somebody on timesheets is not
 * shown Attendance, and somebody who clocks in is not shown Timesheets. The
 * first cut of that treated an UNSET mode as `clock_in`, which removed
 * Timesheets and Sheet from every employee in every workspace on the day it
 * shipped — before a single organization had configured anything.
 *
 * So the first test here is the important one: nothing is taken away until
 * somebody deliberately takes it away.
 */

const hrefs = (mode?: 'clock_in' | 'timesheet' | 'none' | null) =>
  navFor('employee', mode === undefined ? {} : { trackingMode: mode }).flatMap((section) =>
    section.items.map((item) => item.href)
  )

describe('employee sidebar', () => {
  it('takes NOTHING away when no mode has been set', () => {
    const links = hrefs(null)
    expect(links).toContain('/employee/timesheets')
    expect(links).toContain('/employee/sheet')
    expect(links).toContain('/employee/attendance')
  })

  it('takes nothing away when the option is absent entirely', () => {
    // A caller that has not been updated must not silently restrict anybody.
    expect(hrefs()).toEqual(hrefs(null))
  })

  it('hides timesheets from somebody who clocks in', () => {
    const links = hrefs('clock_in')
    expect(links).toContain('/employee/attendance')
    expect(links).not.toContain('/employee/timesheets')
    expect(links).not.toContain('/employee/sheet')
  })

  it('hides attendance from somebody on timesheets', () => {
    const links = hrefs('timesheet')
    expect(links).toContain('/employee/timesheets')
    expect(links).not.toContain('/employee/attendance')
  })

  it('hides both when neither applies', () => {
    const links = hrefs('none')
    expect(links).not.toContain('/employee/attendance')
    expect(links).not.toContain('/employee/timesheets')
  })

  it('never touches anything outside time tracking', () => {
    for (const mode of ['clock_in', 'timesheet', 'none', null] as const) {
      const links = hrefs(mode)
      expect(links).toContain('/employee')
      expect(links).toContain('/employee/profile')
      expect(links).toContain('/employee/leaves')
      expect(links).toContain('/employee/payroll')
      expect(links).toContain('/employee/notifications')
    }
  })

  it('leaves the org and platform sidebars alone whatever the mode', () => {
    // Tracking mode is an employee concept; it must not reach the other portals.
    const org = navFor('org', { trackingMode: 'timesheet' })
    expect(org.flatMap((s) => s.items.map((i) => i.href))).toContain('/org/timesheets')
    expect(navFor('super_admin', { trackingMode: 'none' })).toEqual(navFor('super_admin'))
  })
})
