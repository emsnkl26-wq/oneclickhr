'use client'

/**
 * The employee onboarding wizard.
 *
 * THREE RULES THAT SHAPE EVERYTHING HERE
 * --------------------------------------
 * 1. NO ACCOUNT UNTIL SOMEONE ASKS FOR ONE. Every save writes to
 *    `employee_onboarding` and nothing else. The auth user, the profile and the
 *    visa row are created by one server call — on the last step, or earlier if
 *    the org chooses "Create account & send login", which is the same call
 *    minus the requirement that all five steps be filled in. Either way it
 *    rolls back if any part of it fails.
 *
 *    That early exit is the point of the whole flow (014): most of these sixty
 *    fields are the EMPLOYEE'S information, and chasing them by email so an
 *    admin can retype them is the work this removes. Hand over the credentials,
 *    let them fill in their own share, review what comes back.
 * 2. NAVIGATION IS NON-LINEAR. Any step is reachable from the sidebar at any
 *    time. Validation reports; it does not imprison. Someone waiting on a bank
 *    letter should still be able to fill in step 5.
 * 3. WORK IS NEVER LOST. A 30-second autosave, a save on every step change, and
 *    a browser warning if a save is still pending when the tab closes.
 */

import * as React from 'react'
import { useProgressRouter } from '@/lib/use-progress-router'
import {
  ArrowLeft, ArrowRight, Check, Clock, Loader2, Save, Send, UserCheck, Undo2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Select, Textarea } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter,
} from '@/components/ui/primitives'
import { apiPatch, apiPost, ApiClientError } from '@/lib/fetcher'
import { cn } from '@/lib/utils'
import {
  DRAFT_COLUMNS, ONBOARDING_STEPS, REVIEW_STEP, TOTAL_STEPS,
  validateStep, visibleSections,
  type DraftFieldKey, type OnboardingDraft, type AdditionalDoc,
} from '@/lib/onboarding'
import { InfoBanner, WizardField, type FieldContext, type Person } from './step-fields'
import { ReviewStep } from './review-step'
import { CredentialsDialog } from './credentials-dialog'
import { stashCredentials, type NewCredentials } from '@/lib/new-credentials'
import type { OnboardingStatus } from '@/types/db'

const AUTOSAVE_MS = 30_000

interface CompletionResult extends NewCredentials {
  id: string
}

