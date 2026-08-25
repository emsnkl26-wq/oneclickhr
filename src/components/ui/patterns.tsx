import * as React from 'react'
import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { cn, humanize } from '@/lib/utils'

/* --------------------------------------------------------------- StatCard */

/**
 * Icon tints for a stat row.
 *
 * The rule the app follows: the NUMBER is crimson on at most one card (that is
 * what `accent` does), and the icon tile may carry a quiet hue so a long row of
 * cards is scannable. The tile is a tint, never a fill — these sit next to each
 * other and a row of saturated squares reads as a toy.
 */
export type StatTone = 'neutral' | 'brand' | 'orange' | 'pink' | 'purple' | 'indigo' | 'emerald'

const STAT_TONES: Record<StatTone, string> = {
  neutral: 'bg-page text-ink-muted',
  brand: 'bg-brand-50 text-brand-600',
  orange: 'bg-amber-50 text-amber-600',
  pink: 'bg-pink-50 text-pink-600',
  purple: 'bg-purple-50 text-purple-600',
  indigo: 'bg-indigo-50 text-indigo-600',
  emerald: 'bg-emerald-50 text-emerald-600',
}

export interface StatCardProps {
  label: string
  value: React.ReactNode
  hint?: string
  icon?: LucideIcon
  /** Renders the number in crimson. Use for ONE card per row, at most. */
  accent?: boolean
  /** Tints the icon tile. Defaults to brand when `accent` is set. */
  tone?: StatTone
  href?: string
  className?: string
}

/**
 * The big friendly number that opens every dashboard. The value is deliberately
 * oversized and tabular — a row of these is the first thing anyone reads, so the
 * digits must not shift as they refresh.
 */
export function StatCard({
  label, value, hint, icon: Icon, accent, tone, href, className,
}: StatCardProps) {
  const iconTone = STAT_TONES[tone ?? (accent ? 'brand' : 'neutral')]
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium text-ink-muted">{label}</p>
        {Icon ? (
          <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg', iconTone)}>
            <Icon className="size-[18px]" aria-hidden />
          </span>
        ) : null}
      </div>
      <p
        className={cn(
          'tabular mt-3 text-[28px] font-bold leading-none tracking-[-0.02em]',
          accent ? 'text-brand-600' : 'text-ink'
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-2 text-xs text-ink-muted">{hint}</p> : null}
    </>
  )

  if (href) {
    return (
      <Link
        href={href}
        className={cn('card-surface block p-5 transition hover:shadow-card', className)}
      >
        {body}
      </Link>
    )
  }
  return <div className={cn('card-surface p-5', className)}>{body}</div>
}

/* -------------------------------------------------------------- EmptyState */

export interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

/**
 * An empty state is not an error. It names what would be here and offers the one
 * action that creates it — so a fresh workspace reads as ready, not broken.
 */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-14 text-center', className)}>
      {Icon ? (
        <span className="mb-4 grid size-12 place-items-center rounded-2xl bg-page text-ink-muted">
          <Icon className="size-5" aria-hidden />
        </span>
      ) : null}
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      {description ? (
        <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-ink-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

/* -------------------------------------------------------------- StatusChip */

type Tone = 'neutral' | 'success' | 'warning' | 'info' | 'danger' | 'brand'

const TONES: Record<Tone, string> = {
  neutral: 'bg-page text-ink-muted ring-line',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warning: 'bg-amber-50 text-amber-700 ring-amber-200',
  info: 'bg-blue-50 text-blue-700 ring-blue-200',
  danger: 'bg-brand-50 text-brand-700 ring-brand-200',
  brand: 'bg-brand-50 text-brand-700 ring-brand-200',
}

/** Every status in the app maps to a tone here, so colours stay consistent. */
const STATUS_TONES: Record<string, Tone> = {
  active: 'success', approved: 'success', paid: 'success', connected: 'success', present: 'success',
  resolved: 'success',
  pending: 'warning', draft: 'neutral', overdue: 'warning', needs_reauth: 'warning', late: 'warning',
  submitted: 'warning',
  sent: 'info', in_progress: 'info', open: 'info', completed: 'info',
  rejected: 'danger', suspended: 'danger', cancelled: 'danger', revoked: 'danger', inactive: 'danger', absent: 'danger',
  closed: 'neutral',
  low: 'neutral', medium: 'info', high: 'warning', urgent: 'danger',
}

export function StatusChip({
  status, label, tone, className,
}: {
  status: string
  label?: string
  tone?: Tone
  className?: string
}) {
  const resolved = tone ?? STATUS_TONES[status?.toLowerCase?.() ?? ''] ?? 'neutral'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
        TONES[resolved],
        className
      )}
    >
      <span className="size-1.5 rounded-full bg-current opacity-70" aria-hidden />
      {label ?? humanize(status)}
    </span>
  )
}

/* -------------------------------------------------------------- PageHeader */

