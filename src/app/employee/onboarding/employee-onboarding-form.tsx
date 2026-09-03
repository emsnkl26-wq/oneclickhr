'use client'

/**
 * The employee's half of onboarding.
 *
 * It is the org's wizard with the org's questions taken out — same field
 * renderers, same Zod rules, same autosave discipline — because the alternative
 * is two forms that slowly stop agreeing about what "required" means. What
 * differs is only what a person filling in their OWN details needs differently:
 *
 *   • FOUR STEPS, NOT SIX. `EMPLOYEE_STEPS` drops everything the organization
 *     decides (pay, department, hire date, job title) and everything marked
 *     admin-only. Their sign-in email is shown in the header rather than as a
 *     field: it is their identity, not an answer.
 *   • NO ID IN ANY REQUEST. Saving posts to `/api/employee/onboarding` with no
 *     identifier at all — the server finds the row by who is asking.
 *   • SUBMIT, NOT COMPLETE. Finishing hands the form to the organization for
 *     review. Nothing here writes to their profile; approval does that.
 */

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, Check, Clock, Loader2, Save, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/primitives'
import { apiPatch, apiPost, ApiClientError } from '@/lib/fetcher'
import { cn } from '@/lib/utils'
import {
  DRAFT_COLUMNS, EMPLOYEE_STEPS, EMPLOYEE_REVIEW_STEP, EMPLOYEE_EDITABLE_KEYS,
  validateEmployeeStep, visibleSections,
  type DraftFieldKey, type OnboardingDraft, type AdditionalDoc,
} from '@/lib/onboarding'
import {
  InfoBanner, WizardField, type FieldContext,
} from '@/app/org/employees/onboard/step-fields'
import { ReviewStep } from '@/app/org/employees/onboard/review-step'
import type { EmployeeOnboardingState } from '@/lib/employee-onboarding'

const AUTOSAVE_MS = 30_000

