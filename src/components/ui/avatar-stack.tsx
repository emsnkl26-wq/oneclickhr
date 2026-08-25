'use client'

import * as React from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/primitives'
import { cn, initials } from '@/lib/utils'

export interface StackedPerson {
  id: string
  full_name: string | null
  email: string | null
  photo_url: string | null
}

/**
 * The overlapping row of faces that stands for "who is on this".
 *
 * It shows at most `max` avatars and turns the rest into a `+N` chip rather than
 * growing the column: a project with forty people would otherwise widen the
 * table until every other column became unreadable, and nobody counts faces past
 * about four anyway. The full list is on the detail page, which is where the
 * question "who exactly?" is actually asked.
 */
export function AvatarStack({
  people,
  max = 4,
  size = 'md',
  className,
}: {
  people: StackedPerson[]
  max?: number
  size?: 'sm' | 'md'
  className?: string
}) {
  if (!people.length) {
    return <span className="text-sm text-ink-muted">Unassigned</span>
  }

  const shown = people.slice(0, max)
  const extra = people.length - shown.length
  const dimension = size === 'sm' ? 'size-7 text-[10px]' : 'size-8 text-[11px]'

  return (
    <div className={cn('flex items-center', className)}>
      <div className="flex -space-x-2">
        {shown.map((person) => (
          <Avatar
            key={person.id}
            className={cn(dimension, 'ring-2 ring-card')}
            title={person.full_name || person.email || 'Employee'}
          >
            {person.photo_url ? (
              <AvatarImage
                src={`/api/files/view?key=${encodeURIComponent(person.photo_url)}`}
                alt=""
              />
            ) : null}
            <AvatarFallback className={size === 'sm' ? 'text-[10px]' : 'text-[11px]'}>
              {initials(person.full_name, person.email)}
            </AvatarFallback>
          </Avatar>
        ))}
      </div>
      {extra > 0 ? (
        <span className="ml-2 rounded-full bg-page px-2 py-0.5 text-xs font-medium text-ink-muted">
          +{extra}
        </span>
      ) : null}
    </div>
  )
}
