import type { Metadata } from 'next'
import { requireEmployee } from '@/lib/auth/guards'
import { MySupportList } from '@/components/support/my-support-screens'

export const metadata: Metadata = { title: 'Support' }
export const dynamic = 'force-dynamic'

export default async function SupportPage() {
  const ctx = await requireEmployee()
  return <MySupportList userId={ctx.userId} base="/employee/support" />
}
