'use client'

import { Select } from '@/components/ui/input'
import { currencyOptions } from '@/lib/currencies'

/** A currency picker that shows the symbol with every code (₹ INR, $ USD…). */
export function CurrencySelect({
  value,
  onChange,
  className,
  disabled,
  placeholder = 'Currency',
  allowEmpty = false,
}: {
  value: string
  onChange: (code: string) => void
  className?: string
  disabled?: boolean
  placeholder?: string
  allowEmpty?: boolean
}) {
  const options = currencyOptions(value)
  return (
    <Select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className}
      disabled={disabled}
      placeholder={placeholder}
      options={allowEmpty ? [{ value: '', label: placeholder }, ...options] : options}
    />
  )
}
