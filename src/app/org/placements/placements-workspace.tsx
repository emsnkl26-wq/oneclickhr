'use client'

/**
 * Placements, vendors and clients — three tabs over one screen.
 *
 * THE RATE PAIR IS THE POINT OF THIS SCREEN. Every placement carries a bill
 * rate (what the vendor is invoiced) and a pay rate (what the employee earns),
 * and they are shown side by side here and NOWHERE the employee can reach. The
 * form warns when pay exceeds bill in the same currency, because that is nearly
 * always a transposed pair of figures and finding out at invoice time is
 * expensive.
 */

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Building2, Pencil, Plus, Trash2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea, DateField } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import { Checkbox } from '@/components/ui/checkbox'
import { EmptyState, StatusChip } from '@/components/ui/patterns'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogBody, DialogFooter, Tabs, TabsList, TabsTrigger,
} from '@/components/ui/primitives'
import { apiPost, apiPatch, apiDelete, ApiClientError } from '@/lib/fetcher'
import { RATE_UNITS } from '@/lib/schemas'

interface Party {
  id: string
  name: string
  contact_name: string | null
  email: string | null
  phone?: string | null
  address: Record<string, string | undefined> | null
  payment_terms_days?: number
  notes: string | null
  status: string
}

interface Placement {
  id: string
  employee_id: string
  vendor_id: string
  client_id: string | null
  bill_rate: number | string | null
  bill_currency: string
  pay_rate: number | string | null
  pay_currency: string
  rate_unit: string
  start_date: string | null
  end_date: string | null
  is_primary: boolean
  status: string
  notes: string | null
  employee: { id: string; full_name: string | null; email: string | null } | null
  vendor: { id: string; name: string } | null
  client: { id: string; name: string } | null
}

interface Person {
  id: string
  full_name: string | null
  email: string | null
}

type Tab = 'placements' | 'vendors' | 'clients'

