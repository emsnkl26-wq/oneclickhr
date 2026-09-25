import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, BadgeCheck, Briefcase, GraduationCap, Mail, MapPin, Phone } from 'lucide-react'
import { requireSuperAdmin } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { PageHeader, StatusChip } from '@/components/ui/patterns'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { TALENT_COLUMNS, VISA_STATES, skillList, type TalentRow } from '@/lib/talent'
import { countryName } from '@/lib/geo'
import { formatDateLabel } from '@/lib/time'
import { DeletePersonButton } from './delete-person-button'

export const metadata: Metadata = { title: 'Talent profile' }
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * One employee as a candidate for platform hiring (053): who they are, every
 * work authorization on record (never the visa number or its documents), their
 * work history and education.
 */
export default async function TalentProfilePage({ params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin()
  const { id } = await params
  if (!UUID.test(id)) notFound()

  const admin = createAdminClient()
  const { data } = await admin.from('super_talent_directory').select(TALENT_COLUMNS).eq('id', id).maybeSingle()
  if (!data) notFound()
  const person = data as unknown as TalentRow

  // Every read below is filtered by this person AND their tenant — the admin
  // client has no RLS, so the filters are the scope.
  const [{ data: auths }, { data: experience }, { data: education }] = await Promise.all([
    admin
      .from('work_authorizations')
      .select('id, visa_type, start_date, expiry_date')
      .eq('tenant_id', person.tenant_id)
      .eq('employee_id', id)
      .order('expiry_date', { ascending: false }),
    admin
      .from('employee_experience')
      .select('id, company_name, role_title, start_date, end_date, is_current, summary')
      .eq('tenant_id', person.tenant_id)
      .eq('employee_id', id)
      .order('start_date', { ascending: false, nullsFirst: false }),
    admin
      .from('employee_education')
      .select('id, institution, degree, field_of_study, completion_year')
      .eq('tenant_id', person.tenant_id)
      .eq('employee_id', id)
      .order('completion_year', { ascending: false, nullsFirst: false }),
  ])

  const skills = skillList(person.skills)
  const place = [person.city, person.state_province, person.country ? countryName(person.country) : null]
    .filter(Boolean)
    .join(', ')

  return (
    <div className="space-y-6">
      <PageHeader
        title={person.full_name || person.email || 'Employee'}
        description={[person.designation, person.tenant_name].filter(Boolean).join(' · ')}
        actions={
          <>
            <Button asChild variant="secondary">
              <Link href="/super/talent">
                <ArrowLeft />
                All talent
              </Link>
            </Button>
            {person.email ? (
              <DeletePersonButton
                user={{
                  id: person.id,
                  name: person.full_name,
                  email: person.email,
                  role: 'employee',
                  organization: person.tenant_name,
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
                {person.employment_type ? (
                  <StatusChip status="neutral" tone="neutral" label={person.employment_type} />
                ) : null}
              </div>
              {person.email ? (
                <a href={`mailto:${person.email}`} className="flex items-center gap-2 break-all hover:text-brand-ink">
                  <Mail className="size-4 shrink-0 text-ink-muted" aria-hidden />
                  {person.email}
                </a>
              ) : null}
              {person.phone ? (
                <a href={`tel:${person.phone.replace(/[^+\d]/g, '')}`} className="flex items-center gap-2 hover:text-brand-ink">
                  <Phone className="size-4 shrink-0 text-ink-muted" aria-hidden />
                  {person.phone}
                </a>
              ) : null}
              {place ? (
                <p className="flex items-center gap-2">
                  <MapPin className="size-4 shrink-0 text-ink-muted" aria-hidden />
                  {place}
                </p>
              ) : null}
              {person.date_of_joining ? (
                <p className="text-ink-muted">Joined {formatDateLabel(person.date_of_joining)}</p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BadgeCheck className="size-4 text-brand-600" aria-hidden />
                Work authorization
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p>
                <span className="text-ink-muted">Status: </span>
                <span className="font-medium">{VISA_STATES[person.visa_state]}</span>
              </p>
              {person.onboarding_work_auth_status ? (
                <p>
                  <span className="text-ink-muted">Stated at onboarding: </span>
                  {person.onboarding_work_auth_status}
                  {person.onboarding_visa_type ? ` (${person.onboarding_visa_type})` : ''}
                </p>
              ) : null}
              {(auths ?? []).length ? (
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {(auths ?? []).map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                      <span className="font-medium">{a.visa_type}</span>
                      <span className="tabular text-xs text-ink-muted">
                        {a.start_date ? `${formatDateLabel(a.start_date)} – ` : 'until '}
                        {formatDateLabel(a.expiry_date)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-ink-muted">No visa tracked by their organization.</p>
              )}
            </CardContent>
          </Card>

          {skills.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Skills</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-1.5">
                {skills.map((skill) => (
                  <span key={skill} className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-ink">
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
              <CardTitle className="flex items-center gap-2">
                <Briefcase className="size-4 text-brand-600" aria-hidden />
                Experience
              </CardTitle>
            </CardHeader>
            <CardContent>
              {(experience ?? []).length ? (
                <ol className="space-y-4">
                  {(experience ?? []).map((x) => (
                    <li key={x.id}>
                      <p className="font-medium">{x.role_title}</p>
                      <p className="text-sm text-ink-muted">
                        {x.company_name} · {x.start_date ? formatDateLabel(x.start_date) : '—'} –{' '}
                        {x.is_current ? 'Present' : x.end_date ? formatDateLabel(x.end_date) : '—'}
                      </p>
                      {x.summary ? (
                        <p className="mt-1 whitespace-pre-line break-words text-sm">{x.summary}</p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-ink-muted">Nothing recorded.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <GraduationCap className="size-4 text-brand-600" aria-hidden />
                Education
              </CardTitle>
            </CardHeader>
            <CardContent>
              {(education ?? []).length ? (
                <ul className="space-y-3">
                  {(education ?? []).map((e) => (
                    <li key={e.id}>
                      <p className="font-medium">
                        {e.degree}
                        {e.field_of_study ? `, ${e.field_of_study}` : ''}
                      </p>
                      <p className="text-sm text-ink-muted">
                        {e.institution}
                        {e.completion_year ? ` · ${e.completion_year}` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-muted">Nothing recorded.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
