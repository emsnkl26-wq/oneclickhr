import type { Metadata } from 'next'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/patterns'
import { MeetingsWorkspace } from './meetings-workspace'
import type { Meeting } from '@/types/db'

export const metadata: Metadata = { title: 'Meetings' }
export const dynamic = 'force-dynamic'

export default async function MeetingsPage() {
  const ctx = await requireOrg()
  const supabase = await createSupabaseServerClient()

  /*
   * A 30-day window, forwards. `google_event_id`, `cancelled_at` and the
   * timestamps are not named because nothing on this screen renders them — and
   * on `calendar_connections` the explicit columns are load-bearing rather than
   * tidy, since the encrypted token column is not readable by the
   * `authenticated` role at all and `select('*')` there would fail outright.
   */
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString()

  const [{ data: meetings }, { data: connection }] = await Promise.all([
    supabase
      .from('meetings')
      .select(
        'id, title, description, location, meet_link, start_time, end_time, organizer_id, attendees, source, read_only'
      )
      .gte('start_time', since)
      .order('start_time', { ascending: true })
      .limit(300),
    supabase.from('calendar_connections').select('id, status, google_email').maybeSingle(),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Meetings"
        description="Everything on the workspace calendar, in sync with Google both ways."
      />
      <MeetingsWorkspace
        meetings={(meetings ?? []) as Meeting[]}
        connected={connection?.status === 'connected'}
        timezone={ctx.tenant.timezone}
      />
    </div>
  )
}