export function EmployeeOnboardingForm({
  state, orgName, currencySymbol,
}: {
  state: EmployeeOnboardingState
  orgName: string
  currencySymbol: string
}) {
  const router = useRouter()

  const [draft, setDraft] = React.useState(state.draft)
  const [step, setStep] = React.useState(state.step)
  const [completedSteps, setCompletedSteps] = React.useState<number[]>(state.completedSteps)
  const [accountLast4, setAccountLast4] = React.useState(state.accountLast4)

  const [shownErrors, setShownErrors] = React.useState<Record<number, Record<string, string>>>({})
  const [checkedSteps, setCheckedSteps] = React.useState<number[]>([])

  const [saving, setSaving] = React.useState(false)
  const [savedAt, setSavedAt] = React.useState<Date | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [uploads, setUploads] = React.useState<string[]>([])
  const [accountMismatch, setAccountMismatch] = React.useState(false)

  const dirty = React.useRef(false)
  const draftRef = React.useRef(draft)
  draftRef.current = draft
  const mismatchRef = React.useRef(false)
  mismatchRef.current = accountMismatch

  /* --------------------------------------------------------------- Editing */

  const set = React.useCallback((key: DraftFieldKey, value: string) => {
    dirty.current = true
    setDraft((prev) => ({ ...prev, [key]: value }))
  }, [])

  const setDocs = React.useCallback((docs: AdditionalDoc[]) => {
    dirty.current = true
    setDraft((prev) => ({ ...prev, additionalDocs: docs }))
  }, [])

  /* ---------------------------------------------------------------- Saving */

  /**
   * Persist what has been typed.
   *
   * Only the keys this person owns are sent — the server drops anything else
   * anyway, and sending nulls for the org's fields would be asking it to.
   * The plaintext account number goes exactly once, and is dropped from local
   * state the moment it lands; from then on this form knows only its last four
   * digits, the same as it would after a reload.
   */
  const save = React.useCallback(
    async (nextStep?: number, nextCompleted?: number[]): Promise<boolean> => {
      const current = draftRef.current
      const body: Record<string, unknown> = {}
      for (const key of Object.keys(DRAFT_COLUMNS) as DraftFieldKey[]) {
        if (key === 'accountNumber' || !EMPLOYEE_EDITABLE_KEYS.has(key)) continue
        body[key] = current[key] === '' ? null : current[key]
      }
      body.additionalDocs = current.additionalDocs
      if (current.accountNumber && !mismatchRef.current) body.accountNumber = current.accountNumber
      if (nextStep) body.employeeStep = nextStep
      if (nextCompleted) body.employeeCompletedSteps = nextCompleted

      setSaving(true)
      try {
        await apiPatch('/api/employee/onboarding', body)
        if (body.accountNumber) {
          setAccountLast4(current.accountNumber.slice(-4))
          setDraft((prev) => ({ ...prev, accountNumber: '' }))
        }
        dirty.current = false
        setSavedAt(new Date())
        return true
      } catch (err) {
        toast.error(
          err instanceof ApiClientError ? err.message : 'We could not save your details just now'
        )
        return false
      } finally {
        setSaving(false)
      }
    },
    []
  )

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      if (dirty.current && !submitting) void save(undefined, undefined)
    }, AUTOSAVE_MS)
    return () => window.clearInterval(timer)
  }, [save, submitting])

  React.useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  /* ------------------------------------------------------------ Navigation */

  const errorCounts = React.useMemo(() => {
    const counts: Record<number, number> = {}
    for (const s of EMPLOYEE_STEPS) {
      counts[s.index] = Object.keys(validateEmployeeStep(s.index, draft)).length
    }
    return counts
  }, [draft])

  /** completedSteps with the step being left added or removed as earned. */
  function nextCompleted(leaving: number): number[] {
    const ok = Object.keys(validateEmployeeStep(leaving, draft)).length === 0
    const without = completedSteps.filter((s) => s !== leaving)
    return ok ? [...without, leaving].sort((a, b) => a - b) : without
  }

  function goTo(index: number) {
    if (index === step) return
    const next = step === EMPLOYEE_REVIEW_STEP ? completedSteps : nextCompleted(step)
    setCompletedSteps(next)
    setStep(index)
    void save(index, next)
  }

  function onNext() {
    if (step === EMPLOYEE_REVIEW_STEP) return
    // Reports, never imprisons — the same rule the org's wizard follows. Someone
    // waiting on a bank letter should still be able to reach the documents step.
    const errors = validateEmployeeStep(step, draft)
    setShownErrors((prev) => ({ ...prev, [step]: errors }))
    setCheckedSteps((prev) => (prev.includes(step) ? prev : [...prev, step]))
    goTo(Math.min(step + 1, EMPLOYEE_REVIEW_STEP))
  }

  async function onSaveForLater() {
    const ok = await save(step, nextCompleted(step))
    if (ok) {
      toast.success('Saved — you can finish this later')
      router.push('/employee')
    }
  }

  /* ------------------------------------------------------------ Submission */

  async function onSubmit() {
    if (accountMismatch) {
      toast.error('The account numbers do not match')
      setConfirmOpen(false)
      setStep(stepWithKey('accountNumber') ?? step)
      return
    }

    const failing = EMPLOYEE_STEPS.filter(
      (s) => Object.keys(validateEmployeeStep(s.index, draft)).length > 0
    )
    if (failing.length) {
      const errors: Record<number, Record<string, string>> = {}
      for (const s of EMPLOYEE_STEPS) errors[s.index] = validateEmployeeStep(s.index, draft)
      setShownErrors(errors)
      setCheckedSteps(EMPLOYEE_STEPS.map((s) => s.index))
      setConfirmOpen(false)
      toast.error('Please complete all required fields')
      setStep(failing[0].index)
      return
    }

    setSubmitting(true)
    try {
      const saved = await save(EMPLOYEE_REVIEW_STEP, EMPLOYEE_STEPS.map((s) => s.index))
      if (!saved) return
      await apiPost('/api/employee/onboarding/submit')
      dirty.current = false
      setConfirmOpen(false)
      toast.success('Sent to your organization for review')
      router.push('/employee')
      router.refresh()
    } catch (err) {
      if (err instanceof ApiClientError) {
        const serverSteps = readSteps(err)
        if (serverSteps) {
          const indexes = Object.keys(serverSteps).map(Number)
          setShownErrors(serverSteps)
          setCheckedSteps(indexes)
          setStep(Math.min(...indexes))
        }
        toast.error(err.message)
      } else {
        toast.error('Something went wrong. Please try again.')
      }
      setConfirmOpen(false)
    } finally {
      setSubmitting(false)
    }
  }

  /* -------------------------------------------------------------- Rendering */

  const activeStep = EMPLOYEE_STEPS.find((s) => s.index === step)
  const fieldCtx: FieldContext = {
    // No department or manager pickers reach this form — those fields are the
    // organization's — so the lists behind them are deliberately empty and the
    // "create a department" callback can never fire.
    departments: [],
    managers: [],
    currencySymbol,
    accountLast4,
    onDepartmentCreated: () => {},
    onBusyChange: (key, busy) =>
      setUploads((prev) => (busy ? [...prev, key] : prev.filter((k) => k !== key))),
    onAccountMismatch: setAccountMismatch,
  }

  const stepErrors = shownErrors[step] ?? {}
  const stepTitles = [
    ...EMPLOYEE_STEPS,
    { index: EMPLOYEE_REVIEW_STEP, title: 'Review and submit' },
  ]

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      {/* ------------------------------------------------------- Stepper --- */}
      <nav aria-label="Onboarding steps" className="lg:sticky lg:top-6 lg:w-64 lg:shrink-0">
        <div className="lg:hidden">
          <Select
            value={String(step)}
            onChange={(e) => goTo(Number(e.target.value))}
            aria-label="Jump to a step"
          >
            {stepTitles.map((s, i) => (
              <option key={s.index} value={s.index}>
                {`Step ${i + 1} of ${stepTitles.length} — ${s.title}`}
              </option>
            ))}
          </Select>
        </div>

        <ol className="hidden lg:block">
          {stepTitles.map((s) => {
            const active = s.index === step
            const done =
              s.index === EMPLOYEE_REVIEW_STEP
                ? completedSteps.length === EMPLOYEE_STEPS.length
                : completedSteps.includes(s.index)
            const errors = checkedSteps.includes(s.index) ? (errorCounts[s.index] ?? 0) : 0
            return (
              <li key={s.index}>
                <button
                  type="button"
                  onClick={() => goTo(s.index)}
                  aria-current={active ? 'step' : undefined}
                  className={cn(
                    'focus-ring flex w-full items-center gap-2.5 border-l-2 py-2.5 pl-4 pr-2 text-left text-sm transition',
                    active
                      ? 'border-brand-600 font-semibold text-ink'
                      : 'border-line text-ink-muted hover:border-brand-200 hover:text-ink'
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{s.title}</span>
                  {errors ? (
                    <span
                      className="grid size-5 shrink-0 place-items-center rounded-full bg-brand-600 text-[11px] font-semibold text-white"
                      aria-label={`${errors} incomplete required fields`}
                    >
                      {errors}
                    </span>
                  ) : done ? (
                    <Check className="size-4 shrink-0 text-emerald-600" aria-label="Complete" />
                  ) : null}
                </button>
              </li>
            )
          })}
        </ol>
      </nav>

      {/* ---------------------------------------------------------- Form --- */}
      <div className="min-w-0 flex-1 space-y-5 pb-24">
        {state.reviewNotes ? (
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3.5">
            <Clock className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
            <div className="min-w-0 text-sm">
              <p className="font-semibold text-amber-900">{orgName} asked for a change</p>
              <p className="mt-0.5 whitespace-pre-wrap leading-relaxed text-amber-900/80">
                {state.reviewNotes}
              </p>
            </div>
          </div>
        ) : (
          <InfoBanner>
            Everything here goes to {orgName} for review — nothing is shared until you submit it.
            Your answers save as you go, so you can stop and come back.
          </InfoBanner>
        )}

        {activeStep ? (
          <div key={activeStep.index} className="animate-fade-in space-y-5">
            {visibleSections(activeStep, draft).map((section) => (
              <section key={section.title} className="card-surface p-6">
                <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{section.title}</h2>
                {section.hint ? (
                  <p className="mt-1 text-sm text-ink-muted">{section.hint}</p>
                ) : null}
                {section.banner ? (
                  <div className="mt-4">
                    <InfoBanner>{section.banner}</InfoBanner>
                  </div>
                ) : null}
                <div className="mt-5 grid gap-x-5 gap-y-4 sm:grid-cols-2">
                  {section.fields.map((field) => (
                    <div
                      key={String(field.key)}
                      className={cn(field.half ? 'sm:col-span-1' : 'sm:col-span-2')}
                    >
                      <WizardField
                        field={field}
                        draft={draft}
                        error={stepErrors[String(field.key)]}
                        set={set}
                        setDocs={setDocs}
                        ctx={fieldCtx}
                      />
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="animate-fade-in">
            <ReviewStep
              draft={draft}
              errorCounts={errorCounts}
              onJump={goTo}
              steps={EMPLOYEE_STEPS}
              title="Check everything over"
              intro={`This is what ${orgName} will see. Anything wrong can be fixed from here — click a step to go back to it.`}
              ctx={{ departments: [], managers: [], currencySymbol, accountLast4 }}
            />
          </div>
        )}
      </div>

      {/* ---------------------------------------------------- Action bar --- */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card/95 px-4 py-3 backdrop-blur lg:left-64">
        <div className="mx-auto flex max-w-[1400px] items-center gap-2 lg:px-8">
          <span className="hidden min-w-0 flex-1 truncate text-xs text-ink-muted sm:block">
            {saving ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="size-3 animate-spin" aria-hidden />
                Saving…
              </span>
            ) : savedAt ? (
              `Saved at ${savedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            ) : (
              'Not saved yet'
            )}
          </span>

          <Button
            variant="secondary"
            onClick={onSaveForLater}
            disabled={saving || submitting || uploads.length > 0}
          >
            <Save />
            <span className="hidden sm:inline">Save for later</span>
            <span className="sm:hidden">Save</span>
          </Button>

          {step > 1 ? (
            <Button variant="secondary" onClick={() => goTo(step - 1)} disabled={submitting}>
              <ArrowLeft />
              <span className="hidden sm:inline">Previous</span>
            </Button>
          ) : null}

          {step === EMPLOYEE_REVIEW_STEP ? (
            <Button onClick={() => setConfirmOpen(true)} disabled={uploads.length > 0 || submitting}>
              <Send />
              Submit for review
            </Button>
          ) : (
            <Button onClick={onNext} disabled={submitting}>
              Next
              <ArrowRight />
            </Button>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------- Confirm --- */}
      <Dialog open={confirmOpen} onOpenChange={(open) => !open && setConfirmOpen(false)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Send these details to {orgName}?</DialogTitle>
            <DialogDescription>
              They will review what you have entered. While it is being reviewed you will not be
              able to edit it — if something needs changing, they can send it back to you with a
              note.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={submitting}>
              Keep editing
            </Button>
            <Button onClick={onSubmit} loading={submitting}>
              <Send />
              Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** Which employee step holds a given field. Used to jump to a problem. */
function stepWithKey(key: string): number | null {
  const step = EMPLOYEE_STEPS.find((s) =>
    s.sections.some((section) => section.fields.some((f) => String(f.key) === key))
  )
  return step?.index ?? null
}

/**
 * Pull the step-keyed errors the submit endpoint returns.
 *
 * `ApiClientError` carries `fields` for flat forms; onboarding needs a second
 * dimension (which STEP owns the bad field), so the server sends `steps` and
 * the error object simply carries it along as an extra property.
 */
function readSteps(err: unknown): Record<number, Record<string, string>> | null {
  // `payload`, not the error itself: `ApiClientError` copies the response body
  // there and lifts only `message` and `fields` onto its own surface. Reading
  // `err.steps` looked right and was always undefined, which is why a duplicate
  // email used to arrive as a toast with no field marked.
  const steps = (err as { payload?: { steps?: unknown } })?.payload?.steps
  if (!steps || typeof steps !== 'object') return null
  const parsed = steps as Record<number, Record<string, string>>
  return Object.keys(parsed).length ? parsed : null
}
