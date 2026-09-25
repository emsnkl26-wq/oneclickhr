import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The orange is reserved for `default` (the one primary action on a screen);
 * `danger` is red. Everything else is neutral — that restraint is what makes the
 * accent read as meaningful rather than decorative.
 *
 * White on #FF6A00 is 2.9:1, so the two filled variants are semibold: the extra
 * weight is what keeps a 14px label legible on a colour this light.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-brand-600 font-semibold text-white shadow-sm hover:bg-brand-700 active:bg-brand-800',
        secondary: 'border border-line bg-card text-ink shadow-sm hover:bg-page',
        ghost: 'text-ink-muted hover:bg-page hover:text-ink',
        danger: 'bg-danger font-semibold text-white shadow-sm hover:bg-danger/90',
        outline: 'border border-brand-600 text-brand-ink hover:bg-brand-50',
        link: 'text-brand-ink underline-offset-4 hover:underline',
        subtle: 'bg-brand-50 text-brand-ink hover:bg-brand-100',
      },
      size: {
        sm: 'h-8 px-3 text-[13px]',
        default: 'h-10 px-4',
        lg: 'h-11 px-6 text-[15px]',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          <>
            <Loader2 className="animate-spin" aria-hidden />
            {children}
          </>
        ) : (
          children
        )}
      </Comp>
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
