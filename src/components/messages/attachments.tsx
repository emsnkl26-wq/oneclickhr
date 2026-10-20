'use client'

import * as React from 'react'
import { Download, FileText, Mic, Pause, Play, X } from 'lucide-react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { formatDuration, formatSize, type MessageAttachmentView } from '@/lib/messaging-shared'
import { cn } from '@/lib/utils'

/**
 * What is attached to a message: photos, a voice note, or a file.
 *
 * EVERY `src` AND `href` HERE IS A `/api/files/view` URL. The bucket is private
 * and there is no shareable link to anything in it; that route re-verifies the
 * reader and, for a conversation attachment, re-asks the database whether they
 * are in the room — for every role, administrators included. A presigned URL
 * baked into this markup would outlive that check.
 *
 * Images are plain `<img>` rather than `next/image`: the source is an
 * authenticated redirect to a signed URL on a storage host, which the optimizer
 * cannot fetch and should not be asked to cache. `loading="lazy"` and the
 * intrinsic dimensions below do the work the optimizer would have.
 */
export function Attachments({
  attachments,
  mine,
}: {
  attachments: MessageAttachmentView[]
  mine: boolean
}) {
  if (!attachments.length) return null

  const images = attachments.filter((attachment) => attachment.kind === 'image')
  const audio = attachments.filter((attachment) => attachment.kind === 'audio')
  const rest = attachments.filter(
    (attachment) => attachment.kind !== 'image' && attachment.kind !== 'audio'
  )

  return (
    <div className="space-y-2">
      {images.length ? <ImageGrid images={images} /> : null}
      {audio.map((attachment) => (
        <VoiceNote key={attachment.id} attachment={attachment} mine={mine} />
      ))}
      {rest.map((attachment) => (
        <FileChip key={attachment.id} attachment={attachment} />
      ))}
    </div>
  )
}

/**
 * One to four photos, laid out the way every messaging app lays them out:
 * one fills the bubble, two sit side by side, three or more tile into a square
 * grid. Anything past four is a `+N` over the last tile — the rest open in the
 * viewer, and a bubble twelve tiles tall is a bubble nobody can scroll past.
 */
