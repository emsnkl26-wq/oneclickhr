'use client'

/**
 * One renderer for every field the wizard has.
 *
 * The step config in src/lib/onboarding.ts says WHAT a field is; this says how
 * it looks. Keeping the two apart is what stops the form and the review screen
 * from drifting: both read the same config, and a new field needs no new
 * component unless it is a genuinely new kind of control.
 */

import * as React from 'react'
import { Eye, EyeOff, FileUp, Loader2, Lock, Plus, Trash2, UserRound, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea, DateField } from '@/components/ui/input'
import { FormField } from '@/components/ui/form-field'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/primitives'
import { apiPost, uploadFile, ApiClientError } from '@/lib/fetcher'
import { cn } from '@/lib/utils'
import {
  countryLabel, payRateLabel,
  type AdditionalDoc, type DraftFieldKey, type FieldDef, type OnboardingDraft,
} from '@/lib/onboarding'

export interface Person {
  id: string
  full_name: string | null
  email: string | null
}

export interface FieldContext {
  departments: { id: string; name: string }[]
  managers: Person[]
  currencySymbol: string
  /** Last four digits of an already-saved bank account, if any. */
  accountLast4: string | null
  onDepartmentCreated: (department: { id: string; name: string }) => void
  /** Uploads in flight — the wizard blocks "Complete" while any is running. */
  onBusyChange: (key: string, busy: boolean) => void
  /**
   * The confirm-account-number box disagrees with the account number. Reported
   * upward because a mismatched number must not be saved — and the save buttons
   * live in the wizard's action bar, not in this field.
   */
  onAccountMismatch: (mismatch: boolean) => void
}

export interface FieldProps {
  field: FieldDef
  draft: OnboardingDraft
  error?: string
  /** Every scalar field is a string in the wizard — dates and money included. */
  set: (key: DraftFieldKey, value: string) => void
  setDocs: (docs: AdditionalDoc[]) => void
  ctx: FieldContext
}

/* -------------------------------------------------------------- Info banner */

export function InfoBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-line bg-page px-3.5 py-3 text-[13px] leading-relaxed text-ink-muted">
      <svg
        viewBox="0 0 24 24"
        className="mt-0.5 size-4 shrink-0 text-info"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4M12 8h.01" strokeLinecap="round" />
      </svg>
      <span>{children}</span>
    </div>
  )
}

/* ------------------------------------------------------------------- Switch */

export function WizardField(props: FieldProps) {
  const { field } = props
  switch (field.type) {
    case 'select':
      return <SelectField {...props} />
    case 'textarea':
      return <TextareaField {...props} />
    case 'currency':
      return <CurrencyField {...props} />
    case 'department':
      return <DepartmentField {...props} />
    case 'manager':
      return <ManagerField {...props} />
    case 'account':
      return <AccountField {...props} />
    case 'photo':
      return <PhotoField {...props} />
    case 'file':
      return <SingleFileField {...props} />
    case 'files':
      return <MultiFileField {...props} />
    default:
      return <TextField {...props} />
  }
}

/** The admin-only marker. Says plainly who can read a value, next to the label. */
function AdminOnly() {
  return (
    <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-page px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
      <Lock className="size-2.5" aria-hidden />
      Admin only
    </span>
  )
}

function labelOf(field: FieldDef, draft: OnboardingDraft): string {
  return field.key === 'payRate' ? payRateLabel(draft.payType) : field.label
}

function Wrap({
  field, draft, error, children,
}: FieldProps & { children: React.ReactNode }) {
  return (
    <FormField
      label={labelOf(field, draft)}
      required={field.required}
      error={error}
      hint={field.hint}
    >
      {children as React.ReactElement}
    </FormField>
  )
}

/* --------------------------------------------------------------- Text-alike */

const INPUT_TYPES: Partial<Record<FieldDef['type'], string>> = {
  email: 'email',
  tel: 'tel',
}

/** The scalar value behind a field. `additionalDocs` never reaches these. */
function scalar(draft: OnboardingDraft, field: FieldDef): string {
  return field.key === 'additionalDocs' ? '' : draft[field.key]
}

