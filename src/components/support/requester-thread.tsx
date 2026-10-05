'use client'

import { useRouter } from 'next/navigation'
import { SupportThreadView, type ThreadMessage } from './support-thread-view'

/** The requester's side of a thread; a sent message re-reads the page. */
export function RequesterThread({
  id, original, messages, closed,
}: {
  id: string
  original: { authorName: string | null; body: string; createdAt: string }
  messages: ThreadMessage[]
  closed: boolean
}) {
  const router = useRouter()
  return (
    <SupportThreadView
      original={original}
      messages={messages}
      viewer="requester"
      endpoint={`/api/support/${id}/messages`}
      onSent={() => router.refresh()}
      closed={closed}
    />
  )
}
