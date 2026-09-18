import type { Metadata } from 'next'
import { CalendarDays } from 'lucide-react'
import { requireEmployee } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader, EmptyState } from '@/components/ui/patterns'
import { Card } from '@/components/ui/card'
import { formatLocal } from '@/lib/time'
import { MeetingList, type MeetingRow } from './meeting-list'

export const metadata: Metadata = { title: 'Meetings' }
export const dynamic = 'force-dynamic'

/** A location that is really a video link (Zoom, Teams…) is offered as the way in. */
function asUrl(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return /^https?:\/\/\S+$/i.test(trimmed) ? trimmed : null
}

export default async function EmployeeMeetingsPage() {
  const ctx = await requireEmployee()
  const supabase = await createSupabaseServerClient()

  // Employees have SELECT on meetings within their tenant, and no write policy —
  // so this page is read-only by construction, not by hiding buttons.
  const { data: meetings } = await supabase
    .from('meetings')
    .select(
      'id, title, description, location, meet_link, start_time, end_time, attendees, source, ' +
        'organizer:profiles!meetings_organizer_id_fkey(full_name)'
    )
    .is('cancelled_at', null)
    .gte('end_time', new Date().toISOString())
    .order('start_time', { ascending: true })
    .limit(100)

  const tz = ctx.tenant.timezone

  type Raw = {
    id: string
    title: string
    description: string | null
    location: string | null
    meet_link: string | null
    start_time: string
    end_time: string
    attendees: Array<{ email?: string; name?: string }> | null
    organizer: { full_name: string | null } | null
  }

  const rows: MeetingRow[] = ((meetings ?? []) as unknown as Raw[]).map((m) => ({
    id: m.id,
    title: m.title,
    description: m.description,
    location: m.location,
    joinUrl: asUrl(m.meet_link) ?? asUrl(m.location),
    month: formatLocal(m.start_time, tz, 'MMM'),
    day: formatLocal(m.start_time, tz, 'd'),
    when: `${formatLocal(m.start_time, tz, 'EEE d MMM, HH:mm')} – ${formatLocal(m.end_time, tz, 'HH:mm')}`,
    attendees: (Array.isArray(m.attendees) ? m.attendees : [])
      .map((a) => a?.name || a?.email || '')
      .filter(Boolean),
    organizer: m.organizer?.full_name ?? null,
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Meetings"
        description={`Upcoming meetings on the workspace calendar, in ${tz}. Click one for details.`}
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={CalendarDays}
            title="Nothing scheduled"
            description="Meetings your organization schedules will appear here."
          />
        </Card>
      ) : (
        <MeetingList meetings={rows} />
      )}
    </div>
  )
}
