import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { loadMessagingPage, loadThread } from '@/lib/messaging-page'
import { uuidSchema } from '@/lib/api'
import { MessagingScreen } from '@/components/messages/messaging-screen'

export const metadata: Metadata = { title: 'Messages' }
export const dynamic = 'force-dynamic'

/**
 * One conversation, server-rendered.
 *
 * The thread arrives with the page rather than being fetched after it, so
 * following a notification lands on the messages themselves instead of on a
 * spinner. The list is loaded alongside it because this route IS the screen —
 * see the box in `MessagingScreen` for why both panes are one component.
 */
export default async function OrgConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>
}) {
  const ctx = await requireOrg()
  const parsed = uuidSchema.safeParse((await params).conversationId)
  if (!parsed.success) notFound()

  const supabase = await createSupabaseServerClient()
  const [data, detail] = await Promise.all([
    loadMessagingPage(supabase, ctx),
    loadThread(supabase, ctx, parsed.data),
  ])
  if (!detail) notFound()

  return (
    <MessagingScreen
      basePath="/org/messages"
      initialConversations={data.conversations}
      initialPeople={data.people}
      initialDetail={detail}
      projects={data.projects}
      canCreateProjectRoom={data.canCreateProjectRoom}
      viewerId={ctx.userId}
      viewerName={ctx.fullName || ctx.email}
      tenantId={ctx.tenantId}
    />
  )
}
