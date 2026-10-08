import 'server-only'

/**
 * Resolve the portal's viewer (see src/lib/job-viewer.ts).
 *
 * Every read runs on the CALLER's client, so RLS scopes it: a job seeker reads
 * their own candidate profile and their own applications, an employee their
 * own applications, and nothing here can reach anybody else's.
 */
import { loadContext, homeFor } from '@/lib/auth/context'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { JobViewer } from '@/lib/job-viewer'
import type { ApplicationStatus } from '@/types/db'

export async function loadJobViewer(): Promise<JobViewer> {
  const ctx = await loadContext()
  if (!ctx || !ctx.isActive) return { kind: 'anonymous' }

  if (ctx.role !== 'candidate' && ctx.role !== 'employee') {
    return { kind: 'staff', home: homeFor(ctx.role) }
  }

  const supabase = await createSupabaseServerClient()
  const [{ data: profile }, { data: applied }] = await Promise.all([
    ctx.role === 'candidate'
      ? supabase
          .from('candidate_profiles')
          .select(
            'phone, location, country, linkedin_url, portfolio_url, current_company, years_experience, notice_period, work_authorization, resume_name, resume_key'
          )
          .eq('id', ctx.userId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('job_applications')
      .select('job_id, status, created_at, updated_at')
      .eq('applicant_profile_id', ctx.userId)
      .limit(1000),
  ])

  const appliedRows = (applied ?? []) as Array<{
    job_id: string
    status: ApplicationStatus
    created_at: string
    updated_at: string | null
  }>

  const p = profile as {
    phone: string | null
    location: string | null
    country: string | null
    linkedin_url: string | null
    portfolio_url: string | null
    current_company: string | null
    years_experience: number | string | null
    notice_period: string | null
    work_authorization: string | null
    resume_name: string | null
    resume_key: string | null
  } | null

  return {
    kind: 'applicant',
    role: ctx.role,
    home: homeFor(ctx.role),
    applicationsPath: ctx.role === 'candidate' ? '/candidate' : '/employee/applications',
    prefill: {
      fullName: ctx.fullName ?? '',
      email: ctx.email,
      phone: p?.phone ?? '',
      location: p?.location ?? '',
      country: p?.country ?? '',
      linkedinUrl: p?.linkedin_url ?? '',
      portfolioUrl: p?.portfolio_url ?? '',
      currentCompany: p?.current_company ?? '',
      yearsExperience: p?.years_experience == null ? '' : String(p.years_experience),
      noticePeriod: p?.notice_period ?? '',
      visaStatus: p?.work_authorization ?? '',
    },
    savedResumeName: p?.resume_key ? (p.resume_name ?? 'Saved CV') : null,
    appliedJobIds: appliedRows.map((row) => row.job_id),
    applications: Object.fromEntries(
      appliedRows.map((row) => [
        row.job_id,
        { status: row.status, appliedAt: row.created_at, updatedAt: row.updated_at ?? row.created_at },
      ])
    ),
  }
}
