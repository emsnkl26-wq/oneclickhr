import { requireCandidate } from '@/lib/auth/guards'
import { AppShell } from '@/components/shell/app-shell'

export const dynamic = 'force-dynamic'

/**
 * The job seeker's portal (052). The guard is the boundary: only an active
 * `candidate` gets past it, and everything under here reads through the
 * caller's own session, where RLS limits them to their own rows.
 */
export default async function CandidateLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCandidate()
  return <AppShell ctx={ctx}>{children}</AppShell>
}
