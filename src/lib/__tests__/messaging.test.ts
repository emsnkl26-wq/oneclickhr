import { describe, it, expect } from 'vitest'
import {
  attachmentKindFor,
  continuesGroup,
  findMentions,
  formatDuration,
  mentionedIds,
  messageKindFor,
  segmentMessage,
  type MessageView,
} from '@/lib/messaging-shared'
import { mergeMessages } from '@/components/messages/use-conversation'
import { isVoiceMime } from '@/lib/upload-policy'
import {
  conversationSchema,
  conversationUpdateSchema,
  messageSchema,
  reactionSchema,
} from '@/lib/schemas'

/**
 * Messaging's pure logic.
 *
 * Everything here is a rule that is INVISIBLE WHEN IT BREAKS, which is why it
 * is tested rather than tried:
 *
 *   • a mention that resolves to the wrong person notifies somebody who cannot
 *     open the room, and the thread still looks correct
 *   • a link segmenter that admits `javascript:` is a stored-XSS vector that
 *     renders identically to a working link
 *   • a merge that fails to match an optimistic bubble to its echo shows the
 *     message twice, which looks like a double-send and is not
 *   • a voice-mime list that rejects the WebM container rejects every
 *     recording Chrome makes, on a path nobody tests by hand because it needs
 *     a microphone
 */

const PEOPLE = [
  { id: 'p-priya', name: 'Priya' },
  { id: 'p-priya-nair', name: 'Priya Nair' },
  { id: 'p-raj', name: 'Rajesh Kumar' },
]

describe('mentions', () => {
  it('matches the LONGEST name first', () => {
    // The regression this exists for: a shortest-first scan reads "@Priya Nair"
    // as a mention of Priya followed by the stray word "Nair".
    const hits = findMentions('can @Priya Nair take this', PEOPLE)
    expect(hits).toHaveLength(1)
    expect(hits[0].profileId).toBe('p-priya-nair')
    expect(hits[0].label).toBe('Priya Nair')
  })

  it('does not read a longer word as a shorter name', () => {
    expect(findMentions('@Priyanka is not on this', PEOPLE)).toEqual([])
  })

  it('finds several, and de-duplicates ids', () => {
    expect(mentionedIds('@Priya and @Rajesh Kumar and @Priya again', PEOPLE)).toEqual([
      'p-priya',
      'p-raj',
    ])
  })

  it('ignores an @ that names nobody on the roster', () => {
    expect(mentionedIds('email me at me@example.com', PEOPLE)).toEqual([])
  })

  it('returns spans the renderer can highlight exactly', () => {
    const body = 'hi @Priya'
    const [hit] = findMentions(body, PEOPLE)
    expect(body.slice(hit.start, hit.end)).toBe('@Priya')
  })

  it('has nothing to find in an empty body', () => {
    expect(findMentions(null, PEOPLE)).toEqual([])
    expect(mentionedIds('', PEOPLE)).toEqual([])
  })
})

describe('segmenting a message', () => {
  it('picks out an http link', () => {
    const segments = segmentMessage('see https://acme.com/x for the spec')
    expect(segments.map((segment) => segment.type)).toEqual(['text', 'link', 'text'])
    expect(segments[1]).toMatchObject({ href: 'https://acme.com/x' })
  })

  it('leaves trailing punctuation out of the address', () => {
    const [, link] = segmentMessage('look at https://acme.com.')
    expect(link).toMatchObject({ type: 'link', text: 'https://acme.com' })
  })

  it('REFUSES a javascript: url', () => {
    // The pattern only matches http(s), and the allowlist in the parser is the
    // second lock. A clickable `javascript:` is script execution in every
    // reader's session.
    const segments = segmentMessage('try javascript:alert(1) now')
    expect(segments.every((segment) => segment.type !== 'link')).toBe(true)
  })

  it('refuses a data: url', () => {
    const segments = segmentMessage('data:text/html;base64,PHNjcmlwdD4=')
    expect(segments.every((segment) => segment.type !== 'link')).toBe(true)
  })

  it('handles a mention and a link in one message', () => {
    const segments = segmentMessage('@Priya see https://acme.com', PEOPLE)
    expect(segments.map((segment) => segment.type)).toEqual(['mention', 'text', 'link'])
  })

  it('reproduces the original text exactly', () => {
    // Whatever the segmentation, concatenating it back must be lossless —
    // otherwise a message renders with characters missing.
    const body = 'hi @Priya, see https://acme.com/a?b=1 — thanks!'
    expect(
      segmentMessage(body, PEOPLE)
        .map((segment) => segment.text)
        .join('')
    ).toBe(body)
  })
})

