import 'server-only'

/**
 * Support threads (056): the request's original message, then every reply in
 * order. Shared by the platform console and the requester's portal so both
 * read the conversation the same way.
 */
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

export const supportReplySchema = z.object({
  body: z.string().trim().min(1, 'Write a reply').max(5000),
})

export interface SupportMessage {
  id: string
  fromPlatform: boolean
  authorName: string | null
  body: string
  createdAt: string
}

export async function loadSupportMessages(
  client: SupabaseClient,
  requestId: string
): Promise<SupportMessage[]> {
  const { data } = await client
    .from('support_messages')
    .select('id, from_platform, author_name, body, created_at')
    .eq('request_id', requestId)
    .order('created_at', { ascending: true })

  return ((data ?? []) as Array<{
    id: string
    from_platform: boolean
    author_name: string | null
    body: string
    created_at: string
  }>).map((row) => ({
    id: row.id,
    fromPlatform: row.from_platform,
    authorName: row.author_name,
    body: row.body,
    createdAt: row.created_at,
  }))
}
