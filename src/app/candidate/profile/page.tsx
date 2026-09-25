import type { Metadata } from 'next'
import { requireCandidate } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/patterns'
import { CandidateProfileForm, type CandidateProfileValues } from './candidate-profile-form'

export const metadata: Metadata = { title: 'My profile' }
export const dynamic = 'force-dynamic'

/** The job seeker's profile — what every application is prefilled from. */
export default async function CandidateProfilePage() {
  const ctx = await requireCandidate()
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('candidate_profiles')
    .select(
      'headline, phone, location, country, linkedin_url, portfolio_url, years_experience, current_company, notice_period, work_authorization, summary, skills, resume_name, resume_key'
    )
    .eq('id', ctx.userId)
    .maybeSingle()

  const row = (data ?? {}) as Record<string, unknown>
  const text = (key: string) => (typeof row[key] === 'string' ? (row[key] as string) : '')

  const values: CandidateProfileValues = {
    fullName: ctx.fullName ?? '',
    email: ctx.email,
    headline: text('headline'),
    phone: text('phone'),
    location: text('location'),
    country: text('country'),
    linkedinUrl: text('linkedin_url'),
    portfolioUrl: text('portfolio_url'),
    yearsExperience: row.years_experience == null ? '' : String(row.years_experience),
    currentCompany: text('current_company'),
    noticePeriod: text('notice_period'),
    workAuthorization: text('work_authorization'),
    summary: text('summary'),
    skills: Array.isArray(row.skills)
      ? (row.skills as unknown[]).filter((s): s is string => typeof s === 'string')
      : [],
    resumeName: row.resume_key ? text('resume_name') || 'CV' : null,
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="My profile"
        description="Kept on file and used to fill in every application you send — so applying takes a click."
      />
      <CandidateProfileForm initial={values} />
    </div>
  )
}
