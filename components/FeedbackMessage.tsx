import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'

export type FeedbackVariant = 'success' | 'info' | 'warning' | 'error'

const styles = {
  success: { Icon: CheckCircle2, box: 'border-emerald-200 bg-emerald-50 text-emerald-900', icon: 'text-emerald-600' },
  info: { Icon: Info, box: 'border-blue-200 bg-blue-50 text-blue-900', icon: 'text-blue-600' },
  warning: { Icon: AlertTriangle, box: 'border-amber-200 bg-amber-50 text-amber-900', icon: 'text-amber-600' },
  error: { Icon: XCircle, box: 'border-red-200 bg-red-50 text-red-900', icon: 'text-red-600' },
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