function TextField(props: FieldProps) {
  const { field, draft, set } = props

  // Dates get the app's own calendar rather than whatever the browser draws.
  if (field.type === 'date') {
    return (
      <Wrap {...props}>
        <DateField
          value={scalar(draft, field)}
          placeholder={field.placeholder}
          onChange={(e) => set(field.key as DraftFieldKey, e.target.value)}
        />
      </Wrap>
    )
  }

  return (
    <Wrap {...props}>
      <Input
        type={INPUT_TYPES[field.type] ?? 'text'}
        value={scalar(draft, field)}
        placeholder={field.placeholder}
        onChange={(e) => set(field.key as DraftFieldKey, e.target.value)}
        autoComplete="off"
      />
    </Wrap>
  )
}

function SelectField(props: FieldProps) {
  const { field, draft, set } = props
  const isCountry = field.key === 'country'
  return (
    <Wrap {...props}>
      <Select
        value={scalar(draft, field)}
        onChange={(e) => set(field.key as DraftFieldKey, e.target.value)}
      >
        <option value="">Select…</option>
        {(field.options ?? []).map((option) => (
          <option key={option} value={option}>
            {isCountry ? countryLabel(option) : option}
          </option>
        ))}
      </Select>
    </Wrap>
  )
}

function TextareaField(props: FieldProps) {
  const { field, draft, error, set } = props
  return (
    <FormField
      label={
        <>
          {field.label}
          {field.adminOnly ? <AdminOnly /> : null}
        </>
      }
      hint={field.hint}
      error={error}
    >
      <Textarea
        value={scalar(draft, field)}
        rows={3}
        onChange={(e) => set(field.key as DraftFieldKey, e.target.value)}
      />
    </FormField>
  )
}

function CurrencyField(props: FieldProps) {
  const { draft, set, ctx } = props
  return (
    <Wrap {...props}>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-muted">
          {ctx.currencySymbol}
        </span>
        <Input
          type="number"
          min="0"
          step="0.01"
          className="pl-7"
          value={draft.payRate}
          onChange={(e) => set('payRate', e.target.value)}
          placeholder={draft.payType === 'Hourly' ? '28.50' : '72000'}
        />
      </div>
    </Wrap>
  )
}

/* ------------------------------------------------------------- Relationships */

