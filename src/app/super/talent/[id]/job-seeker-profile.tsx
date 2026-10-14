import Link from 'next/link'
import {
  ArrowLeft, Briefcase, FileText, Globe, Linkedin, Mail, MapPin, Phone,
} from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { PageHeader, StatusChip, EmptyState } from '@/components/ui/patterns'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { skillList } from '@/lib/talent'
import { countryName } from '@/lib/geo'
import { formatInstantLabel } from '@/lib/time'
import { DeletePersonButton } from './delete-person-button'

/** The row shape /super/talent/[id] hands over once it knows this is a seeker. */
export interface JobSeeker {
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
    linkedin_url: string | null
    portfolio_url: string | null
    years_experience: number | string | null
    current_company: string | null
    notice_period: string | null
    work_authorization: string | null
    skills: unknown
    summary: string | null
    resume_key: string | null
    resume_name: string | null
  } | null
}

/**
 * One JOB SEEKER, from the platform console.
 *
 * WHY THIS EXISTS AS A SECOND RENDERER. `/super/talent/[id]` reads
 * `super_talent_directory`, and that view ends `where p.role = 'employee'` — it
 * is a directory of other people's staff. A job seeker has no tenant and no row
 * in it, so every link to one 404'd: the Job seekers tab had no detail view at
 * all, and the candidate matcher's links pointed at a page that could not
 * render them. Rather than widen the view (it joins `tenants`, which a
 * candidate has none of, and every column in it is about employment), the page
 * falls through to this.
 *
 * WHAT IS SHOWN, and the one thing that is not. Everything a job seeker wrote
 * about themselves, because they wrote it to be read by employers — that is
 * what signing up on the portal is for. Their applications are listed only for
 * OUR OWN postings; applications to a customer's job are counted and not named,
 * for the same reason /super/jobs/[id] refuses to list a customer's applicants.
 * Platform oversight does not extend to reading who applied to somebody else's
 * advert.
 */
