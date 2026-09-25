'use client'

/**
 * The top of the board: which country's jobs are showing, and the big search.
 *
 * The country is part of the URL (`?country=US`, or `all`), so switching it is a
 * real query and a shareable link. Only countries that actually have postings
 * are offered — a switcher full of empty countries is a list of dead ends.
 */

import * as React from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { ArrowRight, Check, ChevronDown, Globe, Search } from 'lucide-react'
import { useProgressRouter } from '@/lib/use-progress-router'
import { countryName } from '@/lib/geo'
import { countryFlag } from '@/lib/job-viewer'
import { cn } from '@/lib/utils'

export function JobHero({
  country, countries, q,
}: {
  /** The country being shown, or null for all of them. */
  country: string | null
  countries: Array<{ code: string; count: number }>
  q: string
}) {
  const router = useProgressRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [term, setTerm] = React.useState(q)
  const [open, setOpen] = React.useState(false)

  React.useEffect(() => setTerm(q), [q])

  function go(mutate: (query: URLSearchParams) => void) {
    const query = new URLSearchParams(params.toString())
    mutate(query)
    query.delete('page')
    const qs = query.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  function chooseCountry(code: string | null) {
    setOpen(false)
    go((query) => query.set('country', code ?? 'all'))
  }

  const label = country ? countryName(country) : 'all countries'

  return (
    <section className="relative isolate overflow-hidden bg-[#12141a] text-white">
      {/* Our crimson, as light rather than as a block of colour. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-90"
        style={{
          background:
            'radial-gradient(60% 80% at 15% 0%, hsl(352 73% 44% / 0.35), transparent 60%),' +
            'radial-gradient(50% 70% at 90% 100%, hsl(352 73% 44% / 0.22), transparent 60%)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.07]"
        style={{
          backgroundImage:
            'linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      <div className="mx-auto flex max-w-5xl flex-col items-center px-4 py-14 text-center sm:px-6 sm:py-20">
        <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
          <PopoverPrimitive.Trigger asChild>
            <button
              type="button"
              className="focus-ring inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-sm font-semibold backdrop-blur transition hover:bg-white/10"
            >
              <span aria-hidden>{country ? countryFlag(country) : <Globe className="size-4" />}</span>
              Showing jobs in {label}
              <ChevronDown className="size-4 opacity-70" aria-hidden />
            </button>
          </PopoverPrimitive.Trigger>
          <PopoverPrimitive.Portal>
            <PopoverPrimitive.Content
              sideOffset={8}
              className="z-50 max-h-80 w-64 overflow-y-auto rounded-xl border border-line bg-card p-1.5 text-ink shadow-pop"
            >
              <CountryOption
                active={!country}
                onClick={() => chooseCountry(null)}
                flag={<Globe className="size-4 text-ink-muted" />}
                label="All countries"
                count={countries.reduce((sum, c) => sum + c.count, 0)}
              />
              {countries.map((c) => (
                <CountryOption
                  key={c.code}
                  active={country === c.code}
                  onClick={() => chooseCountry(c.code)}
                  flag={<span>{countryFlag(c.code)}</span>}
                  label={countryName(c.code)}
                  count={c.count}
                />
              ))}
            </PopoverPrimitive.Content>
          </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>

        <h1 className="mt-6 text-balance text-[34px] font-bold leading-[1.1] tracking-[-0.03em] sm:text-5xl lg:text-[56px]">
          Explore career opportunities
          <br className="hidden sm:block" /> with{' '}
          <span className="text-[hsl(352_85%_62%)]">Oneclickhr</span> companies
        </h1>
        <p className="mt-5 max-w-2xl text-pretty text-[15px] leading-relaxed text-white/70 sm:text-base">
          Full-time, contract, C2C and W2 roles from organizations hiring on Oneclickhr. Create a
          free account to apply in a click and follow every application.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            go((query) => {
              const value = term.trim().slice(0, 80)
              if (value) query.set('q', value)
              else query.delete('q')
            })
          }}
          className="mt-8 flex w-full max-w-3xl flex-col gap-2 rounded-2xl border border-white/10 bg-white/5 p-2 backdrop-blur sm:flex-row"
        >
          <label className="relative flex-1">
            <span className="sr-only">Search jobs</span>
            <Search
              className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-white/50"
              aria-hidden
            />
            <input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Search by job title, skill, client or location…"
              className="h-12 w-full rounded-xl bg-white/10 pl-12 pr-4 text-[15px] text-white placeholder:text-white/45 outline-none ring-brand-500 focus:ring-2"
            />
          </label>
          <button
            type="submit"
            className="focus-ring inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-brand-600 px-6 text-[15px] font-semibold text-white shadow-lg shadow-brand-600/30 transition hover:bg-brand-700"
          >
            Search jobs
            <ArrowRight className="size-4" aria-hidden />
          </button>
        </form>
      </div>
    </section>
  )
}

function CountryOption({
  active, onClick, flag, label, count,
}: {
  active: boolean
  onClick: () => void
  flag: React.ReactNode
  label: string
  count: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition hover:bg-page',
        active && 'bg-brand-50 font-semibold text-brand-700'
      )}
    >
      <span className="grid w-5 place-items-center" aria-hidden>
        {flag}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="tabular text-xs text-ink-muted">{count}</span>
      {active ? <Check className="size-4" aria-hidden /> : null}
    </button>
  )
}