describe('attachment and message kinds', () => {
  it('reads the kind from the mime type', () => {
    expect(attachmentKindFor('image/png')).toBe('image')
    expect(attachmentKindFor('audio/mpeg')).toBe('audio')
    expect(attachmentKindFor('video/mp4')).toBe('video')
    expect(attachmentKindFor('application/pdf')).toBe('file')
  })

  it('tolerates a parameterised content type', () => {
    expect(attachmentKindFor('image/jpeg; charset=binary')).toBe('image')
  })

  it('treats a RECORDING as audio however it is containered', () => {
    // A browser's recorder writes Opus into WebM, which is `video/webm`. The
    // flag is the only thing that can tell that apart from an attached video.
    expect(attachmentKindFor('video/webm', true)).toBe('audio')
    expect(attachmentKindFor('video/webm', false)).toBe('video')
  })

  it('summarises the message by its attachments', () => {
    expect(messageKindFor([])).toBe('text')
    expect(messageKindFor([{ kind: 'image' }, { kind: 'image' }])).toBe('image')
    expect(messageKindFor([{ kind: 'audio' }])).toBe('voice')
    expect(messageKindFor([{ kind: 'image' }, { kind: 'file' }])).toBe('file')
    // One recording beside anything else is still "voice message" in a preview.
    expect(messageKindFor([{ kind: 'file' }, { kind: 'audio' }])).toBe('voice')
  })
})

describe('voice mime allowlist', () => {
  it('admits the containers a browser recorder actually produces', () => {
    expect(isVoiceMime('audio/webm;codecs=opus')).toBe(true)
    // Chrome and Firefox. Rejecting this rejects every recording they make.
    expect(isVoiceMime('video/webm')).toBe(true)
    // Safari.
    expect(isVoiceMime('audio/mp4')).toBe(true)
  })

  it('refuses what is not a recording', () => {
    expect(isVoiceMime('application/pdf')).toBe(false)
    expect(isVoiceMime('image/png')).toBe(false)
    expect(isVoiceMime(null)).toBe(false)
    expect(isVoiceMime('')).toBe(false)
  })
})

/* ------------------------------------------------------------------ merge */

function bubble(over: Partial<MessageView> & { id: string }): MessageView {
  return {
    conversationId: 'c1',
    senderId: 'me',
    senderName: 'Me',
    senderPhotoUrl: null,
    kind: 'text',
    body: 'hi',
    createdAt: '2026-10-14T10:00:00.000Z',
    editedAt: null,
    deleted: false,
    pinned: false,
    mine: true,
    mentions: [],
    systemEvent: null,
    replyTo: null,
    attachments: [],
    reactions: [],
    ...over,
  }
}

describe('merging server truth into the thread', () => {
  it('replaces an optimistic bubble with the row it became', () => {
    // The regression: without token matching the message appears twice — once
    // as the bubble we drew and once as the echo of our own insert.
    const local = [bubble({ id: 'token-1', clientToken: 'token-1', status: 'sending' })]
    const merged = mergeMessages(local, [
      bubble({ id: 'real-1', clientToken: 'token-1', createdAt: '2026-10-14T10:00:01.000Z' }),
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0].id).toBe('real-1')
    expect(merged[0].status).toBeUndefined()
  })

  it('replaces by id, keeping the server copy', () => {
    const merged = mergeMessages([bubble({ id: 'm1', body: 'old' })], [bubble({ id: 'm1', body: 'new' })])
    expect(merged).toHaveLength(1)
    expect(merged[0].body).toBe('new')
  })

  it('appends what is new and sorts by time', () => {
    const merged = mergeMessages(
      [bubble({ id: 'm2', createdAt: '2026-10-14T10:00:02.000Z' })],
      [
        bubble({ id: 'm3', createdAt: '2026-10-14T10:00:03.000Z' }),
        bubble({ id: 'm1', createdAt: '2026-10-14T10:00:01.000Z' }),
      ]
    )
    expect(merged.map((message) => message.id)).toEqual(['m1', 'm2', 'm3'])
  })

  it('breaks a same-timestamp tie by id, as the server does', () => {
    const merged = mergeMessages(
      [],
      [bubble({ id: 'b' }), bubble({ id: 'a' })]
    )
    expect(merged.map((message) => message.id)).toEqual(['a', 'b'])
  })

  it('does nothing when there is nothing incoming', () => {
    const local = [bubble({ id: 'm1' })]
    expect(mergeMessages(local, [])).toEqual(local)
  })
})

