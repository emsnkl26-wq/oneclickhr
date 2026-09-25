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
            'phone, location, linkedin_url, portfolio_url, current_company, years_experience, notice_period, resume_name, resume_key'
          )
          .eq('id', ctx.userId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('job_applications')
      .select('job_id')
      .eq('applicant_profile_id', ctx.userId)
      .limit(1000),
  ])

  const p = profile as {
    phone: string | null
    location: string | null
    linkedin_url: string | null
    portfolio_url: string | null
    current_company: string | null
    years_experience: number | string | null
    notice_period: string | null
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
      linkedinUrl: p?.linkedin_url ?? '',
      portfolioUrl: p?.portfolio_url ?? '',
      currentCompany: p?.current_company ?? '',
      yearsExperience: p?.years_experience == null ? '' : String(p.years_experience),
      noticePeriod: p?.notice_period ?? '',
    },
    savedResumeName: p?.resume_key ? (p.resume_name ?? 'Saved CV') : null,
    appliedJobIds: ((applied ?? []) as Array<{ job_id: string }>).map((row) => row.job_id),
  }
}
