import type { Config } from 'tailwindcss'

/**
 * Oneclickhr design tokens.
 *
 * Every colour is declared as an HSL triple on :root in globals.css and read
 * through `hsl(var(--token))` here. That indirection is what makes per-org
 * theming possible: an org's saved primary colour is written to `--brand-600`
 * (and its derived shades) on the workspace shell at request time, and every
 * `bg-brand-600` in the app follows without a single conditional class.
 *
 * Discipline: ONE deliberate accent (crimson) on active nav, primary buttons and
 * headline numbers. Everything else stays neutral.
 */
const config: Config = {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '1.5rem',
      screens: { '2xl': '1440px' },
    },
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand: {
          50:  'hsl(var(--brand-50))',
          100: 'hsl(var(--brand-100))',
          200: 'hsl(var(--brand-200))',
          500: 'hsl(var(--brand-500))',
          600: 'hsl(var(--brand-600))',
          700: 'hsl(var(--brand-700))',
          800: 'hsl(var(--brand-800))',
          DEFAULT: 'hsl(var(--brand-600))',
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar))',
          fg: 'hsl(var(--sidebar-fg))',
          muted: 'hsl(var(--sidebar-muted))',
          hover: 'hsl(var(--sidebar-hover))',
          border: 'hsl(var(--sidebar-border))',
        },
        page: 'hsl(var(--page-bg))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--text))',
        },
        ink: {
          DEFAULT: 'hsl(var(--text))',
          muted: 'hsl(var(--muted))',
        },
        line: 'hsl(var(--border))',

        success: 'hsl(var(--success))',
        warning: 'hsl(var(--warning))',
        info: 'hsl(var(--info))',
        danger: 'hsl(var(--danger))',

        // shadcn/ui contract
        border: 'hsl(var(--border))',
        input: 'hsl(var(--border))',
        ring: 'hsl(var(--brand-600))',
        background: 'hsl(var(--page-bg))',
        foreground: 'hsl(var(--text))',
        primary: {
          DEFAULT: 'hsl(var(--brand-600))',
          foreground: '0 0% 100%',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--text))',
        },
        muted: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--muted))',
        },
        accent: {
          DEFAULT: 'hsl(var(--brand-50))',
          foreground: 'hsl(var(--brand-700))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--danger))',
          foreground: '0 0% 100%',
        },
        popover: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--text))',
        },
      },
      borderRadius: {
        lg: '0.625rem',
        xl: '0.875rem',
        '2xl': '1.125rem',
      },
      boxShadow: {
        // Soft and barely-there. Depth comes from the 1px border, not the shadow.
        sm: '0 1px 2px 0 rgb(16 24 40 / 0.04), 0 1px 3px 0 rgb(16 24 40 / 0.04)',
        card: '0 1px 2px 0 rgb(16 24 40 / 0.04), 0 4px 16px -6px rgb(16 24 40 / 0.06)',
        pop: '0 12px 40px -12px rgb(16 24 40 / 0.18)',
      },
      keyframes: {
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'slide-up': {
          '0%': { transform: 'translateY(8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'slide-in-left': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.25s ease-out both',
        'slide-up': 'slide-up 0.3s cubic-bezier(0.16,1,0.3,1) both',
        'slide-in-left': 'slide-in-left 0.25s cubic-bezier(0.16,1,0.3,1) both',
        shimmer: 'shimmer 1.6s infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}

export default config