export function OnboardingWizard({
  draftId: initialDraftId,
  initialDraft,
  initialStep,
  initialCompletedSteps,
  departments: initialDepartments,
  managers,
  accountLast4: initialLast4,
  currencySymbol,
  initialStatus = 'draft',
  employeeProfileId = null,
  submittedAt = null,
}: {
  draftId: string | null
  initialDraft: OnboardingDraft
  initialStep: number
  initialCompletedSteps: number[]
  departments: { id: string; name: string }[]
  managers: Person[]
  accountLast4: string | null
  currencySymbol: string
  /** Where this onboarding stands. Drives which buttons the action bar offers. */
  initialStatus?: OnboardingStatus
  /** The account, once one exists. Null while the status is still `draft`. */
  employeeProfileId?: string | null
  submittedAt?: string | null
}) {
  const router = useProgressRouter()

  const [draftId, setDraftId] = React.useState(initialDraftId)
  const [draft, setDraft] = React.useState(initialDraft)
  const [step, setStep] = React.useState(initialStep)
  const [completedSteps, setCompletedSteps] = React.useState<number[]>(initialCompletedSteps)
  const [departments, setDepartments] = React.useState(initialDepartments)
  const [accountLast4, setAccountLast4] = React.useState(initialLast4)

  /** Errors are shown per step only after that step has been checked once. */
  const [shownErrors, setShownErrors] = React.useState<Record<number, Record<string, string>>>({})
  const [checkedSteps, setCheckedSteps] = React.useState<number[]>([])

  const [saving, setSaving] = React.useState(false)
  const [savedAt, setSavedAt] = React.useState<Date | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [uploads, setUploads] = React.useState<string[]>([])
  const [accountMismatch, setAccountMismatch] = React.useState(false)

  /*
   * The status is STATE, not a prop read once: creating the account changes it
   * under the org's feet without a navigation, and every button below reads it.
   */
  const [status, setStatus] = React.useState<OnboardingStatus>(initialStatus)
  const [accountId, setAccountId] = React.useState<string | null>(employeeProfileId)
  const [inviting, setInviting] = React.useState(false)
  /** The one-time password, held only while its dialog is open. */
  const [credentials, setCredentials] = React.useState<NewCredentials | null>(null)
  const [changesOpen, setChangesOpen] = React.useState(false)
  const [changeNotes, setChangeNotes] = React.useState('')
  const [requesting, setRequesting] = React.useState(false)

  const dirty = React.useRef(false)
  const draftRef = React.useRef(draft)
  draftRef.current = draft
  const idRef = React.useRef(draftId)
  idRef.current = draftId

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
   * Persist the draft. Creates the row on first call, updates it after.
   *
   * The plaintext account number is sent only when one was typed this session,
   * and is dropped from local state the moment it lands — from then on the
   * wizard knows only its last four digits, exactly like a page reload would.
   */
  const mismatchRef = React.useRef(false)
  mismatchRef.current = accountMismatch

  const save = React.useCallback(
    async (nextStep?: number, nextCompleted?: number[]): Promise<string | null> => {
      const current = draftRef.current
      const body: Record<string, unknown> = {}
      for (const key of Object.keys(DRAFT_COLUMNS) as DraftFieldKey[]) {
        if (key === 'accountNumber') continue
        body[key] = current[key] === '' ? null : current[key]
      }
      body.additionalDocs = current.additionalDocs
      // A number still awaiting its confirmation is held back rather than
      // stored: everything else on the step saves normally, and the number
      // goes with the next save once the two boxes agree.
      if (current.accountNumber && !mismatchRef.current) body.accountNumber = current.accountNumber
      if (nextStep) body.currentStep = nextStep
      if (nextCompleted) body.completedSteps = nextCompleted

      setSaving(true)
      try {
        let id = idRef.current
        if (id) {
          await apiPatch(`/api/org/onboarding/${id}`, body)
        } else {
          const created = await apiPost<{ id: string }>('/api/org/onboarding', body)
          id = created.id
          setDraftId(id)
          idRef.current = id
          // Make the URL resumable without a navigation — a refresh, a shared
          // link or a closed tab all come back to this same draft.
          window.history.replaceState(null, '', `/org/employees/onboard/${id}`)
        }
        if (body.accountNumber) {
          setAccountLast4(current.accountNumber.slice(-4))
          setDraft((prev) => ({ ...prev, accountNumber: '' }))
        }
        dirty.current = false
        setSavedAt(new Date())
        return id
      } catch (err) {
        toast.error(
          err instanceof ApiClientError ? err.message : 'We could not save this draft just now'
        )
        return null
      } finally {
        setSaving(false)
      }
    },
    []
  )

  // Autosave. Only fires when something actually changed, so an idle tab makes
  // no requests at all.
  React.useEffect(() => {
    const timer = window.setInterval(() => {
      if (dirty.current && !submitting) void save(undefined, undefined)
    }, AUTOSAVE_MS)
    return () => window.clearInterval(timer)
  }, [save, submitting])

  // The last resort: a pending change and a closing tab.
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
    for (const s of ONBOARDING_STEPS) {
      counts[s.index] = Object.keys(validateStep(s.index, draft)).length
    }
    return counts
  }, [draft])

  /** Record a step's verdict and return whether it passed. */
  function check(index: number): boolean {
    const errors = validateStep(index, draft)
    const ok = Object.keys(errors).length === 0
    setShownErrors((prev) => ({ ...prev, [index]: errors }))
    setCheckedSteps((prev) => (prev.includes(index) ? prev : [...prev, index]))
    setCompletedSteps((prev) => {
      const without = prev.filter((s) => s !== index)
      return ok ? [...without, index].sort((a, b) => a - b) : without
    })
    return ok
  }

  function goTo(index: number) {
    if (index === step) return
    const next = step === REVIEW_STEP ? completedSteps : nextCompleted(step)
    setStep(index)
    void save(index, next)
  }

  /** completedSteps with the step we are leaving added or removed as earned. */
  function nextCompleted(leaving: number): number[] {
    const ok = Object.keys(validateStep(leaving, draft)).length === 0
    const without = completedSteps.filter((s) => s !== leaving)
    return ok ? [...without, leaving].sort((a, b) => a - b) : without
  }

  function onNext() {
    if (step === REVIEW_STEP) return
    // Validation reports but never blocks — an optional-only step advances, and
    // a step with gaps advances too, carrying its badge with it.
    check(step)
    goTo(Math.min(step + 1, REVIEW_STEP))
  }

  async function onSaveForLater() {
    const id = await save(step, nextCompleted(step))
    if (id) {
      toast.success('Draft saved — you can pick this up later')
      router.push('/org/employees?tab=drafts')
    }
  }

  /* --------------------------------------------------------- Early invite */

  /**
   * Create the account now and hand over the credentials.
   *
   * Only three fields are needed, and they are all on step 1 — so the failure
   * mode is a jump back there with the errors showing, never a silent refusal.
   * The server re-checks the same three; this is the courtesy copy that saves a
   * round trip.
   */
  async function onInvite() {
    const missing: Record<string, string> = {}
    if (!draft.firstName.trim()) missing.firstName = 'Enter their first name'
    if (!draft.lastName.trim()) missing.lastName = 'Enter their last name'
    if (!draft.personalEmail.trim()) missing.personalEmail = 'Enter their email address'
    if (Object.keys(missing).length) {
      setShownErrors((prev) => ({ ...prev, 1: { ...(prev[1] ?? {}), ...missing } }))
      setCheckedSteps((prev) => (prev.includes(1) ? prev : [...prev, 1]))
      setStep(1)
      toast.error('Add their name and email address first')
      return
    }

    setInviting(true)
    try {
      const id = await save(step, nextCompleted(step))
      if (!id) return
      const result = await apiPost<CompletionResult>(`/api/org/onboarding/${id}/invite`, {
        sendCredentialsEmail: true,
      })
      setStatus('invited')
      setAccountId(result.id)
      setCredentials(result)
    } catch (err) {
      if (err instanceof ApiClientError) {
        const serverSteps = readSteps(err)
        if (serverSteps) {
          const indexes = Object.keys(serverSteps).map(Number)
          setShownErrors((prev) => ({ ...prev, ...serverSteps }))
          setCheckedSteps((prev) => Array.from(new Set([...prev, ...indexes])))
          setStep(Math.min(...indexes))
        }
        toast.error(err.message)
      } else {
        toast.error('Something went wrong. Please try again.')
      }
    } finally {
      setInviting(false)
    }
  }

  /* ------------------------------------------------------------- Send back */

  async function onRequestChanges() {
    if (!draftId) return
    setRequesting(true)
    try {
      await apiPost(`/api/org/onboarding/${draftId}/request-changes`, { notes: changeNotes.trim() })
      setChangesOpen(false)
      setStatus('invited')
      toast.success('Sent back to the employee with your note')
      router.push('/org/employees?tab=drafts')
    } catch (err) {
      toast.error(
        err instanceof ApiClientError ? err.message : 'We could not send this back just now'
      )
    } finally {
      setRequesting(false)
    }
  }

  /* ------------------------------------------------------------ Completion */

  async function onComplete() {
    if (accountMismatch) {
      toast.error('The account numbers do not match')
      setStep(4)
      return
    }

    const failing = ONBOARDING_STEPS.filter(
      (s) => Object.keys(validateStep(s.index, draft)).length > 0
    )
    if (failing.length) {
      const errors: Record<number, Record<string, string>> = {}
      for (const s of ONBOARDING_STEPS) errors[s.index] = validateStep(s.index, draft)
      setShownErrors(errors)
      setCheckedSteps(ONBOARDING_STEPS.map((s) => s.index))
      toast.error('Please complete all required fields')
      setStep(failing[0].index)
      return
    }

    setSubmitting(true)
    try {
      const id = await save(REVIEW_STEP, [1, 2, 3, 4, 5])
      if (!id) return
      const completion = await apiPost<CompletionResult>(`/api/org/onboarding/${id}/complete`, {
        sendCredentialsEmail: true,
      })
      dirty.current = false
      /*
       * Hand the one-time password to the employee's own page rather than
       * flashing it here: this route redirects once the draft is completed, so
       * anything rendered in the wizard is gone within a tick. sessionStorage
       * keeps it out of the URL and out of history.
       */
      stashCredentials(completion.id, completion)
      router.push(`/org/employees/${completion.id}`)
    } catch (err) {
      if (err instanceof ApiClientError) {
        // The server re-validates everything; where it disagrees with us, it
        // wins — including on things only it can know, like a duplicate email.
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
    } finally {
      setSubmitting(false)
    }
  }

  /* ------------------------------------------------------------ The wizard */

  const activeStep = ONBOARDING_STEPS.find((s) => s.index === step)
  const fieldCtx: FieldContext = {
    departments,
    managers,
    currencySymbol,
    accountLast4,
    onDepartmentCreated: (department) =>
      setDepartments((prev) =>
        [...prev, department].sort((a, b) => a.name.localeCompare(b.name))
      ),
    onBusyChange: (key, busy) =>
      setUploads((prev) => (busy ? [...prev, key] : prev.filter((k) => k !== key))),
    onAccountMismatch: setAccountMismatch,
  }

  const stepErrors = shownErrors[step] ?? {}

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      {/* ------------------------------------------------------- Stepper --- */}
      <nav aria-label="Onboarding steps" className="lg:sticky lg:top-6 lg:w-64 lg:shrink-0">
        {/* Mobile: one control, no wasted vertical space. */}
        <div className="lg:hidden">
          <Select
            value={String(step)}
            onChange={(e) => goTo(Number(e.target.value))}
            aria-label="Jump to a step"
          >
            {[...ONBOARDING_STEPS, { index: REVIEW_STEP, title: 'Review and complete' }].map(
              (s, i) => (
                <option key={s.index} value={s.index}>
                  {`Step ${i + 1} of ${TOTAL_STEPS} — ${s.title}`}
                </option>
              )
            )}
          </Select>
        </div>

        <ol className="hidden lg:block">
          {[...ONBOARDING_STEPS, { index: REVIEW_STEP, title: 'Review and complete' }].map((s) => {
            const active = s.index === step
            const done =
              s.index === REVIEW_STEP
                ? completedSteps.length === ONBOARDING_STEPS.length
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
        <StatusBanner status={status} step={step} submittedAt={submittedAt} />

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
              ctx={{ departments, managers, currencySymbol, accountLast4 }}
            />
          </div>
        )}
      </div>

      {/* ---------------------------------------------------- Action bar ---
          `lg:left-64` clears the app's nav rail, which the shell reserves with
          `lg:pl-64` — a plain `inset-x-0` would slide the bar underneath it. */}
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
            Save for later
          </Button>

          {step > 1 ? (
            <Button variant="secondary" onClick={() => goTo(step - 1)} disabled={submitting}>
              <ArrowLeft />
              <span className="hidden sm:inline">Previous</span>
            </Button>
          ) : null}

          {status === 'draft' ? (
            <Button
              variant="secondary"
              onClick={onInvite}
              loading={inviting}
              disabled={saving || submitting || uploads.length > 0}
              title="Create their account now and let them fill in the rest"
            >
              <Send />
              <span className="hidden sm:inline">Create account &amp; send login</span>
              <span className="sm:hidden">Send login</span>
            </Button>
          ) : null}

          {status === 'submitted' ? (
            <Button
              variant="secondary"
              onClick={() => setChangesOpen(true)}
              disabled={submitting || inviting}
            >
              <Undo2 />
              <span className="hidden sm:inline">Request changes</span>
            </Button>
          ) : null}

          {step === REVIEW_STEP ? (
            <Button
              onClick={onComplete}
              loading={submitting}
              disabled={uploads.length > 0 || inviting}
            >
              <Check />
              {status === 'submitted' ? 'Approve & finish' : 'Complete onboarding'}
            </Button>
          ) : (
            <Button onClick={onNext} disabled={submitting || inviting}>
              Next
              <ArrowRight />
            </Button>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------ Hand-over --- */}
      {credentials ? (
        <CredentialsDialog
          credentials={credentials}
          name={[draft.firstName, draft.lastName].filter(Boolean).join(' ').trim() || 'The employee'}
          open
          /*
           * Dismissing it any other way (Escape, the X, the overlay) means the
           * same thing as "done": the password is gone either way, so the honest
           * move is to stop pretending it is still available.
           */
          onOpenChange={(open) => !open && setCredentials(null)}
          onContinue={() => setCredentials(null)}
          onDone={() => {
            setCredentials(null)
            router.push(accountId ? `/org/employees/${accountId}` : '/org/employees?tab=drafts')
          }}
        />
      ) : null}

      {/* --------------------------------------------------- Send back --- */}
      <Dialog open={changesOpen} onOpenChange={(open) => !open && setChangesOpen(false)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Send this back for changes?</DialogTitle>
            <DialogDescription>
              Their form reopens and they are notified with your note. Nothing already entered is
              lost, and their account is unaffected.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="pb-4">
            <Textarea
              value={changeNotes}
              onChange={(e) => setChangeNotes(e.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="e.g. The address looks like your old one — please update it, and re-upload the ID proof, the scan is unreadable."
              aria-label="What needs changing"
            />
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setChangesOpen(false)} disabled={requesting}>
              Cancel
            </Button>
            <Button
              onClick={onRequestChanges}
              loading={requesting}
              disabled={!changeNotes.trim()}
            >
              <Undo2 />
              Send back
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * Who this onboarding is waiting on, said once at the top of the form.
 *
 * On a plain draft it is an OFFER rather than a status: the whole flow only
 * helps if the person about to type sixty fields knows they do not have to.
 * That is why it shows on step 1 and then gets out of the way.
 */
function StatusBanner({
  status, step, submittedAt,
}: {
  status: OnboardingStatus
  step: number
  submittedAt: string | null
}) {
  if (status === 'draft') {
    if (step !== 1) return null
    return (
      <InfoBanner>
        Don&rsquo;t have all their details? Fill in their name and email, then{' '}
        <strong className="font-semibold text-ink">Create account &amp; send login</strong> — they
        can sign in and complete the rest themselves, and you review it before it becomes their
        profile.
      </InfoBanner>
    )
  }

  const submitted = status === 'submitted'

  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-xl border px-4 py-3.5',
        submitted ? 'border-emerald-200 bg-emerald-50/60' : 'border-line bg-page'
      )}
    >
      {submitted ? (
        <UserCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
      ) : (
        <Clock className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden />
      )}
      <div className="min-w-0 text-sm">
        <p className="font-semibold">
          {submitted ? 'Ready for your review' : 'Waiting on the employee'}
        </p>
        <p className="mt-0.5 leading-relaxed text-ink-muted">
          {submitted ? (
            <>
              They have filled in their own details{submittedAt ? ' and submitted them' : ''}. Check
              the review step, then approve — approving is what writes all of this onto their
              profile. Anything wrong can be corrected here first, or sent back to them.
            </>
          ) : (
            <>
              Their account exists and they can sign in to complete their details. You can carry on
              filling this in yourself at any time — whoever gets there first, the review step is
              where it ends up.
            </>
          )}
        </p>
      </div>
    </div>
  )
}

/**
 * Pull the step-keyed errors the complete endpoint returns.
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

