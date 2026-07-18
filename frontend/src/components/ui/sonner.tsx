import type { CSSProperties } from 'react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

// theme="system" lets sonner track prefers-color-scheme itself — the app has
// no theme switcher, so next-themes would be dead weight.
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="system"
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
