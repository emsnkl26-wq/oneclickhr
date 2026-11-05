'use client'

import * as React from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  BadgeCheck,
  Building2,
  CalendarDays,
  Globe,
  HardDrive,
  Mail,
  Shield,
  Settings2,
  Users,
  Hash,
  Clock,
  Palette,
} from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AppearanceSetting } from '@/components/theme-toggle'
import { SettingsForm } from './settings-form'
import { CompanyForm } from './company-form'
import { DepartmentManager } from './department-manager'
import { OvertimeForm } from './overtime-form'
import { TwoFactorCard } from './two-factor-card'
import { StorageCard, type StorageRequestRow } from './storage-card'
import type { CompanyDetails } from '@/types/db'
import { cn } from '@/lib/utils'

const TABS = [
  { value: '', label: 'General', icon: Settings2 },
  { value: 'company', label: 'Company', icon: Building2 },
  { value: 'security', label: 'Security', icon: Shield },
  { value: 'advanced', label: 'Advanced', icon: Settings2 },
] as const

type TabValue = (typeof TABS)[number]['value']

export function SettingsTabs({
  ctx,
  tenant,
  departments,
  company,
  storage,
  storageRequests,
}: {
  ctx: {
    email: string
    userId: string
    fullName: string | null
    isOwner: boolean
    twoFactorEnabled: boolean
    tenant: {
      name: string
      primaryColor: string
      timezone: string
      workStartTime: string
      defaultTrackingMode: string | null
      logoUrl: string | null
      domain: string | null
      domainVerified: boolean
      defaultCurrency: string
    }
  }
  tenant: {
    org_code: string | null
    two_factor_window_hours: number | null
    overtime_weekly_threshold: number | null
  }
  departments: { id: string; name: string }[]
  company: CompanyDetails
  storage: { used: number; limit: number }
  storageRequests: StorageRequestRow[]
}) {
  const searchParams = useSearchParams()
  const activeTab = (searchParams.get('tab') ?? '') as TabValue

  return (
    <div className="space-y-6">
      {/* Account summary bar */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-line bg-card px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-full border border-line bg-page">
            {ctx.tenant.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/files/view?key=${encodeURIComponent(ctx.tenant.logoUrl)}`}
                alt=""
                className="size-full object-cover"
              />
            ) : (
              <span className="text-sm font-bold text-ink-muted">
                {ctx.tenant.name.charAt(0).toUpperCase()}
              </span>
            )}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">{ctx.tenant.name}</p>
            <p className="truncate text-xs text-ink-muted">
              {ctx.isOwner ? 'Owner' : 'Administrator'}
            </p>
          </div>
        </div>

        <div className="hidden h-8 w-px bg-line sm:block" />

        <div className="flex items-center gap-1.5 text-sm text-ink-muted">
          <Mail className="size-3.5 shrink-0" />
          <span className="truncate">{ctx.email}</span>
        </div>

        {tenant.org_code ? (
          <>
            <div className="hidden h-8 w-px bg-line sm:block" />
            <div className="flex items-center gap-1.5 text-sm text-ink-muted">
              <Hash className="size-3.5 shrink-0" />
              <span>Org code: <span className="font-medium text-ink">{tenant.org_code}</span></span>
            </div>
          </>
        ) : null}

        <div className="hidden h-8 w-px bg-line sm:block" />
        <div className="flex items-center gap-1.5 text-sm text-ink-muted">
          <Clock className="size-3.5 shrink-0" />
          <span className="truncate">{ctx.tenant.timezone}</span>
        </div>

        <div className="hidden h-8 w-px bg-line sm:block" />
        <div className="flex items-center gap-1.5 text-sm text-ink-muted">
          <Palette className="size-3.5 shrink-0" />
          <span className="truncate">{ctx.tenant.defaultCurrency}</span>
        </div>
      </div>

      {/* Tab bar */}
      <div
        role="tablist"
        className="no-scrollbar inline-flex items-center gap-1 overflow-x-auto rounded-xl border border-line bg-card p-1"
      >
        {TABS.map((tab) => {
          const isSelected = tab.value === activeTab
          const Icon = tab.icon
          return (
            <Link
              key={tab.value || 'default'}
              href={tab.value ? `?tab=${tab.value}` : '/org/settings'}
              role="tab"
              aria-selected={isSelected}
              scroll={false}
              className={cn(
                'focus-ring flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-medium transition',
                isSelected
                  ? 'bg-brand-50 text-brand-ink'
                  : 'text-ink-muted hover:text-ink'
              )}
            >
              <Icon className="size-3.5" />
              {tab.label}
            </Link>
          )
        })}
      </div>

      {/* Tab content */}
      {activeTab === '' && (
        <GeneralTab
          tenant={ctx.tenant}
          departments={departments}
        />
      )}

      {activeTab === 'company' && <CompanyTab company={company} />}

      {activeTab === 'security' && (
        <SecurityTab
          twoFactorEnabled={ctx.twoFactorEnabled}
          windowHours={
            tenant.two_factor_window_hours == null ? 8 : Number(tenant.two_factor_window_hours)
          }
          domain={ctx.tenant.domain}
          domainVerified={ctx.tenant.domainVerified}
          isOwner={ctx.isOwner}
        />
      )}

      {activeTab === 'advanced' && (
        <AdvancedTab
          overtimeThreshold={
            tenant.overtime_weekly_threshold == null ? null : Number(tenant.overtime_weekly_threshold)
          }
          storage={storage}
          storageRequests={storageRequests}
        />
      )}
    </div>
  )
}

function GeneralTab({
  tenant,
  departments,
}: {
  tenant: {
    name: string
    primaryColor: string
    timezone: string
    workStartTime: string
    defaultTrackingMode: string | null
    logoUrl: string | null
  }
  departments: { id: string; name: string }[]
}) {
  return (
    <div className="space-y-6">
      <AppearanceSetting />
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <SettingsForm
          tenant={{
            name: tenant.name,
            primaryColor: tenant.primaryColor,
            timezone: tenant.timezone,
            workStartTime: tenant.workStartTime,
            defaultTrackingMode: tenant.defaultTrackingMode ?? '',
            logoUrl: tenant.logoUrl,
          }}
        />
        <DepartmentManager departments={departments} />
      </div>
    </div>
  )
}

function CompanyTab({ company }: { company: CompanyDetails }) {
  return <CompanyForm company={company} />
}

function SecurityTab({
  twoFactorEnabled,
  windowHours,
  domain,
  domainVerified,
  isOwner,
}: {
  twoFactorEnabled: boolean
  windowHours: number
  domain: string | null
  domainVerified: boolean
  isOwner: boolean
}) {
  return (
    <div className="grid items-start gap-5 lg:grid-cols-2">
      <TwoFactorCard enabled={twoFactorEnabled} windowHours={windowHours} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Company website
            {domainVerified ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                <BadgeCheck className="size-3" aria-hidden />
                Verified
              </span>
            ) : (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                Not verified
              </span>
            )}
          </CardTitle>
          <CardDescription>
            {domain
              ? `${domain} — verifying it reserves this workspace for your company.`
              : 'Reserve this workspace for your company so nobody opens a second one.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="secondary">
            <Link href="/org/settings/domain">
              <Globe />
              {domainVerified ? 'Manage website' : 'Verify website'}
            </Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Administrators</CardTitle>
          <CardDescription>
            {isOwner
              ? 'Invite colleagues to help run this workspace. They get the same access as you.'
              : 'See who else can manage this workspace.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="secondary">
            <Link href="/org/settings/team">
              <Users />
              {isOwner ? 'Manage administrators' : 'View administrators'}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function AdvancedTab({
  overtimeThreshold,
  storage,
  storageRequests,
}: {
  overtimeThreshold: number | null
  storage: { used: number; limit: number }
  storageRequests: StorageRequestRow[]
}) {
  return (
    <div className="grid items-start gap-5 lg:grid-cols-2">
      <OvertimeForm threshold={overtimeThreshold} />

      <StorageCard
        used={storage.used}
        limit={storage.limit}
        requests={storageRequests}
      />

      <Card>
        <CardHeader>
          <CardTitle>Integrations</CardTitle>
          <CardDescription>Connect Google Calendar for two-way meeting sync.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="secondary">
            <Link href="/org/settings/integrations">
              <CalendarDays />
              Manage integrations
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
