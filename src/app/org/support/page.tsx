import type { Metadata } from 'next'
import { requireOrg } from '@/lib/auth/guards'
import { MySupportList } from '@/components/support/my-support-screens'

export const metadata: Metadata = { title: 'Support' }
export const dynamic = 'force-dynamic'

export default async function SupportPage() {
  const ctx = await requireOrg()
  return <MySupportList userId={ctx.userId} base="/org/support" />
}
