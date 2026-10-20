import type { Metadata } from 'next'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { loadMessagingPage } from '@/lib/messaging-page'
import { MessagingScreen } from '@/components/messages/messaging-screen'

export const metadata: Metadata = { title: 'Messages' }
export const dynamic = 'force-dynamic'

export default async function OrgMessagesPage() {
  const ctx = await requireOrg()
  const supabase = await createSupabaseServerClient()
  const data = await loadMessagingPage(supabase, ctx)

  return (
    <MessagingScreen
      basePath="/org/messages"
      initialConversations={data.conversations}
      initialPeople={data.people}
      initialDetail={null}
      projects={data.projects}
      canCreateProjectRoom={data.canCreateProjectRoom}
      viewerId={ctx.userId}
      viewerName={ctx.fullName || ctx.email}
      tenantId={ctx.tenantId}
    />
  )
}
