'use client'

import * as React from 'react'
import { Check, ChevronRight, Search } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/primitives'
import { Input } from '@/components/ui/input'
import type { MessagingPerson } from '@/lib/messaging-shared'
import { cn, initials } from '@/lib/utils'

/**
 * Choose people — for a new group, or to add to an existing one.
 *
 * A SEARCHABLE CHECKLIST, not a multi-select dropdown. A workspace of two
 * hundred people is unusable in a `<select multiple>`, and the common action is
 * "the four people on this piece of work", which is four searches and four taps.
 *
 * Already-in-the-room people stay VISIBLE and disabled rather than being
 * filtered out, because a roster with holes in it reads as a search that is
 * broken. The row says why instead.
 *
 * In `instant` mode there is no checklist at all: tapping a row IS the action,
 * so the trailing control is a chevron, not a checkbox, and the running count
 * at the bottom is dropped. This is how a direct message is started — one tap,
 * straight into the thread, the way every chat app does it.
 */
export function PeoplePicker({
  people,
  selected,
  onToggle,
  /** Who cannot be chosen, and the reason to show on their row. */
  disabled = {},
  emptyLabel = 'No one matches that.',
  max,
  instant = false,
}: {
  people: MessagingPerson[]
  selected: Set<string>
  onToggle: (profileId: string) => void
  disabled?: Record<string, string>
  emptyLabel?: string
  max?: number
  /** One tap opens — no checkboxes, no count. For direct messages. */
  instant?: boolean
}) {
  const [term, setTerm] = React.useState('')

  const filtered = React.useMemo(() => {
    const needle = term.trim().toLowerCase()
    if (!needle) return people
    return people.filter(
      (person) =>
        person.name.toLowerCase().includes(needle) ||
        (person.email ?? '').toLowerCase().includes(needle) ||
        (person.jobTitle ?? '').toLowerCase().includes(needle)
    )
  }, [people, term])

  const atLimit = max !== undefined && selected.size >= max

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
          aria-hidden
        />
        <Input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search people"
          aria-label="Search people"
          className="h-9 pl-9"
        />
      </div>

      <ul className="scrollbar-thin max-h-64 space-y-0.5 overflow-y-auto rounded-lg border border-line p-1">
        {filtered.map((person) => {
          const isSelected = selected.has(person.id)
          const reason = disabled[person.id]
          const blocked = !!reason || (atLimit && !isSelected)
          return (
            <li key={person.id}>
              <button
                type="button"
                disabled={blocked}
                onClick={() => onToggle(person.id)}
                aria-pressed={isSelected}
                className={cn(
                  'focus-ring flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors',
                  isSelected ? 'bg-brand-50 dark:bg-brand-500/15' : 'hover:bg-page',
                  blocked && 'cursor-not-allowed opacity-55 hover:bg-transparent'
                )}
              >
                <Avatar className="size-8 shrink-0">
                  {person.photoUrl ? <AvatarImage src={person.photoUrl} alt="" /> : null}
                  <AvatarFallback className="bg-brand-600 text-[10px] text-white">
                    {initials(person.name, person.email)}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">
                    {person.name}
                  </span>
                  <span className="block truncate text-[11px] text-ink-muted">
                    {reason ?? person.jobTitle ?? person.email ?? ''}
                  </span>
                </span>
                {instant ? (
                  <ChevronRight className="size-4 shrink-0 text-ink-muted" aria-hidden />
                ) : (
                  <span
                    className={cn(
                      'grid size-5 shrink-0 place-items-center rounded-md border',
                      isSelected ? 'border-brand-600 bg-brand-600 text-white' : 'border-line'
                    )}
                    aria-hidden
                  >
                    {isSelected ? <Check className="size-3.5" /> : null}
                  </span>
                )}
              </button>
            </li>
          )
        })}

        {!filtered.length ? (
          <li className="px-3 py-6 text-center text-[13px] text-ink-muted">{emptyLabel}</li>
        ) : null}
      </ul>

      {instant ? null : (
        <p className="text-[11px] text-ink-muted">
          {selected.size} selected
          {max !== undefined ? ` of ${max}` : ''}
        </p>
      )}
    </div>
  )
}
