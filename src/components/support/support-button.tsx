'use client'

/**
 * The bottom-right "Support" button.
 *
 * DELIBERATELY NOT THE HELP DESK. `/org/helpdesk` is the workspace's own queue,
 * where an employee asks their HR team something. This goes to US: a bug, a
 * feature request, a billing question — everything that previously had no route
 * out of the product except finding an email address.
 *
 * It captures the page somebody was on when they hit the problem, which saves
 * the first round trip of nearly every support conversation. That value is only
 * sent, never displayed back — the super-admin console renders it as text, never
 * as a link, because a form that can plant a clickable URL in an admin's browser
 * is a phishing vector aimed at ourselves.
 *
 * Fixed rather than sticky, and above the content: it has to be reachable from
 * the bottom of a long page, which is exactly where people give up.
 */

import * as React from 'react'
import { usePathname } from 'next/navigation'
import { LifeBuoy, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogBody, DialogFooter,
} from '@/components/ui/primitives'
import { apiPost, ApiClientError } from '@/lib/fetcher'

const CATEGORIES = [
  { value: 'bug', label: 'Something is broken' },
  { value: 'feature', label: 'I would like a feature' },
  { value: 'billing', label: 'Billing or subscription' },
  { value: 'account', label: 'My account or workspace' },
  { value: 'other', label: 'Something else' },
] as const

export function SupportButton() {
  const pathname = usePathname()
  const [open, setOpen] = React.useState(false)
  const [category, setCategory] = React.useState<string>('bug')
  const [subject, setSubject] = React.useState('')
  const [message, setMessage] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [fields, setFields] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)

  function reset() {
    setCategory('bug')
    setSubject('')
    setMessage('')
    setError(null)
    setFields({})
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setFields({})
    setBusy(true)
    try {
      await apiPost('/api/support', {
        category,
        subject,
        message,
        // Where they were when they hit it. The path only — never the query
        // string, which routinely carries names and ids that have no business
        // in a support record.
        pageUrl: pathname,
      })
      toast.success('Thank you — your message is with us')
      setOpen(false)
      reset()
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message)
        setFields(err.fields ?? {})
      } else {
        setError('That could not be sent. Please try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="focus-ring fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-brand-600 px-4 py-3 text-sm font-medium text-white shadow-pop transition hover:bg-brand-700"
      >
        <LifeBuoy className="size-4" aria-hidden />
        <span className="hidden sm:inline">Support</span>
        <span className="sr-only sm:hidden">Contact support</span>
      </button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) reset()
        }}
      >
        <DialogContent>
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>Contact support</DialogTitle>
              <DialogDescription>
                This goes straight to the Oneclickhr team. For something your own HR team handles,
                use the Help desk instead.
              </DialogDescription>
            </DialogHeader>

            <DialogBody className="space-y-4">
              <FormError message={error} />

              <FormField label="What is this about?" error={fields.category}>
                <Select value={category} onChange={(event) => setCategory(event.target.value)}>
                  {CATEGORIES.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </Select>
              </FormField>

              <FormField label="Subject" error={fields.subject} required>
                <Input
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  placeholder="A short summary"
                  required
                />
              </FormField>

              <FormField
                label="Message"
                error={fields.message}
                required
                hint="What you expected, what happened, and anything we would need to reproduce it."
              >
                <Textarea
                  rows={6}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  required
                />
              </FormField>

              <p className="text-xs text-ink-muted">
                We will see your name, your email address and the page you are on
                (<span className="tabular">{pathname}</span>) so we can follow it up.
              </p>
            </DialogBody>

            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setOpen(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button type="submit" loading={busy}>
                <Send />
                Send
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
