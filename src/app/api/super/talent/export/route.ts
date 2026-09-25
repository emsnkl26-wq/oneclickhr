import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api'
import { apiRequireSuperAdmin } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { toCsv } from '@/lib/csv-core'
import {
  VISA_STATES, loadCandidateDirectory, loadTalentDirectory, parseTalentFilters, skillList,
} from '@/lib/talent'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/** Enough for any realistic platform; a hard ceiling so one click cannot run away. */
const MAX_ROWS = 10_000
/** PostgREST answers at most this many rows per request on a default project. */
const PAGE = 1000

/** Every row, a page at a time, up to MAX_ROWS. */
async function all<T>(load: (offset: number) => Promise<{ rows: T[] }>): Promise<T[]> {
  const out: T[] = []
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    const { rows } = await load(offset)
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

/**
 * The talent directory as CSV, with the same filters as the page (053).
 * Super admins only; every export is audited because it is a bulk copy of
 * personal data leaving the platform.
 */
async function handleGET(request: NextRequest) {
  const gate = await apiRequireSuperAdmin()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const params = Object.fromEntries(new URL(request.url).searchParams.entries())
  const filters = parseTalentFilters(params)
  const admin = createAdminClient()

  let csv: string
  let count: number
  if (filters.tab === 'candidates') {
    const rows = await all((offset) => loadCandidateDirectory(admin, filters, { limit: PAGE, offset }))
    count = rows.length
    csv = toCsv(
      ['Name', 'Email', 'Phone', 'Headline', 'Location', 'Country', 'Work authorization', 'Years experience', 'Current company', 'Skills', 'Applications', 'Account', 'Joined'],
      rows.map((r) => [
        r.full_name,
        r.email,
        r.candidate?.phone,
        r.candidate?.headline,
        r.candidate?.location,
        r.candidate?.country,
        r.candidate?.work_authorization,
        r.candidate?.years_experience == null ? '' : Number(r.candidate.years_experience),
        r.candidate?.current_company,
        skillList(r.candidate?.skills).join('; '),
        r.applications,
        r.is_active ? 'Active' : 'Deactivated',
        r.created_at.slice(0, 10),
      ])
    )
  } else {
    const rows = await all((offset) => loadTalentDirectory(admin, filters, { limit: PAGE, offset }))
    count = rows.length
    csv = toCsv(
      ['Name', 'Email', 'Phone', 'Organization', 'Designation', 'City', 'Country', 'Employment type', 'Work authorization status', 'Visa type', 'Visa start', 'Visa expiry', 'Visa status', 'Latest role', 'Skills', 'Account'],
      rows.map((r) => [
        r.full_name,
        r.email,
        r.phone,
        r.tenant_name,
        r.designation,
        r.city,
        r.country,
        r.employment_type,
        r.onboarding_work_auth_status,
        r.visa_type || r.onboarding_visa_type,
        r.visa_start_date,
        r.visa_expiry_date,
        VISA_STATES[r.visa_state],
        [r.latest_role_title, r.latest_company].filter(Boolean).join(' at '),
        skillList(r.skills).join('; '),
        r.is_active ? 'Active' : 'Deactivated',
      ])
    )
  }

  await audit({
    tenantId: null,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'talent.exported',
    entity: 'profiles',
    meta: { tab: filters.tab, rows: count, filters: { ...filters, page: undefined } },
    request,
  })

  const name = `${filters.tab === 'candidates' ? 'job-seekers' : 'talent'}-${new Date().toISOString().slice(0, 10)}.csv`
  // The BOM keeps Excel on Windows reading it as UTF-8.
  return new NextResponse(`﻿${csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  })
}

export const GET = withErrorHandler(handleGET)
