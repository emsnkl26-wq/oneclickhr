/**
 * The organization's mark on a timesheet.
 *
 * A timesheet is not an internal scratch pad — it is filed against a vendor,
 * approved by the org, and ends up attached to an invoice. So it carries the
 * company's identity the way a letter does, and the same identity in all three
 * places it can be seen: the employee filling it in, the approver reviewing it,
 * and whoever opens the PDF afterwards.
 *
 * The logo is served through `/api/files/view` because `tenants.logo_url` holds
 * an R2 OBJECT KEY, never a public URL — the same rule every other stored file
 * in the product follows.
 *
 * A plain `<img>` rather than `next/image`: the source is a signed, per-tenant
 * URL that the image optimizer cannot usefully cache, and the whole element is
 * at most 32 pixels tall.
 */
export interface LetterheadOrg {
  name: string
  /** R2 object key, or null when the workspace has not uploaded one. */
  logoKey: string | null
  primaryColor: string
}

export function TimesheetLetterhead({
  org, period, code,
}: {
  org: LetterheadOrg
  /** e.g. "Sep 13 – Sep 19, 2026". */
  period: string
  /** The timesheet's human-readable id, e.g. TS-00042. */
  code: string
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-card px-5 py-3.5 shadow-sm">
      <div className="flex min-w-0 items-center gap-3">
        {org.logoKey ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/files/view?key=${encodeURIComponent(org.logoKey)}`}
            alt=""
            className="h-8 w-auto max-w-[9rem] shrink-0 object-contain"
          />
        ) : (
          <span
            aria-hidden
            className="grid size-8 shrink-0 place-items-center rounded-lg text-[13px] font-bold text-white"
            style={{ backgroundColor: org.primaryColor }}
          >
            {org.name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{org.name}</p>
          <p className="truncate text-xs text-ink-muted">Weekly timesheet</p>
        </div>
      </div>

      <div className="text-right">
        <p className="tabular text-sm font-medium">{code}</p>
        <p className="tabular text-xs text-ink-muted">{period}</p>
      </div>
    </div>
  )
}
