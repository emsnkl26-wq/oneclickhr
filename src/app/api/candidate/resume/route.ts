import { NextResponse } from 'next/server'
import { withErrorHandler, jsonError } from '@/lib/api'
import { apiRequireCandidate } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { isResumeKey } from '@/lib/jobs'
import { presignGet } from '@/lib/r2'

export const dynamic = 'force-dynamic'

/**
 * Download the CV saved on the caller's own profile (052).
 *
 * The key is read from THEIR row, on their session — never taken from the
 * request — so this can only ever serve a person their own file.
 */
async function handleGET() {
  const gate = await apiRequireCandidate()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('candidate_profiles')
    .select('resume_key, resume_name')
    .eq('id', ctx.userId)
    .maybeSingle()

  const row = data as { resume_key: string | null; resume_name: string | null } | null
  if (!row?.resume_key || !isResumeKey(row.resume_key)) {
    return jsonError('There is no CV saved on your profile.', 404)
  }

  const url = await presignGet(row.resume_key, 60, row.resume_name ?? 'cv')
  return NextResponse.redirect(url, { headers: { 'Cache-Control': 'no-store' } })
}

export const GET = withErrorHandler(handleGET)
