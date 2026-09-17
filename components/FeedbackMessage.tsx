import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'

export type FeedbackVariant = 'success' | 'info' | 'warning' | 'error'

const styles = {
  success: { Icon: CheckCircle2, box: 'border-[var(--sg-ok)] bg-[var(--sg-ok-soft)] text-[var(--sg-ok)]', icon: 'text-[var(--sg-ok)]' },
  info: { Icon: Info, box: 'border-[var(--sg-accent)] bg-[var(--sg-accent-soft)] text-[var(--sg-accent)]', icon: 'text-[var(--sg-accent)]' },
  warning: { Icon: AlertTriangle, box: 'border-[var(--sg-warn)] bg-[var(--sg-warn-soft)] text-[var(--sg-warn)]', icon: 'text-[var(--sg-warn)]' },
  error: { Icon: XCircle, box: 'border-[var(--sg-danger)] bg-[var(--sg-danger-soft)] text-[var(--sg-danger)]', icon: 'text-[var(--sg-danger)]' },
}

export function FeedbackMessage({
  children,
  variant = 'info',
  onDismiss,
  className = '',
}: {
  children: React.ReactNode
  variant?: FeedbackVariant
  onDismiss?: () => void
  className?: string
}) {
  const { Icon, box, icon } = styles[variant]

  return (
    <div
      className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-sm ${box} ${className}`}
      role={variant === 'error' || variant === 'warning' ? 'alert' : 'status'}
      aria-live={variant === 'error' || variant === 'warning' ? 'assertive' : 'polite'}
    >
      <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${icon}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">{children}</div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Închide mesajul" className="-mr-1 -mt-1 rounded p-1 opacity-70 hover:opacity-100">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
