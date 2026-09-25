/**
 * Everything about one posting: the description on the left, the summary and
 * the recruiter on the right. Shared by the board's "View details" dialog and
 * the posting's own page (/jobs/[id]), so the two can never disagree.
 *
 * No hooks and no handlers — it renders the same on the server and inside a
 * client dialog. Every string in it came from an org's form and is rendered as
 * TEXT; links are only the recruiter's https LinkedIn addresses (enforced by
 * 052 and again by toRecruiter()), plus mailto:/tel: built from plain values.
 */
import { Briefcase, Linkedin, Mail, Phone } from 'lucide-react'
import {
  JOB_TYPE_LABELS, JOB_WORKPLACE_LABELS, experienceLabel,
} from '@/lib/job-form'
import { countryName } from '@/lib/geo'
import { formatDateLabel } from '@/lib/time'
import { initials } from '@/lib/utils'
import type { PublicJob } from '@/types/db'

export function JobDescription({ job }: { job: PublicJob }) {
  return (
    <div className="space-y-6">
      <DetailSection title="Job description" body={job.description} />
      {job.responsibilities ? (
        <DetailSection title="Responsibilities" body={job.responsibilities} />
      ) : null}
      {job.requirements ? <DetailSection title="Requirements" body={job.requirements} /> : null}
      {job.skills.length ? (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">Skills</h3>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {job.skills.map((skill) => (
              <span
                key={skill}
                className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700"
              >
                {skill}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function DetailSection({ title, body }: { title: string; body: string }) {
  return (
    <section>
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">
        {title === 'Job description' ? <Briefcase className="size-3.5 text-brand-600" aria-hidden /> : null}
        {title}
      </h3>
      <p className="mt-3 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-ink">{body}</p>
    </section>
  )
}

/** The "Job summary" card: every fact the posting has, and nothing it does not. */
export function JobSummary({ job }: { job: PublicJob }) {
  const experience = experienceLabel(job.experienceMin, job.experienceMax)
  const rows: Array<[string, string | null, boolean?]> = [
    ['Position type', JOB_TYPE_LABELS[job.employmentType]],
    ['Company', job.company.name],
    ['End client', job.clientName],
    ['Location', job.location || (job.country ? countryName(job.country) : null)],
    ['Work mode', JOB_WORKPLACE_LABELS[job.workplace]],
    ['Experience', experience],
    ['Duration', job.duration],
    ['Salary', job.salaryLabel ?? 'Competitive', !job.salaryLabel],
    ['Work authorization', job.workAuthorization],
    ['Start date', job.startDate],
    ['Openings', String(job.openings)],
    ['Apply by', job.closesAt ? formatDateLabel(job.closesAt) : null],
  ]

  return (
    <section className="rounded-2xl border border-line bg-page/60 p-5">
      <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">Job summary</h3>
      <dl className="mt-4 divide-y divide-line">
        {rows
          .filter(([, value]) => value)
          .map(([label, value, soft]) => (
            <div key={label} className="flex items-start justify-between gap-4 py-2.5 text-sm">
              <dt className="shrink-0 text-ink-muted">{label}</dt>
              <dd
                className={`min-w-0 break-words text-right font-medium ${
                  soft ? 'text-emerald-600' : 'text-ink'
                }`}
              >
                {value}
              </dd>
            </div>
          ))}
      </dl>
    </section>
  )
}

/** The "Recruiter contact" card, when the org gave one. */
export function RecruiterContact({ job }: { job: PublicJob }) {
  const r = job.recruiter
  if (!r) return null

  return (
    <section className="rounded-2xl border border-line bg-page/60 p-5">
      <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">
        Recruiter contact
      </h3>
      {r.name || r.title ? (
        <div className="mt-4 flex items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-brand-50 text-sm font-bold text-brand-700">
            {initials(r.name, r.email)}
          </span>
          <div className="min-w-0">
            {r.name ? <p className="truncate font-semibold text-ink">{r.name}</p> : null}
            {r.title ? <p className="truncate text-xs text-ink-muted">{r.title}</p> : null}
          </div>
        </div>
      ) : null}
      <ul className="mt-4 space-y-2.5 text-sm">
        {r.email ? (
          <li>
            <a
              href={`mailto:${r.email}`}
              className="inline-flex min-w-0 items-center gap-2 break-all text-ink hover:text-brand-600"
            >
              <Mail className="size-4 shrink-0 text-ink-muted" aria-hidden />
              {r.email}
            </a>
          </li>
        ) : null}
        {r.phone ? (
          <li>
            <a
              href={`tel:${r.phone.replace(/[^+\d]/g, '')}`}
              className="inline-flex items-center gap-2 text-ink hover:text-brand-600"
            >
              <Phone className="size-4 shrink-0 text-ink-muted" aria-hidden />
              {r.phone}
            </a>
          </li>
        ) : null}
        {r.linkedinUrl ? (
          <li>
            <a
              href={r.linkedinUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-flex items-center gap-2 text-ink hover:text-brand-600"
            >
              <Linkedin className="size-4 shrink-0 text-[#0A66C2]" aria-hidden />
              Recruiter profile
            </a>
          </li>
        ) : null}
        {r.companyLinkedinUrl ? (
          <li>
            <a
              href={r.companyLinkedinUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-flex items-center gap-2 text-ink hover:text-brand-600"
            >
              <Linkedin className="size-4 shrink-0 text-[#0A66C2]" aria-hidden />
              Company page
            </a>
          </li>
        ) : null}
      </ul>
    </section>
  )
}