describe('grouping consecutive messages', () => {
  const at = (iso: string, over: Partial<MessageView> = {}) =>
    bubble({ id: iso, createdAt: iso, ...over })

  it('groups the same sender a minute apart', () => {
    expect(
      continuesGroup(at('2026-10-14T10:01:00.000Z'), at('2026-10-14T10:00:00.000Z'))
    ).toBe(true)
  })

  it('does not group across a long pause', () => {
    expect(
      continuesGroup(at('2026-10-14T10:30:00.000Z'), at('2026-10-14T10:00:00.000Z'))
    ).toBe(false)
  })

  it('does not group two different people', () => {
    expect(
      continuesGroup(
        at('2026-10-14T10:00:30.000Z', { senderId: 'other' }),
        at('2026-10-14T10:00:00.000Z')
      )
    ).toBe(false)
  })

  it('never groups a system line', () => {
    expect(
      continuesGroup(
        at('2026-10-14T10:00:30.000Z', { kind: 'system' }),
        at('2026-10-14T10:00:00.000Z')
      )
    ).toBe(false)
  })

  it('does not group the first message in a thread', () => {
    expect(continuesGroup(at('2026-10-14T10:00:00.000Z'), undefined)).toBe(false)
  })
})

describe('formatting', () => {
  it('writes a duration as minutes and seconds', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(7)).toBe('0:07')
    expect(formatDuration(65)).toBe('1:05')
    expect(formatDuration(725)).toBe('12:05')
  })

  it('treats an absent duration as zero rather than NaN', () => {
    expect(formatDuration(null)).toBe('0:00')
    expect(formatDuration(undefined)).toBe('0:00')
  })
})

describe('the mutation contracts', () => {
  it('refuses a message with neither text nor an attachment', () => {
    expect(messageSchema.safeParse({ attachments: [] }).success).toBe(false)
  })

  it('accepts an attachment with no caption', () => {
    const parsed = messageSchema.safeParse({
      attachments: [
        { key: 't/chat-images/x.png', name: 'x.png', contentType: 'image/png', sizeBytes: 10 },
      ],
    })
    expect(parsed.success).toBe(true)
  })

  it('refuses an emoji that is not on the allowlist', () => {
    // An open text field here stores combining marks that paint over the thread.
    expect(reactionSchema.safeParse({ emoji: '👍' }).success).toBe(true)
    expect(reactionSchema.safeParse({ emoji: 'x'.repeat(16) }).success).toBe(false)
  })

  it('insists a direct conversation names the other person', () => {
    expect(conversationSchema.safeParse({ kind: 'direct' }).success).toBe(false)
    expect(
      conversationSchema.safeParse({
        kind: 'direct',
        withProfileId: '11111111-1111-4111-8111-111111111111',
      }).success
    ).toBe(true)
  })

  it('keeps absent, cleared and set APART on a conversation patch', () => {
    /*
     * The regression this is here for. Written with the project's usual
     * `optionalText` helper, an omitted field arrived as `null` — so saving the
     * posting policy wiped the group's description and its picture, and the
     * "nothing to change" guard could never fire because every field was
     * always present.
     */
    const archiveOnly = conversationUpdateSchema.parse({ archived: true })
    expect(archiveOnly.description).toBeUndefined()
    expect(archiveOnly.avatarKey).toBeUndefined()

    expect(conversationUpdateSchema.parse({ description: null }).description).toBeNull()
    expect(conversationUpdateSchema.parse({ description: 'Payroll' }).description).toBe('Payroll')
    expect(conversationUpdateSchema.safeParse({}).success).toBe(false)
  })

  it('insists a group is named and a project room has a project', () => {
    expect(conversationSchema.safeParse({ kind: 'group' }).success).toBe(false)
    expect(conversationSchema.safeParse({ kind: 'group', name: 'Payroll' }).success).toBe(true)
    expect(conversationSchema.safeParse({ kind: 'project', name: 'Acme' }).success).toBe(false)
  })
})
