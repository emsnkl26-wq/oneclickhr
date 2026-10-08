'use client'

import { Select } from '@/components/ui/input'
import { timezoneOptions } from '@/lib/timezones'

/**
 * A timezone picker, grouped by region and labelled with the zone's CURRENT
 * offset (`Kolkata (GMT+5:30)`).
 *
 * The value stored is always the IANA name, never the label — the offset in the
 * label moves with daylight saving and a stored "GMT+1" would be wrong half the
 * year.
 *
 * Whatever is already saved is always among the options, even if it is not on
 * the curated list; see the header of src/lib/timezones.ts for why that matters.
 */
export function TimezoneSelect({
  value,
  onChange,
  className,
  disabled,
  id,
}: {
  value: string
  onChange: (zone: string) => void
  className?: string
  disabled?: boolean
  id?: string
}) {
  return (
    <Select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={className}
      disabled={disabled}
      options={timezoneOptions(value)}
    />
  )
}