export function PlacementsWorkspace({
  placements, vendors, clients, employees, initialEmployeeId, initialTab,
}: {
  placements: Placement[]
  vendors: Party[]
  clients: Party[]
  employees: Person[]
  initialEmployeeId: string
  initialTab: Tab
}) {
  const router = useRouter()
  const [tab, setTab] = React.useState<Tab>(initialTab)

  const [editingPlacement, setEditingPlacement] = React.useState<Placement | null>(null)
  const [creatingPlacement, setCreatingPlacement] = React.useState(false)
  const [editingParty, setEditingParty] = React.useState<Party | null>(null)
  const [creatingParty, setCreatingParty] = React.useState<'vendor' | 'client' | null>(null)
  const [deleting, setDeleting] = React.useState<
    { kind: 'placement' | 'vendor' | 'client'; id: string; label: string } | null
  >(null)
  const [busy, setBusy] = React.useState(false)

  // Deep-linked from an employee page: "add a placement for this person".
  React.useEffect(() => {
    if (initialEmployeeId) setCreatingPlacement(true)
  }, [initialEmployeeId])

  async function confirmDelete() {
    if (!deleting) return
    const endpoint =
      deleting.kind === 'placement'
        ? `/api/org/placements/${deleting.id}`
        : deleting.kind === 'vendor'
          ? `/api/org/vendors/${deleting.id}`
          : `/api/org/clients/${deleting.id}`

    setBusy(true)
    try {
      await apiDelete(endpoint)
      toast.success(`${deleting.label} deleted`)
      setDeleting(null)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
          <TabsList>
            <TabsTrigger value="placements">Placements</TabsTrigger>
            <TabsTrigger value="vendors">Vendors</TabsTrigger>
            <TabsTrigger value="clients">End clients</TabsTrigger>
          </TabsList>
        </Tabs>

        <Button
          onClick={() => {
            if (tab === 'placements') setCreatingPlacement(true)
            else setCreatingParty(tab === 'vendors' ? 'vendor' : 'client')
          }}
        >
          <Plus />
          {tab === 'placements' ? 'New placement' : tab === 'vendors' ? 'New vendor' : 'New client'}
        </Button>
      </div>

      {tab === 'placements' ? (
        placements.length === 0 ? (
          <Card>
            <EmptyState
              icon={Users}
              title="No placements yet"
              description="A placement links an employee to the vendor we invoice and the client they sit with. It is what a timesheet is billed against."
              action={
                vendors.length ? (
                  <Button onClick={() => setCreatingPlacement(true)}>Add a placement</Button>
                ) : (
                  <Button onClick={() => setCreatingParty('vendor')}>Add a vendor first</Button>
                )
              }
            />
          </Card>
        ) : (
          <ul className="space-y-2.5">
            {placements.map((row) => (
              <li key={row.id}>
                <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/org/employees/${row.employee_id}`}
                        className="truncate font-medium hover:underline"
                      >
                        {row.employee?.full_name || row.employee?.email || 'Employee'}
                      </Link>
                      {row.is_primary ? (
                        <StatusChip status="info" tone="info" label="Primary" />
                      ) : null}
                      {row.status === 'ended' ? <StatusChip status="ended" label="Ended" /> : null}
                    </div>
                    <p className="mt-0.5 truncate text-[13px] text-ink-muted">
                      {row.vendor?.name ?? 'No vendor'}
                      {row.client?.name ? ` → ${row.client.name}` : ''}
                    </p>
                    <p className="tabular mt-0.5 text-[13px] text-ink-muted">
                      {row.bill_rate != null
                        ? `Bill ${row.bill_currency} ${Number(row.bill_rate)}`
                        : 'No bill rate'}
                      {' · '}
                      {row.pay_rate != null
                        ? `pay ${row.pay_currency} ${Number(row.pay_rate)}`
                        : 'no pay rate'}
                      {` / ${row.rate_unit}`}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Edit placement"
                      onClick={() => setEditingPlacement(row)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Delete placement"
                      onClick={() =>
                        setDeleting({
                          kind: 'placement',
                          id: row.id,
                          label: row.employee?.full_name || 'Placement',
                        })
                      }
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )
      ) : (
        <PartyList
          parties={tab === 'vendors' ? vendors : clients}
          kind={tab === 'vendors' ? 'vendor' : 'client'}
          onEdit={setEditingParty}
          onDelete={(party) =>
            setDeleting({
              kind: tab === 'vendors' ? 'vendor' : 'client',
              id: party.id,
              label: party.name,
            })
          }
          onCreate={() => setCreatingParty(tab === 'vendors' ? 'vendor' : 'client')}
        />
      )}

      <PlacementDialog
        open={creatingPlacement || !!editingPlacement}
        placement={editingPlacement}
        vendors={vendors}
        clients={clients}
        employees={employees}
        defaultEmployeeId={initialEmployeeId}
        onClose={() => {
          setCreatingPlacement(false)
          setEditingPlacement(null)
        }}
        onSaved={() => {
          setCreatingPlacement(false)
          setEditingPlacement(null)
          router.refresh()
        }}
      />

      <PartyDialog
        open={!!creatingParty || !!editingParty}
        party={editingParty}
        kind={creatingParty ?? (editingParty && 'payment_terms_days' in editingParty ? 'vendor' : 'client')}
        onClose={() => {
          setCreatingParty(null)
          setEditingParty(null)
        }}
        onSaved={() => {
          setCreatingParty(null)
          setEditingParty(null)
          router.refresh()
        }}
      />

      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Delete &ldquo;{deleting?.label}&rdquo;?</DialogTitle>
          </DialogHeader>
          <DialogBody className="pb-4">
            <p className="text-sm text-ink-muted">
              {deleting?.kind === 'vendor'
                ? 'A vendor with people placed against it cannot be deleted — mark it inactive instead. Invoices already raised are never affected.'
                : deleting?.kind === 'client'
                  ? 'Placements and timesheets keep working; they simply stop naming this end client.'
                  : 'Timesheets already approved keep the earnings recorded against them. This only removes the placement itself.'}
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleting(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" loading={busy} onClick={confirmDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/* ------------------------------------------------------------- Party list */

function PartyList({
  parties, kind, onEdit, onDelete, onCreate,
}: {
  parties: Party[]
  kind: 'vendor' | 'client'
  onEdit: (party: Party) => void
  onDelete: (party: Party) => void
  onCreate: () => void
}) {
  if (!parties.length) {
    return (
      <Card>
        <EmptyState
          icon={Building2}
          title={kind === 'vendor' ? 'No vendors yet' : 'No end clients yet'}
          description={
            kind === 'vendor'
              ? 'A vendor is the company you invoice. Timesheets are billed to one.'
              : 'An end client is where the employee actually sits. You never invoice them directly.'
          }
          action={<Button onClick={onCreate}>Add {kind === 'vendor' ? 'a vendor' : 'a client'}</Button>}
        />
      </Card>
    )
  }

  return (
    <ul className="space-y-2.5">
      {parties.map((party) => (
        <li key={party.id}>
          <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate font-medium">{party.name}</p>
                {party.status === 'inactive' ? (
                  <StatusChip status="inactive" label="Inactive" />
                ) : null}
              </div>
              <p className="mt-0.5 truncate text-[13px] text-ink-muted">
                {[party.contact_name, party.email, party.phone].filter(Boolean).join(' · ') ||
                  'No contact details'}
              </p>
              {kind === 'vendor' && party.payment_terms_days != null ? (
                <p className="tabular mt-0.5 text-xs text-ink-muted">
                  Net {party.payment_terms_days} days
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button size="icon" variant="ghost" aria-label="Edit" onClick={() => onEdit(party)}>
                <Pencil />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Delete"
                onClick={() => onDelete(party)}
              >
                <Trash2 />
              </Button>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  )
}

/* --------------------------------------------------------- Party dialog */

function PartyDialog({
  open, party, kind, onClose, onSaved,
}: {
  open: boolean
  party: Party | null
  kind: 'vendor' | 'client'
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = React.useState('')
  const [contactName, setContactName] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [phone, setPhone] = React.useState('')
  const [line1, setLine1] = React.useState('')
  const [city, setCity] = React.useState('')
  const [country, setCountry] = React.useState('')
  const [terms, setTerms] = React.useState('30')
  const [status, setStatus] = React.useState('active')
  const [notes, setNotes] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [fields, setFields] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setError(null)
    setFields({})
    setName(party?.name ?? '')
    setContactName(party?.contact_name ?? '')
    setEmail(party?.email ?? '')
    setPhone(party?.phone ?? '')
    setLine1(party?.address?.line1 ?? '')
    setCity(party?.address?.city ?? '')
    setCountry(party?.address?.country ?? '')
    setTerms(String(party?.payment_terms_days ?? 30))
    setStatus(party?.status ?? 'active')
    setNotes(party?.notes ?? '')
  }, [open, party])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)

    const body: Record<string, unknown> = {
      name,
      contactName: contactName || undefined,
      email: email || '',
      address: { line1: line1 || undefined, city: city || undefined, country: country || undefined },
      notes: notes || undefined,
      status,
    }
    if (kind === 'vendor') {
      body.phone = phone || undefined
      body.paymentTermsDays = terms || 30
    }

    const base = kind === 'vendor' ? '/api/org/vendors' : '/api/org/clients'

    try {
      if (party) await apiPatch(`${base}/${party.id}`, body)
      else await apiPost(base, body)
      toast.success(party ? 'Saved' : `${kind === 'vendor' ? 'Vendor' : 'Client'} added`)
      onSaved()
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message)
        setFields(err.fields ?? {})
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>
              {party ? 'Edit' : 'New'} {kind === 'vendor' ? 'vendor' : 'end client'}
            </DialogTitle>
            <DialogDescription>
              {kind === 'vendor'
                ? 'The company you invoice for this work.'
                : 'Where the employee actually sits. Never invoiced directly.'}
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-4">
            <FormError message={error} />

            <FormField label="Name" error={fields.name} required>
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </FormField>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Contact name" error={fields.contactName}>
                <Input value={contactName} onChange={(e) => setContactName(e.target.value)} />
              </FormField>
              <FormField label="Email" error={fields.email}>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </FormField>
            </div>

            {kind === 'vendor' ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Phone" error={fields.phone}>
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
                </FormField>
                <FormField
                  label="Payment terms"
                  error={fields.paymentTermsDays}
                  hint="Days. Sets the due date on invoices to this vendor."
                >
                  <Input
                    type="number"
                    min={0}
                    max={365}
                    value={terms}
                    onChange={(e) => setTerms(e.target.value)}
                  />
                </FormField>
              </div>
            ) : null}

            <FormField label="Address" hint="Printed on the invoice.">
              <Input
                value={line1}
                onChange={(e) => setLine1(e.target.value)}
                placeholder="Street address"
              />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="City">
                <Input value={city} onChange={(e) => setCity(e.target.value)} />
              </FormField>
              <FormField label="Country">
                <Input value={country} onChange={(e) => setCountry(e.target.value)} />
              </FormField>
            </div>

            <FormField label="Status">
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </Select>
            </FormField>

            <FormField label="Notes">
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </FormField>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              {party ? 'Save changes' : 'Add'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ----------------------------------------------------- Placement dialog */

function PlacementDialog({
  open, placement, vendors, clients, employees, defaultEmployeeId, onClose, onSaved,
}: {
  open: boolean
  placement: Placement | null
  vendors: Party[]
  clients: Party[]
  employees: Person[]
  defaultEmployeeId: string
  onClose: () => void
  onSaved: () => void
}) {
  const [employeeId, setEmployeeId] = React.useState('')
  const [vendorId, setVendorId] = React.useState('')
  const [clientId, setClientId] = React.useState('')
  const [billRate, setBillRate] = React.useState('')
  const [payRate, setPayRate] = React.useState('')
  const [currency, setCurrency] = React.useState('USD')
  const [rateUnit, setRateUnit] = React.useState('hour')
  const [startDate, setStartDate] = React.useState('')
  const [endDate, setEndDate] = React.useState('')
  const [isPrimary, setIsPrimary] = React.useState(true)
  const [status, setStatus] = React.useState('active')
  const [notes, setNotes] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [fields, setFields] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setError(null)
    setFields({})
    setEmployeeId(placement?.employee_id ?? defaultEmployeeId)
    setVendorId(placement?.vendor_id ?? '')
    setClientId(placement?.client_id ?? '')
    setBillRate(placement?.bill_rate == null ? '' : String(placement.bill_rate))
    setPayRate(placement?.pay_rate == null ? '' : String(placement.pay_rate))
    setCurrency(placement?.bill_currency ?? 'USD')
    setRateUnit(placement?.rate_unit ?? 'hour')
    setStartDate(placement?.start_date ?? '')
    setEndDate(placement?.end_date ?? '')
    setIsPrimary(placement?.is_primary ?? true)
    setStatus(placement?.status ?? 'active')
    setNotes(placement?.notes ?? '')
  }, [open, placement, defaultEmployeeId])

  /*
   * The same warning the server enforces, shown before the round trip. Only
   * meaningful when both rates share a currency — comparing 40 USD to 3000 INR
   * says nothing.
   */
  const inverted =
    billRate !== '' && payRate !== '' && Number(payRate) > Number(billRate)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)

    const body = {
      employeeId,
      vendorId,
      clientId: clientId || null,
      billRate: billRate === '' ? '' : Number(billRate),
      billCurrency: currency,
      payRate: payRate === '' ? '' : Number(payRate),
      payCurrency: currency,
      rateUnit,
      startDate: startDate || null,
      endDate: endDate || null,
      isPrimary,
      status,
      notes: notes || undefined,
    }

    try {
      if (placement) await apiPatch(`/api/org/placements/${placement.id}`, body)
      else await apiPost('/api/org/placements', body)
      toast.success(placement ? 'Placement saved' : 'Placement added')
      onSaved()
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message)
        setFields(err.fields ?? {})
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{placement ? 'Edit placement' : 'New placement'}</DialogTitle>
            <DialogDescription>
              The vendor is invoiced; the end client is where they sit. The two rates are what the
              vendor pays us and what we pay the employee.
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-4">
            <FormError message={error} />

            <FormField label="Employee" error={fields.employeeId} required>
              <Select
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                disabled={!!placement}
              >
                <option value="">Select an employee</option>
                {employees.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.full_name || person.email}
                  </option>
                ))}
              </Select>
            </FormField>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Vendor" error={fields.vendorId} required>
                <Select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                  <option value="">Select a vendor</option>
                  {vendors
                    .filter((v) => v.status === 'active' || v.id === vendorId)
                    .map((vendor) => (
                      <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
                    ))}
                </Select>
              </FormField>
              <FormField label="End client" error={fields.clientId}>
                <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
                  <option value="">None</option>
                  {clients
                    .filter((c) => c.status === 'active' || c.id === clientId)
                    .map((client) => (
                      <option key={client.id} value={client.id}>{client.name}</option>
                    ))}
                </Select>
              </FormField>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <FormField
                label="Bill rate"
                error={fields.billRate}
                hint="What the vendor pays."
              >
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={billRate}
                  onChange={(e) => setBillRate(e.target.value)}
                />
              </FormField>
              <FormField
                label="Pay rate"
                error={fields.payRate}
                hint="What the employee earns."
              >
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={payRate}
                  onChange={(e) => setPayRate(e.target.value)}
                  aria-invalid={inverted || undefined}
                />
              </FormField>
              <FormField label="Per">
                <Select value={rateUnit} onChange={(e) => setRateUnit(e.target.value)}>
                  {RATE_UNITS.map((unit) => (
                    <option key={unit} value={unit}>{unit}</option>
                  ))}
                </Select>
              </FormField>
            </div>

            {inverted ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-800">
                The pay rate is above the bill rate. That is allowed, but it is usually the two
                figures the wrong way round — worth a second look.
              </p>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label="Currency" error={fields.billCurrency}>
                <Input
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                  maxLength={3}
                  placeholder="USD"
                />
              </FormField>
              <FormField label="Start date" error={fields.startDate}>
                <DateField value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </FormField>
              <FormField label="End date" error={fields.endDate}>
                <DateField value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </FormField>
            </div>

            <FormField label="Status">
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="active">Active</option>
                <option value="ended">Ended</option>
              </Select>
            </FormField>

            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-page px-3.5 py-3">
              <Checkbox
                checked={isPrimary}
                onChange={(e) => setIsPrimary(e.target.checked)}
                className="mt-0.5"
              />
              <span className="text-[13px] leading-relaxed">
                <span className="font-medium text-ink">Primary placement</span>
                <span className="mt-0.5 block text-ink-muted">
                  New timesheets default to this one. Only one placement per person can be primary.
                </span>
              </span>
            </label>

            <FormField label="Notes">
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </FormField>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} disabled={!employeeId || !vendorId}>
              {placement ? 'Save changes' : 'Add placement'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
