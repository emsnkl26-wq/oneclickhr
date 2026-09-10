import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import { AdminList, type AdminRow } from './admin-list'

export const metadata: Metadata = { title: 'Administrators' }
export const dynamic = 'force-dynamic'

/**
 * Who can run this workspace.
 *
 * The PAGE is open to any administrator — knowing who your colleagues are is
 * not privileged. The ACTIONS on it are owner-only, gated server-side by
 * `apiRequireOwner()`; `isOwner` is passed down purely so an admin is shown a
 * read-only list instead of buttons that would 403.
 */
export default async function TeamSettingsPage() {
  const ctx = await requireOrg()
  const supabase = await createSupabaseServerClient()

  const { data: admins } = await supabase
    .from('profiles')
    .select('id, full_name, email, photo_url, is_active, is_owner, created_at')
    .eq('role', 'org')
    .order('is_owner', { ascending: false })
    .order('created_at')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Administrators"
        description="People who can sign in to this workspace and manage it."
        actions={
          <Button asChild variant="secondary">
            <Link href="/org/settings">
              <ArrowLeft />
              Settings
            </Link>
          </Button>
        }
      />
      <AdminList
        admins={(admins ?? []) as unknown as AdminRow[]}
        currentUserId={ctx.userId}
        isOwner={ctx.isOwner}
      />
    </div>
  )
}
