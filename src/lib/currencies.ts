/**
 * Currencies with their symbols, for every picker and label in the app.
 *
 * No directive: client forms and server pages both import it. A static list for
 * the same reason src/lib/geo.ts keeps one. Showing only "INR" or "AED" makes
 * people stop and think; "₹ INR" or "د.إ AED" does not.
 */
import { countryCodeOf } from '@/lib/geo'

export const CURRENCIES: ReadonlyArray<{ code: string; symbol: string; name: string }> = [
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar' },
  { code: 'NZD', symbol: 'NZ$', name: 'New Zealand Dollar' },
  { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham' },
  { code: 'SAR', symbol: '﷼', name: 'Saudi Riyal' },
  { code: 'QAR', symbol: 'QR', name: 'Qatari Riyal' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar' },
  { code: 'ZAR', symbol: 'R', name: 'South African Rand' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen' },
  { code: 'CNY', symbol: '¥', name: 'Chinese Yuan' },
  { code: 'CHF', symbol: 'CHF', name: 'Swiss Franc' },
  { code: 'SEK', symbol: 'kr', name: 'Swedish Krona' },
  { code: 'MXN', symbol: 'MX$', name: 'Mexican Peso' },
  { code: 'BRL', symbol: 'R$', name: 'Brazilian Real' },
  { code: 'PHP', symbol: '₱', name: 'Philippine Peso' },
  { code: 'MYR', symbol: 'RM', name: 'Malaysian Ringgit' },
  { code: 'PKR', symbol: '₨', name: 'Pakistani Rupee' },
  { code: 'BDT', symbol: '৳', name: 'Bangladeshi Taka' },
  { code: 'LKR', symbol: 'Rs', name: 'Sri Lankan Rupee' },
  { code: 'NGN', symbol: '₦', name: 'Nigerian Naira' },
  { code: 'KES', symbol: 'KSh', name: 'Kenyan Shilling' },
]

export const CURRENCY_CODES = CURRENCIES.map((c) => c.code)

/** "₹" for INR; falls back to Intl, then to the code itself. */
export function currencySymbol(code: string | null | undefined): string {
  const upper = (code ?? '').toUpperCase()
  const known = CURRENCIES.find((c) => c.code === upper)
  if (known) return known.symbol
  try {
    const part = new Intl.NumberFormat('en', { style: 'currency', currency: upper })
      .formatToParts(0)
      .find((p) => p.type === 'currency')
    return part?.value ?? upper
  } catch {
    return upper
  }
}

/** "₹ INR — Indian Rupee": what a currency picker shows. */
export function currencyLabel(code: string): string {
  const known = CURRENCIES.find((c) => c.code === code)
  return known ? `${known.symbol}  ${known.code} — ${known.name}` : code
}

/** Options for a `Select`, keeping an unlisted stored value selectable. */
export function currencyOptions(current?: string | null): Array<{ value: string; label: string }> {
  const options = CURRENCIES.map((c) => ({ value: c.code, label: currencyLabel(c.code) }))
  const extra = (current ?? '').toUpperCase()
  if (extra && !CURRENCY_CODES.includes(extra)) {
    options.push({ value: extra, label: `${currencySymbol(extra)}  ${extra}` })
  }
  return options
}

/**
 * The currency a country is usually paid in, for the countries on the geo list.
 * Only a DEFAULT — every place that uses it lets the person pick another, since
 * someone living in India can perfectly well be paid in dollars.
 */
const CURRENCY_BY_COUNTRY: Record<string, string> = {
  US: 'USD', CA: 'CAD', GB: 'GBP', IE: 'EUR', IN: 'INR', AU: 'AUD', NZ: 'NZD',
  DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', SE: 'SEK', AE: 'AED',
  SG: 'SGD', PH: 'PHP', ZA: 'ZAR', MX: 'MXN', BR: 'BRL', JP: 'JPY',
}

/** "INR" for India (code or printed name); null for a country not on the list. */
export function currencyForCountry(stored: string | null | undefined): string | null {
  return CURRENCY_BY_COUNTRY[countryCodeOf(stored)] ?? null
}
