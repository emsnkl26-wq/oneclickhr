'use client'

import * as React from 'react'
import { segmentMessage } from '@/lib/messaging-shared'
import { cn } from '@/lib/utils'

/**
 * A message's body: plain text, with links and mentions picked out.
 *
 * RENDERED AS REACT NODES, NEVER AS HTML. There is no `dangerouslySetInnerHTML`
 * here and there must never be: the body is text a colleague typed, and the
 * moment it becomes markup the product owns a stored-XSS surface that every
 * person in the workspace can write to. `segmentMessage` returns spans, and
 * React escapes each one on the way in.
 *
 * Links carry `rel="noopener noreferrer"` and open in a new tab. `noopener` is
 * the one that matters — without it the opened page gets a handle on this one
 * through `window.opener` and can navigate it somewhere that looks like a sign-in
 * screen.
 *
 * A mention OF THE READER is tinted; a mention of somebody else is not. The
 * whole value of highlighting is answering "is this for me?" at a glance, and a
 * thread where every mention glows answers nothing.
 */
export function MessageText({
  body,
  people,
  viewerId,
  className,
}: {
  body: string | null
  people: Array<{ id: string; name: string }>
  viewerId: string
  className?: string
}) {
  const segments = React.useMemo(() => segmentMessage(body, people), [body, people])
  if (!segments.length) return null

  return (
    <p className={cn('whitespace-pre-wrap break-words leading-relaxed', className)}>
      {segments.map((segment, index) => {
        if (segment.type === 'link') {
          return (
            <a
              key={index}
              href={segment.href}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline decoration-current/40 underline-offset-2 hover:decoration-current"
            >
              {segment.text}
            </a>
          )
        }
        if (segment.type === 'mention') {
          const isMe = segment.profileId === viewerId
          return (
            <span
              key={index}
              className={cn(
                'rounded px-1 font-medium',
                isMe ? 'bg-brand-200/70 text-brand-ink dark:bg-brand-500/30' : 'text-brand-ink'
              )}
            >
              {segment.text}
            </span>
          )
        }
        return <React.Fragment key={index}>{segment.text}</React.Fragment>
      })}
    </p>
  )
}
