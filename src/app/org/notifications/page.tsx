import type { Metadata } from 'next'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/patterns'
import { NotificationComposer } from './notification-composer'

export const metadata: Metadata = { title: 'Notifications' }
export const dynamic = 'force-dynamic'

export default async function NotificationsPage() {
  const ctx = await requireOrg()
  const supabase = await createSupabaseServerClient()

  const [{ data: sent }, { data: departments }, { data: employees }] = await Promise.all([
    supabase
      .from('notifications')
      .select('id, title, description, send_to_type, target_id, image_url, created_at')
      .order('created_at', { ascending: false })
      .limit(100),
    supabase.from('departments').select('id, name').order('name'),
    supabase
      .from('profiles')
      .select('id, full_name, email')
      .eq('role', 'employee')
      .eq('is_active', true)
      .order('full_name'),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description="Send an announcement to everyone, a department, or one person."
      />
      <NotificationComposer
        sent={sent ?? []}
        departments={departments ?? []}
        employees={employees ?? []}
        timezone={ctx.tenant.timezone}
      />
    </div>
  )
}