export function PageHeader({
  title, description, actions, className,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between', className)}>
      <div className="min-w-0">
        <h1 className="text-[22px] font-bold tracking-[-0.02em] text-ink">{title}</h1>
        {description ? <p className="mt-1 text-sm text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

/* --------------------------------------------------------------- DataTable */

export interface Column<T> {
  key: string
  header: React.ReactNode
  /** Cell renderer. Keep it pure — this runs for every row. */
  cell: (row: T) => React.ReactNode
  className?: string
  headerClassName?: string
}

export interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  empty?: React.ReactNode
  loading?: boolean
  skeletonRows?: number
  onRowClick?: (row: T) => void
  className?: string
}

/**
 * One table for the whole product.
 *
 * On small screens it scrolls horizontally inside its own container rather than
 * pushing the page wide — a table is the one thing that legitimately cannot
 * reflow, and a horizontally-scrolling PAGE is far worse than a scrolling table.
 */
export function DataTable<T>({
  columns, rows, rowKey, empty, loading, skeletonRows = 6, onRowClick, className,
}: DataTableProps<T>) {
  if (loading) {
    return (
      <div className={cn('card-surface overflow-hidden', className)}>
        <TableSkeleton columns={columns.length} rows={skeletonRows} />
      </div>
    )
  }

  if (!rows.length) {
    return <div className={cn('card-surface overflow-hidden', className)}>{empty}</div>
  }

  return (
    <div className={cn('card-surface overflow-hidden', className)}>
      <div className="scrollbar-thin overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-page/60">
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={cn(
                    'px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-muted',
                    col.headerClassName
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  'border-b border-line last:border-0 transition-colors',
                  onRowClick && 'cursor-pointer hover:bg-brand-50/40'
                )}
              >
                {columns.map((col) => (
                  <td key={col.key} className={cn('px-4 py-3 align-middle text-ink', col.className)}>
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- Skeletons */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} />
}

export function TableSkeleton({ columns = 4, rows = 6 }: { columns?: number; rows?: number }) {
  return (
    <div className="divide-y divide-line">
      <div className="flex gap-4 bg-page/60 px-4 py-3">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-4 py-4">
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={c} className={cn('h-4 flex-1', c === 0 && 'max-w-[180px]')} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function StatCardSkeleton() {
  return (
    <div className="card-surface p-5">
      <div className="flex items-start justify-between">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="size-9 rounded-lg" />
      </div>
      <Skeleton className="mt-4 h-7 w-16" />
      <Skeleton className="mt-3 h-3 w-32" />
    </div>
  )
}

export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="card-surface space-y-3 p-5">
      <Skeleton className="h-4 w-1/3" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn('h-3', i === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  )
}

/* ------------------------------------------------------- Loading skeletons */

/**
 * The building blocks every `loading.tsx` composes from.
 *
 * The rule they follow: a skeleton must occupy the SAME space the real content
 * will, or the page jumps when it arrives and the loading state has made things
 * worse. So these mirror the real components' padding, heights and grid tracks
 * rather than being generic grey boxes — a `PageHeaderSkeleton` is exactly as
 * tall as a `PageHeader`, and `TableCardSkeleton` gets the same card chrome and
 * row height as `DataTable`.
 */

export function PageHeaderSkeleton({ action = true }: { action?: boolean }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <Skeleton className="h-[26px] w-56" />
        <Skeleton className="mt-2 h-4 w-72 max-w-full" />
      </div>
      {action ? <Skeleton className="h-9 w-36 shrink-0 rounded-lg" /> : null}
    </div>
  )
}

/** A row of StatCards. `columns` must match the page's own grid. */
export function StatGridSkeleton({ count = 4, columns = 4 }: { count?: number; columns?: 3 | 4 }) {
  return (
    <div
      className={cn(
        'grid gap-4 sm:grid-cols-2',
        columns === 4 ? 'xl:grid-cols-4' : 'sm:grid-cols-3'
      )}
    >
      {Array.from({ length: count }).map((_, i) => (
        <StatCardSkeleton key={i} />
      ))}
    </div>
  )
}

/** The search + filter row that sits above most tables. */
export function ToolbarSkeleton({ filters = 2 }: { filters?: number }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <Skeleton className="h-10 flex-1 rounded-lg" />
      {Array.from({ length: filters }).map((_, i) => (
        <Skeleton key={i} className="h-10 rounded-lg sm:w-44" />
      ))}
    </div>
  )
}

export function TabsSkeleton({ count = 2 }: { count?: number }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-xl border border-line bg-card p-1">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-[30px] w-28 rounded-lg" />
      ))}
    </div>
  )
}

export function TableCardSkeleton({ columns = 5, rows = 8 }: { columns?: number; rows?: number }) {
  return (
    <div className="card-surface overflow-hidden">
      <TableSkeleton columns={columns} rows={rows} />
    </div>
  )
}

/**
 * A titled card wrapping a list of rows — the shape of every "recent X" panel on
 * the dashboards. `avatar` adds the leading circle those lists have.
 */
export function ListCardSkeleton({
  rows = 4,
  avatar = false,
  title = true,
}: {
  rows?: number
  avatar?: boolean
  title?: boolean
}) {
  return (
    <div className="card-surface overflow-hidden">
      {title ? (
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-3 w-16" />
        </div>
      ) : null}
      <div className="divide-y divide-line">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-5 py-3.5">
            {avatar ? <Skeleton className="size-9 shrink-0 rounded-full" /> : null}
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3.5 w-40 max-w-[70%]" />
              <Skeleton className="h-3 w-56 max-w-[85%]" />
            </div>
            <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** A card containing a form: title, description, then labelled inputs. */
export function FormCardSkeleton({ fields = 4 }: { fields?: number }) {
  return (
    <div className="card-surface p-5">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-2 h-3 w-64 max-w-full" />
      <div className="mt-5 space-y-4">
        {Array.from({ length: fields }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
        ))}
        <Skeleton className="h-9 w-32 rounded-lg" />
      </div>
    </div>
  )
}
