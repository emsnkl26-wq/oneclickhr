'use client'

import { Moon, Sun } from 'lucide-react'
import { useTheme } from '@/components/theme-provider'
import { cn } from '@/lib/utils'

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useTheme()

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      className={cn(
        'focus-ring grid size-8 shrink-0 place-items-center rounded-lg text-sidebar-muted transition hover:bg-sidebar-hover hover:text-sidebar-fg',
        className
      )}
    >
      {theme === 'dark' ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
    </button>
  )
}

/** A labelled Light / Dark switch for settings pages. */
export function AppearanceSetting({ className }: { className?: string }) {
  const { theme, toggleTheme } = useTheme()
  const options = [
    { value: 'light', label: 'Light', Icon: Sun },
    { value: 'dark', label: 'Dark', Icon: Moon },
  ] as const

  return (
    <div className={cn('card-surface flex flex-wrap items-center justify-between gap-4 p-5', className)}>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">Appearance</p>
        <p className="text-xs text-ink-muted">Choose how the app looks on this device.</p>
      </div>
      <div role="radiogroup" aria-label="Theme" className="inline-flex rounded-lg border border-line bg-page p-1">
        {options.map(({ value, label, Icon }) => {
          const active = theme === value
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => (active ? undefined : toggleTheme())}
              className={cn(
                'focus-ring inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition',
                active ? 'bg-card text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
              )}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