function DepartmentField(props: FieldProps) {
  const { draft, set, ctx } = props
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  async function create() {
    setSaving(true)
    try {
      const created = await apiPost<{ id: string; name: string }>('/api/org/departments', {
        name: name.trim(),
      })
      ctx.onDepartmentCreated(created)
      set('departmentId', created.id)
      setOpen(false)
      setName('')
      toast.success(`${created.name} added`)
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'That department could not be added')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Wrap {...props}>
        <div className="flex gap-2">
          <Select
            value={draft.departmentId}
            onChange={(e) => set('departmentId', e.target.value)}
            className="flex-1"
          >
            <option value="">Select…</option>
            {ctx.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            aria-label="Add a department"
            onClick={() => setOpen(true)}
          >
            <Plus />
          </Button>
        </div>
      </Wrap>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Add a department</DialogTitle>
            <DialogDescription>
              It becomes available everywhere in your workspace straight away.
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 pb-2">
            <FormField label="Department name" required>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nursing"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && name.trim().length >= 2) create()
                }}
              />
            </FormField>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={create} loading={saving} disabled={name.trim().length < 2}>
              Add department
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * The manager picker.
 *
 * It used to pair a separate search box with a `<select>`, because a native
 * dropdown cannot filter itself. Our `Select` does — it grows a filter box once
 * the list is long — so the extra input, the query state and the "keep the
 * current pick visible" special case all went away with it.
 */
function ManagerField(props: FieldProps) {
  const { draft, set, ctx } = props

  return (
    <Wrap {...props}>
      <Select
        value={draft.reportingManagerId}
        onChange={(e) => set('reportingManagerId', e.target.value)}
        placeholder="No reporting manager"
      >
        <option value="">No reporting manager</option>
        {ctx.managers.map((m) => (
          <option key={m.id} value={m.id}>
            {m.full_name || m.email}
          </option>
        ))}
      </Select>
    </Wrap>
  )
}

/* ---------------------------------------------------------------- Bank field */

/**
 * The account number, masked by default.
 *
 * Once saved, the server will only ever tell us the last four digits — so a
 * returning draft shows `•••• 4821` and an empty input. Typing a new number
 * replaces it; leaving it blank keeps what is stored.
 */
function AccountField(props: FieldProps) {
  const { draft, error, set, ctx } = props
  const [shown, setShown] = React.useState(false)
  const [confirm, setConfirm] = React.useState('')

  // An unconfirmed number counts as a mismatch: a save must never persist a
  // number nobody typed twice. An EMPTY account number is fine — it just means
  // "no bank details", or "keep what is already stored".
  const unconfirmed = draft.accountNumber.length > 0 && confirm !== draft.accountNumber
  const showError = unconfirmed && confirm.length > 0

  const { onAccountMismatch } = ctx
  React.useEffect(() => {
    onAccountMismatch(unconfirmed)
    return () => onAccountMismatch(false)
  }, [unconfirmed, onAccountMismatch])

  return (
    <div className="space-y-4">
      <FormField
        label="Account number"
        error={error}
        hint={
          ctx.accountLast4 && !draft.accountNumber
            ? `Saved — ending •••• ${ctx.accountLast4}. Type a new number to replace it.`
            : undefined
        }
      >
        <div className="relative">
          <Input
            type={shown ? 'text' : 'password'}
            value={draft.accountNumber}
            onChange={(e) => set('accountNumber', e.target.value)}
            className="pr-10"
            autoComplete="off"
            placeholder={ctx.accountLast4 ? '•••••••••••' : ''}
          />
          <button
            type="button"
            onClick={() => setShown((v) => !v)}
            aria-label={shown ? 'Hide account number' : 'Show account number'}
            className="focus-ring absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-muted hover:text-ink"
          >
            {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </FormField>

      {draft.accountNumber ? (
        <FormField
          label="Confirm account number"
          error={showError ? 'The account numbers do not match' : undefined}
          hint={confirm ? undefined : 'Type it once more to confirm.'}
        >
          <Input
            type={shown ? 'text' : 'password'}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="off"
          />
        </FormField>
      ) : null}
    </div>
  )
}

/* -------------------------------------------------------------------- Files */

function humanSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function PhotoField(props: FieldProps) {
  const { draft, set, ctx } = props
  const [busy, setBusy] = React.useState(false)

  async function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setBusy(true)
    ctx.onBusyChange('photoUrl', true)
    try {
      const result = await uploadFile(file, 'photo')
      set('photoUrl', result.key)
      toast.success('Photo uploaded')
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'The photo could not be uploaded')
    } finally {
      setBusy(false)
      ctx.onBusyChange('photoUrl', false)
    }
  }

  return (
    <div className="flex items-center gap-5">
      <span className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-full border border-line bg-page text-ink-muted">
        {busy ? (
          <Loader2 className="size-5 animate-spin" />
        ) : draft.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/files/view?key=${encodeURIComponent(draft.photoUrl)}`}
            alt=""
            className="size-full object-cover"
          />
        ) : (
          <UserRound className="size-7" />
        )}
      </span>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-card px-3.5 py-2 text-sm font-medium shadow-sm transition hover:bg-page">
            <FileUp className="size-4" />
            {draft.photoUrl ? 'Change photo' : 'Upload photo'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="sr-only"
              onChange={onChange}
              disabled={busy}
            />
          </label>
          {draft.photoUrl ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => set('photoUrl', '')}>
              <X />
              Remove
            </Button>
          ) : null}
        </div>
        <p className="mt-1.5 text-xs text-ink-muted">
          Square images look best — they are shown as a circle across the app. PNG, JPEG, WebP or
          GIF, up to 5MB.
        </p>
      </div>
    </div>
  )
}

/** Which upload purpose a document field maps to in the existing R2 pipeline. */
const FILE_PURPOSE: Record<string, 'work_auth' | 'employee_doc'> = {
  authDocumentUrl: 'work_auth',
}

function SingleFileField(props: FieldProps) {
  const { field, draft, set, ctx } = props
  const key = field.key as DraftFieldKey
  const stored = scalar(draft, field)
  const [busy, setBusy] = React.useState(false)
  const [name, setName] = React.useState<string | null>(null)
  const [size, setSize] = React.useState<number | null>(null)

  async function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setBusy(true)
    ctx.onBusyChange(key, true)
    try {
      const result = await uploadFile(file, FILE_PURPOSE[key] ?? 'employee_doc')
      set(key, result.key)
      setName(file.name)
      setSize(file.size)
      toast.success(`${field.label} uploaded`)
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'That file could not be uploaded')
    } finally {
      setBusy(false)
      ctx.onBusyChange(key, false)
    }
  }

  return (
    <div className="space-y-1.5">
      <p className="text-[13px] font-medium text-ink">{field.label}</p>
      {stored ? (
        <div className="flex items-center gap-3 rounded-lg border border-line bg-page px-3.5 py-2.5">
          <FileUp className="size-4 shrink-0 text-ink-muted" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-sm">{name ?? 'Uploaded file'}</span>
          {size ? (
            <span className="tabular shrink-0 text-xs text-ink-muted">{humanSize(size)}</span>
          ) : null}
          <a
            href={`/api/files/view?key=${encodeURIComponent(stored)}`}
            target="_blank"
            rel="noreferrer"
            className="focus-ring shrink-0 rounded text-xs font-medium text-brand-600 hover:underline"
          >
            View
          </a>
          <button
            type="button"
            aria-label={`Remove ${field.label}`}
            onClick={() => {
              set(key, '')
              setName(null)
              setSize(null)
            }}
            className="focus-ring shrink-0 rounded p-1 text-ink-muted hover:text-danger"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      ) : (
        <label
          className={cn(
            'flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-line px-4 py-3 text-sm text-ink-muted transition hover:border-brand-200 hover:bg-brand-50/40',
            busy && 'pointer-events-none opacity-60'
          )}
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin text-brand-600" />
          ) : (
            <FileUp className="size-4" />
          )}
          {busy ? 'Uploading…' : `Upload ${field.label.toLowerCase()}`}
          <input type="file" className="sr-only" onChange={onChange} disabled={busy} />
        </label>
      )}
      {field.hint ? <p className="text-xs text-ink-muted">{field.hint}</p> : null}
    </div>
  )
}

function MultiFileField(props: FieldProps) {
  const { field, draft, setDocs, ctx } = props
  const [busy, setBusy] = React.useState(false)

  async function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!files.length) return
    setBusy(true)
    ctx.onBusyChange('additionalDocs', true)
    try {
      const added: AdditionalDoc[] = []
      for (const file of files) {
        const result = await uploadFile(file, 'employee_doc')
        added.push({ key: result.key, fileName: file.name, label: null, sizeBytes: file.size })
      }
      setDocs([...draft.additionalDocs, ...added])
      toast.success(files.length === 1 ? 'Document uploaded' : `${files.length} documents uploaded`)
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'That file could not be uploaded')
    } finally {
      setBusy(false)
      ctx.onBusyChange('additionalDocs', false)
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-[13px] font-medium text-ink">{field.label}</p>

      {draft.additionalDocs.length ? (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {draft.additionalDocs.map((doc, index) => (
            <li key={doc.key} className="flex flex-wrap items-center gap-3 px-3.5 py-2.5">
              <span className="min-w-0 flex-1 truncate text-sm">{doc.fileName}</span>
              <Input
                value={doc.label ?? ''}
                placeholder="Label (optional)"
                aria-label={`Label for ${doc.fileName}`}
                className="h-8 w-full text-[13px] sm:w-44"
                onChange={(e) =>
                  setDocs(
                    draft.additionalDocs.map((d, i) =>
                      i === index ? { ...d, label: e.target.value || null } : d
                    )
                  )
                }
              />
              {doc.sizeBytes ? (
                <span className="tabular shrink-0 text-xs text-ink-muted">
                  {humanSize(doc.sizeBytes)}
                </span>
              ) : null}
              <button
                type="button"
                aria-label={`Remove ${doc.fileName}`}
                onClick={() => setDocs(draft.additionalDocs.filter((_, i) => i !== index))}
                className="focus-ring shrink-0 rounded p-1 text-ink-muted hover:text-danger"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <label
        className={cn(
          'flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-line px-4 py-3 text-sm text-ink-muted transition hover:border-brand-200 hover:bg-brand-50/40',
          busy && 'pointer-events-none opacity-60'
        )}
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin text-brand-600" />
        ) : (
          <FileUp className="size-4" />
        )}
        {busy ? 'Uploading…' : 'Upload documents'}
        <input type="file" multiple className="sr-only" onChange={onChange} disabled={busy} />
      </label>
    </div>
  )
}