export async function JobSeekerProfile({ person }: { person: JobSeeker }) {
  const profile = person.candidate
  const admin = createAdminClient()

  const { data: applicationRows } = await admin
    .from('job_applications')
    .select('id, job_id, status, created_at, job:jobs!inner(id, title, tenant_id)')
    .eq('applicant_profile_id', person.id)
    .order('created_at', { ascending: false })
    .limit(100)

  type Row = {
    id: string
    job_id: string
    status: string
    created_at: string
    job: { id: string; title: string; tenant_id: string | null } | Array<{ id: string; title: string; tenant_id: string | null }> | null
  }

  const applications = ((applicationRows ?? []) as unknown as Row[]).map((row) => {
    const job = Array.isArray(row.job) ? row.job[0] : row.job
    return { ...row, job: job ?? null }
  })

  const ours = applications.filter((row) => row.job && !row.job.tenant_id)
  const elsewhere = applications.length - ours.length

  const skills = skillList(profile?.skills)
  const place = [profile?.location, profile?.country ? countryName(profile.country) : null]
    .filter(Boolean)
    .join(', ')
  const years =
    profile?.years_experience === null || profile?.years_experience === undefined
      ? null
      : Number(profile.years_experience)

  return (
    <div className="space-y-6">
      <PageHeader
        title={person.full_name || person.email || 'Job seeker'}
        description={
          [profile?.headline, profile?.current_company].filter(Boolean).join(' · ') ||
          'Job seeker from the portal'
        }
        actions={
          <>
            <Button asChild variant="secondary">
              <Link href="/super/talent?tab=candidates">
                <ArrowLeft />
                All job seekers
              </Link>
            </Button>
            {person.email ? (
              <DeletePersonButton
                user={{
                  id: person.id,
                  name: person.full_name,
                  email: person.email,
                  role: 'candidate',
                  organization: null,
                }}
              />
            ) : null}
          </>
        }
      />

      <div className="grid items-start gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card>
            <CardContent className="space-y-3 pt-5 text-sm">
              <div className="flex flex-wrap gap-1.5">
                <StatusChip status={person.is_active ? 'active' : 'inactive'} />
                <StatusChip status="neutral" tone="neutral" label="Job seeker" />
                {years !== null ? (
                  <StatusChip status="neutral" tone="neutral" label={`${years} yrs`} />
                ) : null}
              </div>
              {person.email ? (
                <a
                  href={`mailto:${person.email}`}
                  className="flex items-center gap-2 break-all hover:text-brand-ink"
                >
                  <Mail className="size-4 shrink-0 text-ink-muted" aria-hidden />
                  {person.email}
                </a>
              ) : null}
              {profile?.phone ? (
                <a
                  href={`tel:${profile.phone.replace(/[^+\d]/g, '')}`}
                  className="flex items-center gap-2 hover:text-brand-ink"
                >
                  <Phone className="size-4 shrink-0 text-ink-muted" aria-hidden />
                  {profile.phone}
                </a>
              ) : null}
              {place ? (
                <p className="flex items-center gap-2">
                  <MapPin className="size-4 shrink-0 text-ink-muted" aria-hidden />
                  {place}
                </p>
              ) : null}
              {/* Only an absolute https address becomes a link — these columns are
                  plain text the person typed, and a relative one would navigate
                  inside this console. Same rule as the employee page. */}
              {profile?.linkedin_url && /^https:\/\//i.test(profile.linkedin_url) ? (
                <a
                  href={profile.linkedin_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 hover:text-brand-ink"
                >
                  <Linkedin className="size-4 shrink-0 text-ink-muted" aria-hidden />
                  LinkedIn
                </a>
              ) : null}
              {profile?.portfolio_url && /^https:\/\//i.test(profile.portfolio_url) ? (
                <a
                  href={profile.portfolio_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 break-all hover:text-brand-ink"
                >
                  <Globe className="size-4 shrink-0 text-ink-muted" aria-hidden />
                  Portfolio
                </a>
              ) : null}
              <p className="text-ink-muted">Signed up {formatInstantLabel(person.created_at)}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Availability</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5 text-sm">
              <Fact label="Work authorization" value={profile?.work_authorization} />
              <Fact label="Notice period" value={profile?.notice_period} />
              <Fact label="Current employer" value={profile?.current_company} />
              <Fact
                label="Experience"
                value={years === null ? null : `${years} ${years === 1 ? 'year' : 'years'}`}
              />
              <Fact
                label="Résumé"
                value={
                  profile?.resume_key
                    ? /*
                       * Named, not linked. An application résumé lives under the
                       * `applications/` prefix, which belongs to no tenant, and
                       * /api/files/view cannot serve it to anybody — see 015.
                       * A download here would need its own signed route, which is
                       * not something to add behind a detail page.
                       */
                      (profile.resume_name ?? 'On file')
                    : null
                }
              />
            </CardContent>
          </Card>

          {skills.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Skills</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-1.5">
                {skills.map((skill) => (
                  <span
                    key={skill}
                    className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-ink"
                  >
                    {skill}
                  </span>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>About</CardTitle>
            </CardHeader>
            <CardContent>
              {profile?.summary ? (
                <p className="whitespace-pre-line break-words text-sm leading-relaxed">
                  {profile.summary}
                </p>
              ) : (
                <p className="text-sm text-ink-muted">
                  They have not written a summary yet.
                  {profile ? '' : ' Their profile is empty — they signed up and stopped there.'}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Briefcase className="size-4 text-brand-600" aria-hidden />
                Applications to our roles
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {ours.length ? (
                <ul className="divide-y divide-line">
                  {ours.map((row) => (
                    <li key={row.id} className="flex items-center gap-3 px-5 py-3">
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/super/jobs/${row.job_id}?application=${row.id}`}
                          className="block truncate text-sm font-medium hover:underline"
                        >
                          {row.job?.title ?? 'A OneclickHR role'}
                        </Link>
                        <p className="truncate text-xs text-ink-muted">
                          Applied {formatInstantLabel(row.created_at)}
                        </p>
                      </div>
                      <StatusChip status={row.status} />
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  icon={FileText}
                  title="Not applied to us yet"
                  description="They signed up on the portal but have not applied to a OneclickHR posting."
                />
              )}
              {elsewhere ? (
                <p className="border-t border-line px-5 py-3 text-xs leading-relaxed text-ink-muted">
                  They have also applied to {elsewhere}{' '}
                  {elsewhere === 1 ? 'role' : 'roles'} posted by customers. Those applications
                  belong to the hiring organizations and are only visible inside their workspaces.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

/** One label/value line, with the dash that means "they did not say". */
function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2">
      <span className="text-ink-muted">{label}:</span>
      <span className={value ? 'font-medium' : 'text-ink-muted'}>{value || '—'}</span>
    </p>
  )
}
