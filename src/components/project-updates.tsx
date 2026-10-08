'use client'

/**
 * Progress on a project, written by the people on it (059).
 *
 * WHY THIS EXISTS. Hours were the only way anyone could say a project had
 * moved, and hours come from timesheets. An employee whose workspace puts them
 * on clock-in rather than timesheets — a project manager among them — files no
 * timesheets at all, so their project page could show a team, a manager and a
 * client and nothing whatsoever about the work. A note is the smallest thing
 * that fixes that.
 *
 * PROGRESS IS OPTIONAL, and "no percentage" is not zero. Most notes are prose;
 * a percentage is for when somebody actually wants to commit to one. The latest
 * note that carries one is what the header reports, so the figure is always
 * attributable to a person and a date rather than being a free-floating number
 * on the project.
 *
 * One component for both the org and the employee side. The authority is the
 * `project_updates` policies, not this file — it only hides the composer from
 * somebody the server would refuse anyway.
 */

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { MessageSquarePlus, Trash2, TrendingUp } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import { EmptyState } from '@/components/ui/patterns'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/primitives'
import { apiPost, apiDelete, ApiClientError } from '@/lib/fetcher'
import { formatLocal } from '@/lib/time'
import { initials } from '@/lib/utils'

export interface ProjectUpdateRow {
  id: string
  body: string
  progress: number | null
  created_at: string
  author: {
    id: string
    full_name: string | null
    email: string | null
    photo_url: string | null
    designation: string | null
  } | null
}

/** The columns to embed for an author: used by every page that renders this. */
export const PROJECT_UPDATE_SELECT =
  'id, body, progress, created_at, author:profiles!project_updates_author_id_fkey(id, full_name, email, photo_url, designation)'

/** The newest note that committed to a percentage, if any did. */
export function latestProgress(updates: ProjectUpdateRow[]): number | null {
  for (const update of updates) {
    if (update.progress !== null) return update.progress
  }
  return null
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-page">
        <div
          className="h-full rounded-full bg-brand-600 transition-[width]"
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
      <span className="tabular shrink-0 text-xs font-semibold text-ink">{value}%</span>
    </div>
  )
}

export function ProjectUpdates({
  projectId,
  updates,
  timezone,
  canPost,
  currentUserId,
  canDeleteAny = false,
}: {
  projectId: string
  /** Newest first — the order the query returns and the order this renders. */
  updates: ProjectUpdateRow[]
  timezone: string
  /** False for somebody who can read the project but not write about it. */
  canPost: boolean
  currentUserId: string
  /** True for an org admin, who may tidy up anybody's note. */
  canDeleteAny?: boolean
}) {
  const router = useRouter()
  const [body, setBody] = React.useState('')
  const [progress, setProgress] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [deletingId, setDeletingId] = React.useState<string | null>(null)

  const current = latestProgress(updates)

  async function post(event: React.FormEvent) {
    event.preventDefault()
    const text = body.trim()
    if (!text) {
      setError('Write what moved.')
      return
    }
    // '' means "no percentage on this note", which is different from 0.
    const pct = progress.trim() === '' ? null : Number(progress)
    if (pct !== null && (!Number.isFinite(pct) || pct < 0 || pct > 100)) {
      setError('Progress must be between 0 and 100.')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      await apiPost('/api/projects/updates', { projectId, body: text, progress: pct })
      setBody('')
      setProgress('')
      toast.success('Update posted')
      router.refresh()
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.'
      )
    } finally {
      setSubmitting(false)
    }
  }

  async function remove(id: string) {
    setDeletingId(id)
    try {
      await apiDelete(`/api/projects/updates/${id}`)
      toast.success('Update removed')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Something went wrong.')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Progress updates</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {current !== null ? (
          <div className="rounded-xl border border-line bg-page p-3.5">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-ink-muted">
              <TrendingUp className="size-3.5" aria-hidden />
              Latest reported progress
            </p>
            <ProgressBar value={current} />
          </div>
        ) : null}

        {canPost ? (
          <form onSubmit={post} className="space-y-3">
            <FormError message={error} />
            <FormField label="What moved?">
              <Textarea
                rows={3}
                value={body}
                maxLength={4000}
                onChange={(event) => setBody(event.target.value)}
                placeholder="Finished the data migration and handed the staging build to the client for review."
              />
            </FormField>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <FormField
                label="Progress"
                hint="Optional — leave blank for a note with no percentage."
                className="w-36"
              >
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  inputMode="numeric"
                  value={progress}
                  onChange={(event) => setProgress(event.target.value)}
                  placeholder="%"
                />
              </FormField>
              <Button type="submit" loading={submitting}>
                <MessageSquarePlus />
                Post update
              </Button>
            </div>
          </form>
        ) : null}

        {updates.length === 0 ? (
          <EmptyState
            icon={MessageSquarePlus}
            title="No updates yet"
            description={
              canPost
                ? 'Post the first one — a line about what moved is enough.'
                : 'The team has not posted anything about this project yet.'
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {updates.map((update) => {
              const mine = update.author?.id === currentUserId
              return (
                <li key={update.id} className="flex gap-3 py-3.5 first:pt-0 last:pb-0">
                  <Avatar className="size-8 shrink-0">
                    {update.author?.photo_url ? (
                      <AvatarImage
                        src={`/api/files/view?key=${encodeURIComponent(update.author.photo_url)}`}
                        alt=""
                      />
                    ) : null}
                    <AvatarFallback>
                      {initials(update.author?.full_name, update.author?.email)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="text-sm font-medium text-ink">
                        {update.author?.full_name || update.author?.email || 'Someone'}
                      </span>
                      <span className="text-xs text-ink-muted">
                        {formatLocal(update.created_at, timezone, 'd MMM yyyy, HH:mm')}
                      </span>
                      {update.progress !== null ? (
                        <span className="tabular rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-ink">
                          {update.progress}%
                        </span>
                      ) : null}
                    </div>
                    {/* Plain text, never markup — this is somebody's typing. */}
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">
                      {update.body}
                    </p>
                  </div>
                  {mine || canDeleteAny ? (
                    <button
                      type="button"
                      onClick={() => remove(update.id)}
                      disabled={deletingId === update.id}
                      aria-label="Remove this update"
                      className="focus-ring h-fit shrink-0 rounded p-1.5 text-ink-muted transition hover:bg-page hover:text-danger disabled:opacity-50"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
