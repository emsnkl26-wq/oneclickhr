/**
 * Countries, their first-level divisions, and how a place is written out.
 *
 * DELIBERATELY FREE OF BOTH DIRECTIVES — no `'use client'`, no `server-only`.
 * Job posting forms are client components and the API handlers validate against
 * the same lists, so both sides have to be able to import this. See the note at
 * the top of src/lib/job-form.ts for what happens when they cannot.
 *
 * A STATIC LIST, ON PURPOSE. A geolocation API would be one more thing to key,
 * rate limit, and be down when somebody is posting a job at 5pm. Twenty
 * countries covers where these workspaces actually hire, and any country
 * without a division list simply falls back to a text box — which is what the
 * whole field was before.
 */

export const COUNTRY_CODES = [
  'US', 'CA', 'GB', 'IE', 'IN', 'AU', 'NZ', 'DE', 'FR', 'ES', 'IT', 'NL', 'SE',
  'AE', 'SG', 'PH', 'ZA', 'MX', 'BR', 'JP',
] as const

const COUNTRY_NAMES: Record<string, string> = {
  US: 'United States', CA: 'Canada', GB: 'United Kingdom', IE: 'Ireland', IN: 'India',
  AU: 'Australia', NZ: 'New Zealand', DE: 'Germany', FR: 'France', ES: 'Spain',
  IT: 'Italy', NL: 'Netherlands', SE: 'Sweden', AE: 'United Arab Emirates',
  SG: 'Singapore', PH: 'Philippines', ZA: 'South Africa', MX: 'Mexico', BR: 'Brazil',
  JP: 'Japan',
}

export function countryName(code: string): string {
  return COUNTRY_NAMES[code] ?? code
}

/**
 * What the first level of a country's address is CALLED there. Drives the field
 * label, so nobody in London is asked for their "state".
 */
const DIVISION_LABELS: Record<string, string> = {
  US: 'State', CA: 'Province', GB: 'Country / region', IE: 'County', IN: 'State',
  AU: 'State / territory', NZ: 'Region', DE: 'State', FR: 'Region', ES: 'Province',
  IT: 'Province', NL: 'Province', SE: 'County', AE: 'Emirate', SG: 'District',
  PH: 'Province', ZA: 'Province', MX: 'State', BR: 'State', JP: 'Prefecture',
}

export function divisionLabel(country: string): string {
  return DIVISION_LABELS[country] ?? 'State / region'
}

/**
 * First-level divisions, for the countries these workspaces hire in most.
 *
 * An absent country is not an error — `divisionsFor` returns an empty list and
 * the form shows a free-text box instead of a dropdown. Adding a country later
 * is one entry here and nothing else.
 */
const DIVISIONS: Record<string, readonly string[]> = {
  US: [
    'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut',
    'Delaware', 'District of Columbia', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois',
    'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts',
    'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada',
    'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota',
    'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina',
    'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington',
    'West Virginia', 'Wisconsin', 'Wyoming', 'Puerto Rico',
  ],
  CA: [
    'Alberta', 'British Columbia', 'Manitoba', 'New Brunswick', 'Newfoundland and Labrador',
    'Northwest Territories', 'Nova Scotia', 'Nunavut', 'Ontario', 'Prince Edward Island',
    'Quebec', 'Saskatchewan', 'Yukon',
  ],
  GB: ['England', 'Scotland', 'Wales', 'Northern Ireland'],
  IE: [
    'Carlow', 'Cavan', 'Clare', 'Cork', 'Donegal', 'Dublin', 'Galway', 'Kerry', 'Kildare',
    'Kilkenny', 'Laois', 'Leitrim', 'Limerick', 'Longford', 'Louth', 'Mayo', 'Meath',
    'Monaghan', 'Offaly', 'Roscommon', 'Sligo', 'Tipperary', 'Waterford', 'Westmeath',
    'Wexford', 'Wicklow',
  ],
  IN: [
    'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat',
    'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh',
    'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab',
    'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh',
    'Uttarakhand', 'West Bengal',
    // Union territories, listed alongside the states because the form asks for
    // one thing and a person in Delhi should not have to wonder which.
    'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu',
    'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
  ],
  AU: [
    'Australian Capital Territory', 'New South Wales', 'Northern Territory', 'Queensland',
    'South Australia', 'Tasmania', 'Victoria', 'Western Australia',
  ],
  NZ: [
    'Auckland', 'Bay of Plenty', 'Canterbury', "Hawke's Bay", 'Gisborne', 'Manawatū-Whanganui',
    'Marlborough', 'Nelson', 'Northland', 'Otago', 'Southland', 'Taranaki', 'Tasman',
    'Waikato', 'Wellington', 'West Coast',
  ],
  DE: [
    'Baden-Württemberg', 'Bayern', 'Berlin', 'Brandenburg', 'Bremen', 'Hamburg', 'Hessen',
    'Mecklenburg-Vorpommern', 'Niedersachsen', 'Nordrhein-Westfalen', 'Rheinland-Pfalz',
    'Saarland', 'Sachsen', 'Sachsen-Anhalt', 'Schleswig-Holstein', 'Thüringen',
  ],
  AE: [
    'Abu Dhabi', 'Ajman', 'Dubai', 'Fujairah', 'Ras Al Khaimah', 'Sharjah', 'Umm Al Quwain',
  ],
  ZA: [
    'Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo', 'Mpumalanga',
    'North West', 'Northern Cape', 'Western Cape',
  ],
}

export function divisionsFor(country: string): readonly string[] {
  return DIVISIONS[country] ?? []
}

export interface LocationParts {
  country?: string | null
  state?: string | null
  city?: string | null
  address?: string | null
}

/**
 * The one-line location a posting displays, e.g. "Bengaluru, Karnataka, India".
 *
 * Kept here rather than in the form because the SERVER writes it: `location` is
 * a derived display column, and letting the browser send its own version would
 * mean two postings with the same parts could read differently. The street
 * address is deliberately left out — it belongs on an offer letter, not on a
 * public job board.
 */
export function formatLocation(parts: LocationParts): string {
  return [parts.city, parts.state, parts.country ? countryName(parts.country) : null]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(', ')
}
