import { Mail, Phone, MessageCircle, UserRound } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/primitives'
import { initials } from '@/lib/utils'
import type { ProjectManagerContact } from '@/types/db'

/** The columns to embed for a manager: `manager:profiles!projects_manager_fk(...)`. */
export const MANAGER_EMBED =
  'manager:profiles!projects_manager_fk(id, full_name, email, phone, work_phone, photo_url, designation)'

/** Work phone first — it is the one people expect to be called on. */
export const managerPhone = (m: Pick<ProjectManagerContact, 'phone' | 'work_phone'>) =>
  m.work_phone?.trim() || m.phone?.trim() || null

/** `wa.me` wants the number as bare digits, country code included. */
const waDigits = (phone: string) => phone.replace(/\D/g, '')

const ACTION =
  'inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-3 text-sm font-medium transition hover:bg-page'

/** One-click contact buttons for a manager. Used on cards and in list rows. */
export function ManagerActions({
  manager, compact = false,
}: {
  manager: ProjectManagerContact
  compact?: boolean
}) {
  const phone = managerPhone(manager)
  const digits = phone ? waDigits(phone) : ''
  const cls = compact
    ? 'inline-flex size-7 items-center justify-center rounded-md text-ink-muted transition hover:bg-page hover:text-ink'
    : ACTION

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {digits ? (
        <a
          href={`https://wa.me/${digits}`}
          target="_blank"
          rel="noopener noreferrer"
          className={cls}
          aria-label="WhatsApp"
          title="WhatsApp"
        >
          <MessageCircle className="size-4 text-emerald-600" aria-hidden />
          {compact ? null : 'WhatsApp'}
        </a>
      ) : null}
      {phone ? (
        <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} className={cls} aria-label="Call" title="Call">
          <Phone className="size-4" aria-hidden />
          {compact ? null : 'Call'}
        </a>
      ) : null}
      {manager.email ? (
        <a href={`mailto:${manager.email}`} className={cls} aria-label="Email" title="Email">
          <Mail className="size-4" aria-hidden />
          {compact ? null : 'Email'}
        </a>
      ) : null}
    </div>
  )
}

export function ManagerAvatar({
  manager, className,
}: {
  manager: ProjectManagerContact
  className?: string
}) {
  return (
    <Avatar className={className}>
      {manager.photo_url ? (
        <AvatarImage src={`/api/files/view?key=${encodeURIComponent(manager.photo_url)}`} alt="" />
      ) : null}
      <AvatarFallback>{initials(manager.full_name, manager.email)}</AvatarFallback>
    </Avatar>
  )
}

/** The prominent "Project manager" card on a project page (org and employee). */
export function ProjectManagerCard({ manager }: { manager: ProjectManagerContact | null }) {
  const phone = manager ? managerPhone(manager) : null
  return (
    <Card>
      <CardHeader>
        <CardTitle>Project manager</CardTitle>
      </CardHeader>
      <CardContent>
        {manager ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <ManagerAvatar manager={manager} className="size-14" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold">
                {manager.full_name || manager.email}
              </p>
              <p className="truncate text-sm text-ink-muted">
                {manager.designation || 'Project manager'}
              </p>
              <p className="mt-1 truncate text-xs text-ink-muted">
                {[manager.email, phone].filter(Boolean).join(' · ') || 'No contact details'}
              </p>
            </div>
            <ManagerActions manager={manager} />
          </div>
        ) : (
          <div className="flex items-center gap-3 text-sm text-ink-muted">
            <UserRound className="size-5" aria-hidden />
            No project manager assigned yet.
          </div>
        )}
      </CardContent>
    </Card>
  )
}
