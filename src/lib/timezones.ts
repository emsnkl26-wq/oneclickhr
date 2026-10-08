/**
 * The timezones a person can be put in, as a pickable list.
 *
 * DELIBERATELY FREE OF BOTH DIRECTIVES — no `'use client'`, no `server-only`.
 * The employee form is a client component and the API validates the value it
 * sends; both import this. Same reasoning as src/lib/geo.ts.
 *
 * A CURATED LIST, NOT `Intl.supportedValuesOf('timeZone')`. That call returns
 * well over four hundred zones, most of them aliases of each other
 * (`Asia/Calcutta`, `Asia/Kolkata`), which makes a dropdown that is technically
 * complete and practically unusable — and it is not available on every runtime
 * this has to parse on. These are the zones these workspaces actually employ
 * people in, grouped by region so the list can be skimmed rather than read.
 *
 * ANYTHING ALREADY STORED STILL SHOWS. `timezoneOptions` takes the current
 * value and prepends it when it is not on the list, so a zone set before this
 * list existed is never silently replaced by the first option in a dropdown —
 * which is how a picker quietly moves somebody's whole attendance record.
 */

import { isValidTimezone, DEFAULT_TIMEZONE } from '@/lib/time'

interface ZoneGroup {
  region: string
  zones: string[]
}

const ZONE_GROUPS: ZoneGroup[] = [
  {
    region: 'India & South Asia',
    zones: ['Asia/Kolkata', 'Asia/Colombo', 'Asia/Dhaka', 'Asia/Karachi', 'Asia/Kathmandu'],
  },
  {
    region: 'Americas',
    zones: [
      'America/New_York',
      'America/Chicago',
      'America/Denver',
      'America/Phoenix',
      'America/Los_Angeles',
      'America/Anchorage',
      'Pacific/Honolulu',
      'America/Toronto',
      'America/Vancouver',
      'America/Mexico_City',
      'America/Bogota',
      'America/Sao_Paulo',
      // The canonical IANA name. `America/Buenos_Aires` is a deprecated alias
      // that some runtimes no longer resolve.
      'America/Argentina/Buenos_Aires',
    ],
  },
  {
    region: 'Europe & Africa',
    zones: [
      'Europe/London',
      'Europe/Dublin',
      'Europe/Lisbon',
      'Europe/Madrid',
      'Europe/Paris',
      'Europe/Amsterdam',
      'Europe/Brussels',
      'Europe/Berlin',
      'Europe/Zurich',
      'Europe/Rome',
      'Europe/Stockholm',
      'Europe/Warsaw',
      'Europe/Athens',
      'Europe/Bucharest',
      'Europe/Kyiv',
      'Europe/Istanbul',
      'Europe/Moscow',
      'Africa/Casablanca',
      'Africa/Lagos',
      'Africa/Cairo',
      'Africa/Nairobi',
      'Africa/Johannesburg',
    ],
  },
  {
    region: 'Middle East',
    zones: ['Asia/Dubai', 'Asia/Riyadh', 'Asia/Qatar', 'Asia/Jerusalem', 'Asia/Tehran'],
  },
  {
    region: 'Asia Pacific',
    zones: [
      'Asia/Bangkok',
      'Asia/Jakarta',
      'Asia/Singapore',
      'Asia/Kuala_Lumpur',
      'Asia/Manila',
      'Asia/Hong_Kong',
      'Asia/Shanghai',
      'Asia/Taipei',
      'Asia/Seoul',
      'Asia/Tokyo',
      'Australia/Perth',
      'Australia/Adelaide',
      'Australia/Brisbane',
      'Australia/Sydney',
      'Pacific/Auckland',
    ],
  },
  { region: 'Other', zones: ['UTC'] },
]

/** Every zone on the list, flat. */
export const TIMEZONES: readonly string[] = ZONE_GROUPS.flatMap((group) => group.zones)

/**
 * The same list under its original name, for the pickers that predate the
 * grouping — settings, onboarding, the meeting dialogs and the employee's own
 * profile. One list, so adding a zone shows up in every picker at once.
 */
export const COMMON_TIMEZONES: string[] = [...TIMEZONES]

/**
 * `Asia/Kolkata` → `Kolkata (GMT+5:30)`.
 *
 * The offset is computed for RIGHT NOW rather than stored, because half of
 * these observe daylight saving and a hard-coded "GMT-5" is wrong for New York
 * for eight months of the year.
 */
export function timezoneLabel(zone: string): string {
  const city = zone.split('/').pop()?.replace(/_/g, ' ') ?? zone
  const offset = gmtOffset(zone)
  return offset ? `${city} (${offset})` : city
}

/** The current UTC offset of a zone, as `GMT+5:30`. Empty if it cannot be read. */
function gmtOffset(zone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      timeZoneName: 'longOffset',
    }).formatToParts(new Date())
    const name = parts.find((part) => part.type === 'timeZoneName')?.value ?? ''
    // `longOffset` gives `GMT+05:30`; trim the leading zero on the hours so the
    // list reads the way people write it.
    return name.replace(/GMT([+-])0?(\d+)/, 'GMT$1$2').replace(/:00$/, '') || ''
  } catch {
    return ''
  }
}

/**
 * The options for a timezone dropdown, with `current` guaranteed to be among
 * them — see the note at the top about pickers that silently move people.
 */
export function timezoneOptions(
  current: string | null | undefined
): Array<{ value: string; label: string }> {
  const value = (current ?? '').trim()
  const options = ZONE_GROUPS.flatMap((group) =>
    group.zones.map((zone) => ({ value: zone, label: `${group.region} — ${timezoneLabel(zone)}` }))
  )
  if (value && !TIMEZONES.includes(value)) {
    // Shown as-is, not relabelled: an unrecognised zone is still what is stored,
    // and guessing a city for it would be a lie about the data.
    options.unshift({ value, label: isValidTimezone(value) ? timezoneLabel(value) : value })
  }
  return options
}

/** A zone that is on the list, or the workspace default. */
export function safeListedTimezone(zone: string | null | undefined): string {
  const value = (zone ?? '').trim()
  return value && isValidTimezone(value) ? value : DEFAULT_TIMEZONE
}
