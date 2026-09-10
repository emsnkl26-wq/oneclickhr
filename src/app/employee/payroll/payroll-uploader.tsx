'use client'

/**
 * A month at a time: was I paid, and did I tell them so?
 *
 * The list is built from the CALENDAR, not from what has been uploaded, so a
 * month nobody has confirmed shows up as an empty row rather than being absent.
 * A list of what you have already done cannot tell you what you have missed.
 *
 * Verified months are locked, and the guard trigger in 026 refuses the write
 * anyway — re-uploading over a confirmation somebody has already checked would
 * silently invalidate their check.
 */

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Clock, Download, FileUp, Loader2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Textarea, DateField } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import { StatusChip } from '@/components/ui/patterns'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogBody, DialogFooter,
} from '@/components/ui/primitives'
import { apiPost, uploadFile, ApiClientError } from '@/lib/fetcher'

export interface ConfirmationRow {
  id: string
  month: number
  year: number
  amount: number | string | null
  currency: string | null
  paid_on: string | null
  file_url: string | null
  file_name: string | null
  note: string | null
  status: 'pending' | 'submitted' | 'verified' | 'rejected'
  review_note: string | null
  verified_at: string | null
}

export interface PayslipRow {
  id: string
  month: number
  year: number
  file_url: string
  file_name: string | null
  created_at: string
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const label = (month: number, year: number) => `${MONTHS[month - 1]} ${year}`

export function PayrollUploader({
  periods, confirmations, payslips,
}: {
  periods: Array<{ month: number; year: number }>
  confirmations: ConfirmationRow[]
  payslips: PayslipRow[]
}) {
  const [uploading, setUploading] = React.useState<{ month: number; year: number } | null>(null)

  const byPeriod = new Map(confirmations.map((row) => [`${row.year}-${row.month}`, row]))

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Payment confirmations</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y divide-line">
            {periods.map(({ month, year }) => {
              const row = byPeriod.get(`${year}-${month}`)
              const done = row?.status === 'verified'

              return (
                <li
                  key={`${year}-${month}`}
                  className="flex flex-wrap items-center gap-3 px-5 py-3.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{label(month, year)}</p>
                    <p className="text-[13px] text-ink-muted">
                      {row?.status === 'verified'
                        ? 'Confirmed by your organization'
                        : row?.status === 'submitted'
                          ? 'Waiting for your organization to check it'
                          : row?.status === 'rejected'
                            ? row.review_note || 'Returned — please upload it again'
                            : 'Nothing uploaded yet'}
                    </p>
                  </div>

                  {row?.status ? <PaymentStatus status={row.status} /> : null}

                  {row?.file_url ? (
                    <Button asChild size="sm" variant="ghost">
                      <a
                        href={`/api/files/view?key=${encodeURIComponent(row.file_url)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Download />
                        View
                      </a>
                    </Button>
                  ) : null}

                  <Button
                    size="sm"
                    variant={row?.file_url ? 'secondary' : 'default'}
                    disabled={done}
                    onClick={() => setUploading({ month, year })}
                    title={done ? 'This month has been confirmed and is now locked.' : undefined}
                  >
                    <FileUp />
                    {row?.file_url ? 'Replace' : 'Upload'}
                  </Button>
                </li>
              )
            })}
          </ul>
        </CardContent>
      </Card>

      {payslips.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Earlier payslips</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-line">
              {payslips.map((slip) => (
                <li key={slip.id} className="flex items-center gap-3 px-5 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {label(slip.month, slip.year)}
                  </span>
                  <Button asChild size="icon" variant="ghost" aria-label="Download">
                    <a
                      href={`/api/files/view?key=${encodeURIComponent(slip.file_url)}&download=${encodeURIComponent(
                        slip.file_name || 'payslip.pdf'
                      )}`}
                    >
                      <Download />
                    </a>
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <UploadDialog
        period={uploading}
        existing={uploading ? byPeriod.get(`${uploading.year}-${uploading.month}`) ?? null : null}
        onClose={() => setUploading(null)}
      />
    </div>
  )
}

function PaymentStatus({ status }: { status: ConfirmationRow['status'] }) {
  if (status === 'verified') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] text-emerald-600">
        <CheckCircle2 className="size-4" aria-hidden />
        Confirmed
      </span>
    )
  }
  if (status === 'rejected') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] text-danger">
        <XCircle className="size-4" aria-hidden />
        Returned
      </span>
    )
  }
  if (status === 'submitted') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-muted">
        <Clock className="size-4" aria-hidden />
        Submitted
      </span>
    )
  }
  return <StatusChip status="pending" label="Pending" />
}

function UploadDialog({
  period, existing, onClose,
}: {
  period: { month: number; year: number } | null
  existing: ConfirmationRow | null
  onClose: () => void
}) {
  const router = useRouter()
  const [file, setFile] = React.useState<File | null>(null)
  const [amount, setAmount] = React.useState('')
  const [currency, setCurrency] = React.useState('')
  const [paidOn, setPaidOn] = React.useState('')
  const [note, setNote] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!period) return
    setError(null)
    setBusy(false)
    setFile(null)
    setAmount(existing?.amount == null ? '' : String(existing.amount))
    setCurrency(existing?.currency ?? '')
    setPaidOn(existing?.paid_on ?? '')
    setNote(existing?.note ?? '')
  }, [period, existing])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!period) return
    if (!file && !existing?.file_url) {
      setError('Attach the confirmation you received.')
      return
    }

    setError(null)
    setBusy(true)
    try {
      /*
       * Re-uploading is optional when a document is already attached: somebody
       * correcting the amount they typed should not have to find the screenshot
       * again. The previous key is reused in that case.
       */
      const key = file
        ? (await uploadFile(file, 'payment_proof')).key
        : existing!.file_url!

      await apiPost('/api/employee/payments', {
        month: period.month,
        year: period.year,
        amount: amount === '' ? '' : Number(amount),
        currency: currency || '',
        paidOn: paidOn || null,
        fileKey: key,
        fileName: file?.name ?? existing?.file_name ?? undefined,
        note: note || undefined,
      })

      toast.success(`${label(period.month, period.year)} confirmed`)
      onClose()
      router.refresh()
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : 'That could not be saved. Please try again.'
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={!!period} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>
              {period ? label(period.month, period.year) : 'Payment'} confirmation
            </DialogTitle>
            <DialogDescription>
              Upload the payment advice, bank statement line or screenshot showing you received
              this month&rsquo;s salary.
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-4">
            <FormError message={error} />

            {existing?.status === 'rejected' && existing.review_note ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 text-[13px] text-amber-800">
                <p className="font-medium">Your organization returned this</p>
                <p className="mt-0.5">{existing.review_note}</p>
              </div>
            ) : null}

            <FormField
              label="Confirmation document"
              required={!existing?.file_url}
              hint={
                existing?.file_url
                  ? `Currently: ${existing.file_name || 'attached'}. Choose a file only if you want to replace it.`
                  : 'A PDF or an image, up to 15MB.'
              }
            >
              <input
                type="file"
                accept="application/pdf,image/*"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                className="block w-full text-sm text-ink-muted file:mr-3 file:rounded-lg file:border-0 file:bg-page file:px-3 file:py-2 file:text-sm file:font-medium file:text-ink hover:file:bg-line/40"
              />
            </FormField>

            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label="Amount received" hint="Optional.">
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </FormField>
              <FormField label="Currency">
                <Input
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value.toUpperCase())}
                  maxLength={3}
                  placeholder="USD"
                />
              </FormField>
              <FormField label="Received on">
                <DateField value={paidOn} onChange={(event) => setPaidOn(event.target.value)} />
              </FormField>
            </div>

            <FormField label="Note" hint="Anything your organization should know.">
              <Textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
            </FormField>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <FileUp />}
              Confirm payment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
