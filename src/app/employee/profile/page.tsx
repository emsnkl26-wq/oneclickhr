import type { Metadata } from 'next'
import Link from 'next/link'
import { KeyRound } from 'lucide-react'
import { requireEmployee } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/patterns'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  ExperienceSection, EducationSection, SkillsSection,
  type ExperienceItem, type EducationItem,
} from '@/components/profile/profile-sections'
import { ProfileForm } from './profile-form'
import { ProfileHero } from './profile-hero'

export const metadata: Metadata = { title: 'My profile' }
export const dynamic = 'force-dynamic'

/**
 * The employee's own profile.
 *
 * The photo lives on the HERO and nowhere else — `/api/employee/profile` treats
 * an absent key as "leave it alone", so the header and the details form below it
 * write different fields of the same row without either reverting the other.
 */
export default async function EmployeeProfilePage() {
  const ctx = await requireEmployee()
  const supabase = await createSupabaseServerClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, email, phone, photo_url, employee_code, designation, department_id, date_of_joining, timezone, is_active, skills')
    .eq('id', ctx.userId)
    .single()

  const [{ data: department }, { data: experience }, { data: education }] = await Promise.all([
    profile?.department_id
      ? supabase.from('departments').select('name').eq('id', profile.department_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('employee_experience')
      .select('id, company_name, role_title, start_date, end_date, is_current, summary')
      .order('is_current', { ascending: false })
      .order('start_date', { ascending: false, nullsFirst: false }),
    supabase
      .from('employee_education')
      .select('id, institution, degree, field_of_study, completion_year')
      .order('completion_year', { ascending: false, nullsFirst: false }),
  ])

  const skills = Array.isArray(profile?.skills) ? (profile.skills as string[]) : []

  return (
    <div className="space-y-6">
      <PageHeader title="My profile" description="Your details, your history and how to reach you." />

      <ProfileHero
        fullName={profile?.full_name ?? ''}
        email={profile?.email ?? ctx.email}
        designation={profile?.designation ?? null}
        photoUrl={profile?.photo_url ?? null}
        employeeCode={profile?.employee_code ?? null}
        isActive={profile?.is_active ?? true}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <ProfileForm
            profile={{
              fullName: profile?.full_name ?? '',
              phone: profile?.phone ?? '',
              timezone: profile?.timezone ?? ctx.tenant.timezone,
            }}
          />

          <SkillsSection skills={skills} />

          <Card>
            <CardHeader>
              <CardTitle>Work details</CardTitle>
              <CardDescription>
                Set by your organization. Ask your manager if something is wrong.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-2">
                {[
                  ['Email', profile?.email ?? '—'],
                  ['Employee code', profile?.employee_code ?? '—'],
                  ['Job title', profile?.designation ?? '—'],
                  ['Department', department?.name ?? '—'],
                  ['Date of joining', profile?.date_of_joining ?? '—'],
                  ['Organization', ctx.tenant.name],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs font-medium uppercase tracking-wider text-ink-muted">
                      {label}
                    </dt>
                    <dd className="mt-0.5 break-words text-sm">{value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Security</CardTitle>
              <CardDescription>Change the password you sign in with.</CardDescription>
            </CardHeader>
            <CardFooter>
              <Button asChild variant="secondary">
                <Link href="/change-password">
                  <KeyRound />
                  Change password
                </Link>
              </Button>
            </CardFooter>
          </Card>
        </div>

        <div className="space-y-5">
          <ExperienceSection items={(experience ?? []) as unknown as ExperienceItem[]} />
          <EducationSection items={(education ?? []) as unknown as EducationItem[]} />
        </div>
      </div>
    </div>
  )
}
