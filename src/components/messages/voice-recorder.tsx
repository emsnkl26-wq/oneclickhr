'use client'

import * as React from 'react'
import { Mic, Square, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { formatDuration } from '@/lib/messaging-shared'
import { cn } from '@/lib/utils'

/**
 * Record a voice note in the composer.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHAT THE BROWSER ACTUALLY GIVES US                                      │
 * │                                                                          │
 * │ `MediaRecorder` does not let us choose a codec; it offers a short list    │
 * │ and every engine's list is different. Chrome and Firefox produce Opus     │
 * │ inside a WebM container, which sniffs as `video/webm` with no video       │
 * │ track in it. Safari produces `audio/mp4`. So the type is NEGOTIATED       │
 * │ below rather than asserted, and `isVoiceMime` on the server admits every  │
 * │ container this list can yield — a rule written as "audio/*" would reject  │
 * │ every recording Chrome makes.                                            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * THE TRACKS ARE STOPPED ON EVERY EXIT PATH — finish, cancel, unmount, and a
 * failure part-way through. A `MediaStreamTrack` left live keeps the browser's
 * recording indicator lit and the microphone held open after the composer has
 * gone, which reads as the app listening when it is not.
 *
 * There is no waveform while recording. A live meter means an AudioContext and
 * an animation frame loop for the entire recording, to tell somebody something
 * the running timer already tells them.
 */

/** In preference order. The first the engine admits to supporting wins. */
const CANDIDATE_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  'audio/aac',
]

/** A hard stop, so a forgotten tab cannot record for an hour. */
const MAX_SECONDS = 5 * 60

export interface Recording {
  file: File
  durationSeconds: number
}

export function VoiceRecorder({
  onRecorded,
  disabled,
}: {
  onRecorded: (recording: Recording) => void
  disabled?: boolean
}) {
  const [recording, setRecording] = React.useState(false)
  const [seconds, setSeconds] = React.useState(0)

  const recorder = React.useRef<MediaRecorder | null>(null)
  const chunks = React.useRef<BlobPart[]>([])
  const stream = React.useRef<MediaStream | null>(null)
  const ticker = React.useRef<ReturnType<typeof setInterval> | null>(null)
  // Set by Cancel, read by `onstop` — which fires for both finishing and
  // cancelling and otherwise could not tell them apart.
  const cancelled = React.useRef(false)
  /*
   * The elapsed count, as a ref as well as state.
   *
   * `onstop` is assigned once, when recording begins, so it closes over the
   * `seconds` of that render — which is zero, forever. Every voice note would
   * have been stamped one second long. The ref is what the handler reads; the
   * state is only what the timer draws.
   */
  const elapsed = React.useRef(0)

  const release = React.useCallback(() => {
    if (ticker.current) {
      clearInterval(ticker.current)
      ticker.current = null
    }
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
    recorder.current = null
    chunks.current = []
    elapsed.current = 0
    setRecording(false)
    setSeconds(0)
  }, [])

  // Leaving the page mid-recording must not leave the microphone open.
  React.useEffect(() => release, [release])

  async function start() {
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      toast.error('This browser cannot record audio.')
      return
    }

    let media: MediaStream
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      // Denied, or no microphone. Both are the person's own setting to change,
      // so the message says what to do rather than what failed.
      toast.error('Allow microphone access to record a voice message.')
      return
    }

    const mimeType = CANDIDATE_TYPES.find((type) => MediaRecorder.isTypeSupported(type))
    let instance: MediaRecorder
    try {
      instance = new MediaRecorder(media, mimeType ? { mimeType } : undefined)
    } catch {
      media.getTracks().forEach((track) => track.stop())
      toast.error('This browser cannot record audio.')
      return
    }

    cancelled.current = false
    chunks.current = []
    stream.current = media
    recorder.current = instance

    instance.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.current.push(event.data)
    }

    instance.onstop = () => {
      const parts = chunks.current
      const recordedFor = elapsed.current
      const wasCancelled = cancelled.current
      // The container the recorder actually used, not the one we asked for.
      const type = instance.mimeType || mimeType || 'audio/webm'
      release()
      if (wasCancelled || !parts.length) return

      const extension = extensionFor(type)
      const file = new File([new Blob(parts, { type })], `voice-message.${extension}`, { type })
      onRecorded({ file, durationSeconds: Math.max(1, recordedFor) })
    }

    // A timeslice, so a long recording arrives in pieces rather than as one
    // allocation at the end — and so a crashed tab loses seconds, not minutes.
    instance.start(1000)
    setRecording(true)
    setSeconds(0)
    elapsed.current = 0

    ticker.current = setInterval(() => {
      elapsed.current += 1
      setSeconds(elapsed.current)
      if (elapsed.current >= MAX_SECONDS) {
        // Reaching the cap FINISHES the recording rather than discarding it.
        recorder.current?.stop()
      }
    }, 1000)
  }

  function finish() {
    cancelled.current = false
    recorder.current?.stop()
  }

  function cancel() {
    cancelled.current = true
    recorder.current?.stop()
  }

  if (!recording) {
    return (
      <button
        type="button"
        onClick={start}
        disabled={disabled}
        className="focus-ring grid size-9 shrink-0 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-page hover:text-ink disabled:opacity-50"
        aria-label="Record a voice message"
      >
        <Mic className="size-[18px]" />
      </button>
    )
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg bg-danger/10 px-3 py-1.5">
      <span className="size-2 shrink-0 animate-pulse rounded-full bg-danger" aria-hidden />
      <span className="shrink-0 font-mono text-[13px] tabular-nums text-ink">
        {formatDuration(seconds)}
      </span>
      <span className="min-w-0 flex-1 truncate text-[12px] text-ink-muted">
        Recording — press stop to attach
      </span>
      <button
        type="button"
        onClick={cancel}
        className="focus-ring grid size-8 shrink-0 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-card hover:text-danger"
        aria-label="Discard recording"
      >
        <Trash2 className="size-4" />
      </button>
      <button
        type="button"
        onClick={finish}
        className={cn(
          'focus-ring grid size-8 shrink-0 place-items-center rounded-lg bg-brand-600 text-white transition-colors hover:bg-brand-700'
        )}
        aria-label="Stop and attach recording"
      >
        <Square className="size-3.5 fill-current" />
      </button>
    </div>
  )
}

function extensionFor(mimeType: string): string {
  const type = mimeType.toLowerCase()
  if (type.includes('ogg')) return 'ogg'
  if (type.includes('mp4') || type.includes('aac')) return 'm4a'
  return 'webm'
}
