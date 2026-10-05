'use client'

import * as React from 'react'
import { Send } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { FormError } from '@/components/ui/form-field'
import { apiPost, ApiClientError } from '@/lib/fetcher'
import { cn } from '@/lib/utils'

export interface ThreadMessage {
  id: string
  fromPlatform: boolean
  authorName: string | null
  body: string
  createdAt: string
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

/**
 * A support conversation (056): the original message, then each reply, with a
 * box to write the next one. `viewer` decides which side is "you" — the
 * platform console and the requester's portal render the same thread mirrored.
 */
export function SupportThreadView({
  original, messages, viewer, endpoint, onSent, closed = false,
}: {
  original: { authorName: string | null; body: string; createdAt: string }
  messages: ThreadMessage[]
  viewer: 'platform' | 'requester'
  /** Where a reply is POSTed. */
  endpoint: string
  onSent: () => void
  /** Show the composer as reopening a resolved request. */
  closed?: boolean
}) {
  const [draft, setDraft] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  async function send() {
    if (!draft.trim()) {
      setError('Write a reply first.')
      return
    }
    setError(null)
    setBusy(true)
    try {
      await apiPost(endpoint, { body: draft.trim() })
      setDraft('')
      toast.success(viewer === 'platform' ? 'Reply sent — they have been notified' : 'Message sent')
      onSent()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not send the message.')
    } finally {
      setBusy(false)
    }
  }

  const all = [
    { id: 'original', fromPlatform: false, authorName: original.authorName, body: original.body, createdAt: original.createdAt },
    ...messages,
  ]

  return (
    <div className="space-y-4">
      <ol className="space-y-3">
        {all.map((message) => {
          const mine = viewer === 'platform' ? message.fromPlatform : !message.fromPlatform
          return (
            <li key={message.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[85%] rounded-2xl px-4 py-3 text-sm',
                  mine ? 'bg-brand-50 text-ink dark:bg-brand-500/15' : 'bg-page text-ink ring-1 ring-inset ring-line'
                )}
              >
                <p className="mb-1 text-xs font-medium text-ink-muted">
                  {message.fromPlatform ? 'OneclickHR Support' : message.authorName || 'You'} · {when(message.createdAt)}
                </p>
                <p className="whitespace-pre-wrap leading-relaxed">{message.body}</p>
              </div>
            </li>
          )
        })}
      </ol>

      <div className="space-y-2">
        <FormError message={error} />
        <Textarea
          rows={3}
          value={draft}
          maxLength={5000}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={
            viewer === 'platform'
              ? 'Write a reply. The requester sees it in their portal and gets an email.'
              : closed
                ? 'Write to reopen this request.'
                : 'Add a message.'
          }
        />
        <div className="flex justify-end">
          <Button loading={busy} onClick={send}>
            <Send />
            {viewer === 'platform' ? 'Send reply' : 'Send'}
          </Button>
        </div>
      </div>
    </div>
  )
}
