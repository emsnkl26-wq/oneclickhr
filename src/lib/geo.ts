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
 * The ISO-2 code for whatever is stored, given that not every column stores a
 * code. Job postings store `US`; company details have always stored the printed
 * name `United States`, because that string goes straight onto a letterhead.
 * Rather than migrate the column and risk a letterhead that reads "US", the
 * picker resolves either spelling on the way in and writes the name on the way
 * out. Returns '' for anything not on the list, which the form treats as "no
 * country chosen" and falls back to a text box.
 */
export function countryCodeOf(stored: string | null | undefined): string {
  const value = (stored ?? '').trim()
  if (!value) return ''
  const upper = value.toUpperCase()
  if (COUNTRY_CODES.includes(upper as (typeof COUNTRY_CODES)[number])) return upper
  const match = COUNTRY_CODES.find((code) => COUNTRY_NAMES[code].toLowerCase() === value.toLowerCase())
  return match ?? ''
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

/**
 * EVERY country, for fields that are not tied to the division lists above
 * (vendor and client addresses). ISO 3166-1 alpha-2 codes; names come from the
 * runtime's own Intl data so the list needs no upkeep. Stored as the printed
 * NAME, like company addresses, because it goes straight onto documents.
 */
const ALL_COUNTRY_CODES = (
  'AF AX AL DZ AS AD AO AI AQ AG AR AM AW AU AT AZ BS BH BD BB BY BE BZ BJ BM BT BO BQ BA BW BV BR IO ' +
  'BN BG BF BI CV KH CM CA KY CF TD CL CN CX CC CO KM CG CD CK CR CI HR CU CW CY CZ DK DJ DM DO EC EG ' +
  'SV GQ ER EE SZ ET FK FO FJ FI FR GF PF TF GA GM GE DE GH GI GR GL GD GP GU GT GG GN GW GY HT HM VA ' +
  'HN HK HU IS IN ID IR IQ IE IM IL IT JM JP JE JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MO ' +
  'MG MW MY MV ML MT MH MQ MR MU YT MX FM MD MC MN ME MS MA MZ MM NA NR NP NL NC NZ NI NE NG NU NF MK ' +
  'MP NO OM PK PW PS PA PG PY PE PH PN PL PT PR QA RE RO RU RW BL SH KN LC MF PM VC WS SM ST SA SN RS ' +
  'SC SL SG SX SK SI SB SO ZA GS SS ES LK SD SR SJ SE CH SY TW TJ TZ TH TL TG TK TO TT TN TR TM TC TV ' +
  'UG UA AE GB US UM UY UZ VU VE VN VG VI WF EH YE ZM ZW XK'
).split(' ')

let allCountryNamesCache: string[] | null = null

/** Every country name, alphabetically. */
export function allCountryNames(): string[] {
  if (allCountryNamesCache) return allCountryNamesCache
  let display: Intl.DisplayNames | null = null
  try {
    display = new Intl.DisplayNames(['en'], { type: 'region' })
  } catch {
    display = null
  }
  const names = ALL_COUNTRY_CODES.map((code) => COUNTRY_NAMES[code] ?? display?.of(code) ?? code)
  allCountryNamesCache = Array.from(new Set(names)).sort((a, b) => a.localeCompare(b))
  return allCountryNamesCache
}
