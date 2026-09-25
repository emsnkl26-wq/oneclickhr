import 'server-only'

/**
 * The platform's talent directory (053): employees with their work
 * authorization, and job seekers from the portal. Shared by /super/talent and
 * its CSV export so the two always agree on what a filter means.
 *
 * ADMIN CLIENT ONLY, behind requireSuperAdmin(). Every filter value is checked
 * against an allowlist or reduced to safe characters before it reaches a query.
 */
import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

export const TALENT_PER_PAGE = 50

export const VISA_STATES = {
  valid: 'Valid',
  expiring: 'Expiring within 90 days',
  expired: 'Expired',
  not_tracked: 'Status given, no visa tracked',
  unknown: 'Unknown',
} as const
export type VisaState = keyof typeof VISA_STATES

export interface TalentFilters {
  tab: 'employees' | 'candidates'
  q: string
  visa: VisaState | null
  org: string | null
  country: string | null
  active: 'active' | 'inactive' | null
  page: number
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function parseTalentFilters(params: Record<string, string | undefined>): TalentFilters {
  const visa = params.visa && Object.hasOwn(VISA_STATES, params.visa) ? (params.visa as VisaState) : null
  const country = (params.country ?? '').trim().toUpperCase()
  return {
    tab: params.tab === 'candidates' ? 'candidates' : 'employees',
    // PostgREST's `or` is comma-separated; strip what would end a clause.
    q: (params.q ?? '').replace(/[,()*\\%:]/g, ' ').trim().slice(0, 80),
    visa,
    org: params.org && UUID.test(params.org) ? params.org : null,
    country: /^[A-Z]{2}$/.test(country) ? country : null,
    active: params.status === 'active' || params.status === 'inactive' ? params.status : null,
    page: Math.max(1, parseInt(params.page ?? '', 10) || 1),
  }
}

export interface TalentRow {
  id: string
  tenant_id: string
  tenant_name: string
  full_name: string | null
  email: string | null
  phone: string | null
  designation: string | null
  employee_code: string | null
  is_active: boolean
  date_of_joining: string | null
  city: string | null
  state_province: string | null
  country: string | null
  employment_type: string | null
  skills: unknown
  onboarding_work_auth_status: string | null
  onboarding_visa_type: string | null
  visa_type: string | null
  visa_start_date: string | null
  visa_expiry_date: string | null
  visa_days_left: number | null
  visa_state: VisaState
  latest_role_title: string | null
  latest_company: string | null
}

export const TALENT_COLUMNS =
  'id, tenant_id, tenant_name, full_name, email, phone, designation, employee_code, is_active, ' +
  'date_of_joining, city, state_province, country, employment_type, skills, ' +
  'onboarding_work_auth_status, onboarding_visa_type, visa_type, visa_start_date, visa_expiry_date, ' +
  'visa_days_left, visa_state, latest_role_title, latest_company'

export async function loadTalentDirectory(
  admin: Admin,
  filters: TalentFilters,
  opts: { limit?: number; offset?: number } = {}
): Promise<{ rows: TalentRow[]; total: number }> {
  const limit = opts.limit ?? TALENT_PER_PAGE
  const offset = opts.offset ?? (filters.page - 1) * TALENT_PER_PAGE

  let query = admin
    .from('super_talent_directory')
    .select(TALENT_COLUMNS, { count: 'exact' })
    .order('full_name', { ascending: true, nullsFirst: false })
    .range(offset, offset + limit - 1)

  if (filters.q) {
    const t = filters.q
    query = query.or(
      `full_name.ilike.%${t}%,email.ilike.%${t}%,designation.ilike.%${t}%,latest_role_title.ilike.%${t}%,visa_type.ilike.%${t}%,onboarding_work_auth_status.ilike.%${t}%`
    )
  }
  if (filters.visa) query = query.eq('visa_state', filters.visa)
  if (filters.org) query = query.eq('tenant_id', filters.org)
  if (filters.country) query = query.eq('country', filters.country)
  if (filters.active) query = query.eq('is_active', filters.active === 'active')

  const { data, count, error } = await query
  if (error) {
    console.error('[talent] directory unavailable', error.message)
    return { rows: [], total: 0 }
  }
  return { rows: (data ?? []) as unknown as TalentRow[], total: count ?? 0 }
}

export interface CandidateRow {
  id: string
  full_name: string | null
  email: string | null
  is_active: boolean
  created_at: string
  candidate: {
    headline: string | null
    phone: string | null
    location: string | null
    country: string | null
    work_authorization: string | null
    years_experience: number | string | null
    current_company: string | null
    skills: unknown
    resume_key: string | null
  } | null
  applications: number
}

export async function loadCandidateDirectory(
  admin: Admin,
  filters: TalentFilters,
  opts: { limit?: number; offset?: number } = {}
): Promise<{ rows: CandidateRow[]; total: number }> {
  const limit = opts.limit ?? TALENT_PER_PAGE
  const offset = opts.offset ?? (filters.page - 1) * TALENT_PER_PAGE

  let query = admin
    .from('profiles')
    .select(
      'id, full_name, email, is_active, created_at, ' +
        'candidate:candidate_profiles(headline, phone, location, country, work_authorization, years_experience, current_company, skills, resume_key)',
      { count: 'exact' }
    )
    .eq('role', 'candidate')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (filters.q) {
    query = query.or(`full_name.ilike.%${filters.q}%,email.ilike.%${filters.q}%`)
  }
  if (filters.active) query = query.eq('is_active', filters.active === 'active')

  const { data, count, error } = await query
  if (error) {
    console.error('[talent] candidates unavailable', error.message)
    return { rows: [], total: 0 }
  }

  const rows = (data ?? []) as unknown as Array<Omit<CandidateRow, 'applications'>>
  const ids = rows.map((r) => r.id)
  const counts = new Map<string, number>()
  if (ids.length) {
    const { data: apps } = await admin
      .from('job_applications')
      .select('applicant_profile_id')
      .in('applicant_profile_id', ids)
      .limit(10_000)
    for (const row of (apps ?? []) as Array<{ applicant_profile_id: string }>) {
      counts.set(row.applicant_profile_id, (counts.get(row.applicant_profile_id) ?? 0) + 1)
    }
  }

  // The embed is 1:1 but PostgREST may hand it back as an array.
  return {
    rows: rows.map((row) => ({
      ...row,
      candidate: Array.isArray(row.candidate) ? (row.candidate[0] ?? null) : row.candidate,
      applications: counts.get(row.id) ?? 0,
    })),
    total: count ?? 0,
  }
}

/** `["a","b"]` jsonb, whatever shape it arrived in, as a list of strings. */
export function skillList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').slice(0, 30) : []
}
