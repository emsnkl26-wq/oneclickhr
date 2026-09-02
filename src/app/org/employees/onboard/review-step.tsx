'use client'

/**
 * The last step — the read-only summary.
 *
 * Rendered from the same step config as the form, so a field can never be
 * collected and then quietly left out of the review. Each card header is a
 * button back to its step: the fastest fix for "that date is wrong" is one
 * click from where you noticed it.
 *
 * WHICH steps is a prop (014). The org reviews all five; the employee reviews
 * the four they were asked to fill in. Passing the config in rather than
 * writing a second summary component is what keeps the two honest — a field
 * added to `ONBOARDING_STEPS` shows up in whichever reviews contain its step,
 * with no second place to remember.
 */

import * as React from 'react'
import { AlertCircle, Check, Lock, Pencil } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  countryLabel, payRateLabel, visibleSections,
  ONBOARDING_STEPS, type FieldDef, type OnboardingDraft, type StepDef,
} from '@/lib/onboarding'
import type { Person } from './step-fields'

export interface ReviewContext {
  departments: { id: string; name: string }[]
  managers: Person[]
  currencySymbol: string
  accountLast4: string | null
}

export function ReviewStep({
  draft, errorCounts, onJump, ctx, steps = ONBOARDING_STEPS, title, intro,
}: {
  draft: OnboardingDraft
  errorCounts: Record<number, number>
  onJump: (step: number) => void
  ctx: ReviewContext
  /** Which steps to summarise. Defaults to the organization's full set. */
  steps?: StepDef[]
  title?: string
  intro?: string
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[20px] font-bold tracking-[-0.02em]">
          {title ?? 'Let’s review everything'}
        </h2>
        <p className="mt-1.5 text-sm text-ink-muted">
          {intro ??
            'Here’s a summary of the employee details. Make sure everything looks good before completing.'}
        </p>
      </div>

      {steps.map((step) => {
        const errors = errorCounts[step.index] ?? 0
        return (
          <section key={step.index} className="card-surface overflow-hidden">
            <button
              type="button"
              onClick={() => onJump(step.index)}
              className="focus-ring group flex w-full items-center gap-3 border-b border-line bg-page/50 px-5 py-3.5 text-left transition hover:bg-page"
            >
              <span
                className={cn(
                  'grid size-6 shrink-0 place-items-center rounded-full',
                  errors ? 'bg-brand-50 text-brand-700' : 'bg-emerald-50 text-emerald-600'
                )}
                aria-hidden
              >
                {errors ? <AlertCircle className="size-3.5" /> : <Check className="size-3.5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold">{step.title}</span>
                <span
                  className={cn(
                    'block text-xs',
                    errors ? 'font-medium text-danger' : 'text-ink-muted'
                  )}
                >
                  {errors
                    ? `${errors} required field${errors === 1 ? '' : 's'} still to fill in`
                    : 'Complete'}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-ink-muted transition group-hover:text-brand-600">
                <Pencil className="size-3.5" aria-hidden />
                Edit
              </span>
            </button>

            <dl className="grid gap-x-8 gap-y-4 px-5 py-5 sm:grid-cols-2">
              {visibleSections(step, draft).flatMap((section) =>
                section.fields.map((field) => (
                  <ReviewRow key={String(field.key)} field={field} draft={draft} ctx={ctx} />
                ))
              )}
            </dl>
          </section>
        )
      })}
    </div>
  )
}

function ReviewRow({
  field, draft, ctx,
}: {
  field: FieldDef
  draft: OnboardingDraft
  ctx: ReviewContext
}) {
  const value = displayValue(field, draft, ctx)
  const missing = !value

  return (
    <div className="min-w-0">
      <dt className="flex items-center text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
        {field.key === 'payRate' ? payRateLabel(draft.payType) : field.label}
        {field.adminOnly ? <Lock className="ml-1.5 size-3" aria-label="Admin only" /> : null}
      </dt>
      <dd
        className={cn(
          'mt-1 break-words text-sm',
          missing && field.required && 'font-medium text-danger',
          missing && !field.required && 'text-ink-muted'
        )}
      >
        {value || (field.required ? 'Incomplete' : '—')}
      </dd>
    </div>
  )
}

/** A field's value as a person would read it — ids resolved, money formatted. */
function displayValue(
  field: FieldDef,
  draft: OnboardingDraft,
  ctx: ReviewContext
): string {
  switch (field.key) {
    case 'additionalDocs':
      return draft.additionalDocs.length
        ? draft.additionalDocs.map((d) => d.label || d.fileName).join(', ')
        : ''
    case 'departmentId':
      return ctx.departments.find((d) => d.id === draft.departmentId)?.name ?? ''
    case 'reportingManagerId': {
      const manager = ctx.managers.find((m) => m.id === draft.reportingManagerId)
      return manager ? manager.full_name || manager.email || '' : ''
    }
    case 'country':
      return draft.country ? countryLabel(draft.country) : ''
    case 'payRate':
      return draft.payRate ? `${ctx.currencySymbol}${draft.payRate}` : ''
    case 'accountNumber':
      // Never the number itself, even to the admin who typed it minutes ago.
      return draft.accountNumber
        ? `•••• ${draft.accountNumber.slice(-4)}`
        : ctx.accountLast4
          ? `•••• ${ctx.accountLast4}`
          : ''
    default:
      break
  }

  const raw = draft[field.key]
  if (!raw) return ''
  // A storage key is not a filename; say that something is attached instead.
  if (field.type === 'file' || field.type === 'photo') return 'Uploaded'
  return raw
}