function ImageGrid({ images }: { images: MessageAttachmentView[] }) {
  const [open, setOpen] = React.useState<number | null>(null)
  const shown = images.slice(0, 4)
  const extra = images.length - shown.length

  return (
    <>
      <div
        className={cn(
          'grid gap-1 overflow-hidden rounded-xl',
          shown.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
        )}
      >
        {shown.map((image, index) => (
          <button
            key={image.id}
            type="button"
            onClick={() => setOpen(index)}
            className="focus-ring group relative block overflow-hidden bg-ink/5"
            aria-label={`Open ${image.name}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image.url}
              alt={image.name}
              width={image.width ?? undefined}
              height={image.height ?? undefined}
              loading="lazy"
              decoding="async"
              className={cn(
                'w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]',
                shown.length === 1 ? 'max-h-80 object-contain' : 'aspect-square'
              )}
            />
            {extra > 0 && index === shown.length - 1 ? (
              <span className="absolute inset-0 grid place-items-center bg-charcoal/55 text-lg font-semibold text-white">
                +{extra}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <Lightbox
        images={images}
        index={open}
        onIndexChange={setOpen}
        onClose={() => setOpen(null)}
      />
    </>
  )
}

/**
 * The full-size viewer.
 *
 * A Radix dialog, so focus is trapped, Escape closes it and the thread behind
 * does not scroll under it. Arrow keys move between photos because that is what
 * a viewer with more than one picture in it is for.
 */
function Lightbox({
  images,
  index,
  onIndexChange,
  onClose,
}: {
  images: MessageAttachmentView[]
  index: number | null
  onIndexChange: (next: number) => void
  onClose: () => void
}) {
  const current = index === null ? null : images[index]

  React.useEffect(() => {
    if (index === null) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') onIndexChange((index + 1) % images.length)
      if (event.key === 'ArrowLeft') onIndexChange((index - 1 + images.length) % images.length)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, images.length, onIndexChange])

  if (!current) return null

  return (
    <DialogPrimitive.Root open onOpenChange={(next) => !next && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 animate-fade-in bg-charcoal/90 backdrop-blur-sm" />
        <DialogPrimitive.Content className="fixed inset-0 z-50 flex flex-col p-4 focus:outline-none">
          <DialogPrimitive.Title className="sr-only">{current.name}</DialogPrimitive.Title>
          <div className="flex shrink-0 items-center justify-between gap-3 text-white">
            <p className="min-w-0 truncate text-sm font-medium">
              {current.name}
              {images.length > 1 ? (
                <span className="ml-2 text-white/60">
                  {(index ?? 0) + 1} of {images.length}
                </span>
              ) : null}
            </p>
            <div className="flex shrink-0 items-center gap-1">
              <a
                href={current.downloadUrl}
                className="focus-ring grid size-9 place-items-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                aria-label="Download"
              >
                <Download className="size-[18px]" />
              </a>
              <DialogPrimitive.Close
                className="focus-ring grid size-9 place-items-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                aria-label="Close"
              >
                <X className="size-[18px]" />
              </DialogPrimitive.Close>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={current.url}
              alt={current.name}
              className="max-h-full max-w-full object-contain"
            />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/**
 * A voice note.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE AUDIO IS NOT LOADED UNTIL SOMEBODY PRESSES PLAY                     │
 * │                                                                          │
 * │ `preload="none"` and no `src` until first play. A thread with thirty      │
 * │ voice notes in it would otherwise issue thirty authenticated redirects    │
 * │ and thirty signed-URL fetches on scroll, for recordings nobody asked to   │
 * │ hear — and each one re-runs the membership check that `/api/files/view`   │
 * │ does for a `chat-` key.                                                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The bar is the progress, not a waveform. A real waveform means decoding the
 * whole file in the browser to draw it — which is exactly the fetch the lazy
 * loading above exists to avoid — and it tells the listener nothing the elapsed
 * time does not.
 */
function VoiceNote({
  attachment,
  mine,
}: {
  attachment: MessageAttachmentView
  mine: boolean
}) {
  const audioRef = React.useRef<HTMLAudioElement | null>(null)
  const [armed, setArmed] = React.useState(false)
  const [playing, setPlaying] = React.useState(false)
  const [elapsed, setElapsed] = React.useState(0)

  const total = attachment.durationSeconds ?? 0
  // The recorded length is the browser's own measurement and can be absent on
  // a file that came from elsewhere; once playing, the element knows better.
  const duration = audioRef.current?.duration && Number.isFinite(audioRef.current.duration)
    ? audioRef.current.duration
    : total
  const progress = duration > 0 ? Math.min(100, (elapsed / duration) * 100) : 0

  async function toggle() {
    const element = audioRef.current
    if (!element) return
    if (!armed) {
      element.src = attachment.url
      setArmed(true)
    }
    if (playing) {
      element.pause()
      return
    }
    try {
      await element.play()
    } catch {
      // A browser that refuses playback (no gesture, codec it cannot decode)
      // leaves the control in its resting state rather than a stuck spinner.
      setPlaying(false)
    }
  }

  return (
    <div
      className={cn(
        'flex w-full max-w-[18rem] items-center gap-3 rounded-xl px-3 py-2',
        mine ? 'bg-white/15' : 'bg-page'
      )}
    >
      <button
        type="button"
        onClick={toggle}
        className={cn(
          'focus-ring grid size-9 shrink-0 place-items-center rounded-full transition-colors',
          mine ? 'bg-white/25 text-white hover:bg-white/35' : 'bg-brand-600 text-white hover:bg-brand-700'
        )}
        aria-label={playing ? 'Pause voice message' : 'Play voice message'}
      >
        {playing ? <Pause className="size-4" /> : <Play className="size-4 translate-x-px" />}
      </button>

      <div className="min-w-0 flex-1">
        <div
          className={cn('h-1.5 overflow-hidden rounded-full', mine ? 'bg-white/25' : 'bg-line')}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
        >
          <div
            className={cn('h-full rounded-full transition-[width]', mine ? 'bg-white' : 'bg-brand-600')}
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className={cn('mt-1 flex items-center gap-1 text-[11px]', mine ? 'text-white/80' : 'text-ink-muted')}>
          <Mic className="size-3" aria-hidden />
          {formatDuration(playing || elapsed > 0 ? elapsed : duration)}
        </p>
      </div>

      <audio
        ref={audioRef}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false)
          setElapsed(0)
        }}
        onTimeUpdate={(event) => setElapsed(event.currentTarget.currentTime)}
      />
    </div>
  )
}

/** Anything that is not a photo or a recording: a PDF, a spreadsheet, a video. */
function FileChip({ attachment }: { attachment: MessageAttachmentView }) {
  return (
    <a
      href={attachment.downloadUrl}
      className="focus-ring flex max-w-[20rem] items-center gap-3 rounded-xl border border-line bg-card px-3 py-2 transition-colors hover:bg-page"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-ink">
        <FileText className="size-[18px]" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">{attachment.name}</span>
        <span className="block text-[11px] text-ink-muted">{formatSize(attachment.sizeBytes)}</span>
      </span>
      <Download className="size-4 shrink-0 text-ink-muted" aria-hidden />
    </a>
  )
}
