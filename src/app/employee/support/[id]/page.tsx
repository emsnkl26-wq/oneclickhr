import type { Metadata } from 'next'
import { requireEmployee } from '@/lib/auth/guards'
import { MySupportThread } from '@/components/support/my-support-screens'

export const metadata: Metadata = { title: 'Support request' }
export const dynamic = 'force-dynamic'

export default async function SupportThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEmployee()
  const { id } = await params
  return <MySupportThread userId={ctx.userId} id={id} base="/employee/support" />
}
