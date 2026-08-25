'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Camera, Loader2, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { StatusChip } from '@/components/ui/patterns'
import { apiPatch, uploadFile, ApiClientError } from '@/lib/fetcher'

/**
 * The identity block at the top of the profile: photo, name, role, status.
 *
 * IT OWNS THE PHOTO. `/api/employee/profile` treats an absent key as "leave it
 * alone", so this control can post `{ photoKey }` on its own and the details
 * form below can post its own fields without either reverting the other. That is
 * also why there is exactly one photo control on the page — two would race.
 *
 * The upload is applied IMMEDIATELY rather than staged behind a Save. A photo is
 * the one field where the preview IS the confirmation, and a stray "unsaved
 * changes" state on an avatar is how people end up with no photo at all.
 */
export function ProfileHero({
  fullName, email, designation, photoUrl, employeeCode, isActive,
}: {
  fullName: string
  email: string
  designation: string | null
  photoUrl: string | null
  employeeCode: string | null
  isActive: boolean
}) {
  const router = useRouter()
  const [photoKey, setPhotoKey] = React.useState(photoUrl)
  const [uploading, setUploading] = React.useState(false)

  async function onPhotoChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setUploading(true)
    try {
      const uploaded = await uploadFile(file, 'photo')
      await apiPatch('/api/employee/profile', { photoKey: uploaded.key })
      setPhotoKey(uploaded.key)
      toast.success('Photo updated')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'That upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="card-surface flex flex-col items-center gap-5 p-6 text-center sm:flex-row sm:items-center sm:p-8 sm:text-left">
      <div className="relative shrink-0">
        <span className="grid size-28 place-items-center overflow-hidden rounded-full border-4 border-card bg-page text-ink-muted shadow-card ring-1 ring-line">
          {uploading ? (
            <Loader2 className="size-7 animate-spin" aria-hidden />
          ) : photoKey ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/files/view?key=${encodeURIComponent(photoKey)}`}
              alt=""
              className="size-full object-cover"
            />
          ) : (
            <UserRound className="size-10" aria-hidden />
          )}
        </span>

        <label
          className="focus-within:ring-2 focus-within:ring-brand-600/70 absolute bottom-1 right-1 grid size-9 cursor-pointer place-items-center rounded-full border border-line bg-card text-ink-muted shadow-sm transition hover:bg-page hover:text-ink"
          title="Change your photo"
        >
          <Camera className="size-4" aria-hidden />
          <span className="sr-only">Change your photo</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="sr-only"
            disabled={uploading}
            onChange={onPhotoChange}
          />
        </label>
      </div>

      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[26px] font-bold tracking-[-0.02em] text-ink">
          {fullName || email}
        </h2>

        <div className="mt-2 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
          <span className="rounded-full bg-page px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted ring-1 ring-inset ring-line">
            Employee
          </span>
          <StatusChip status={isActive ? 'active' : 'inactive'} />
          {employeeCode ? (
            <span className="tabular text-xs text-ink-muted">{employeeCode}</span>
          ) : null}
        </div>

        <p className="mt-2 text-sm text-ink-muted">{designation || 'No job title set'}</p>
        <p className="text-sm text-ink-muted">{email}</p>
      </div>
    </div>
  )
}
