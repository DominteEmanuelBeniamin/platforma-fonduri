'use client'

interface PublishStatusControlProps {
  status: 'draft' | 'public'
  canPublish: boolean
  onToggle: () => void
  size?: 'sm' | 'md'
}

/**
 * Machetă UI pentru #53 — doar aspect vizual, stare locală (nu vine din API,
 * nu se salvează). Logica reală de vizibilitate se leagă separat, mai târziu.
 */
export default function PublishStatusControl({ status, canPublish, onToggle, size = 'md' }: PublishStatusControlProps) {
  const isDraft = status === 'draft'
  const textClass = size === 'sm' ? 'text-xs' : 'text-[13px]'
  const colorClass = isDraft ? 'text-[var(--p-ink-faint)]' : 'text-[var(--p-success)]'

  if (!canPublish) {
    return (
      <span className={`inline-flex items-center gap-1.5 flex-shrink-0 ${textClass} ${colorClass}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-current" />
        {isDraft ? 'În pregătire' : 'Public'}
      </span>
    )
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={!isDraft}
      onClick={e => { e.stopPropagation(); onToggle() }}
      title={isDraft ? 'Apasă ca să publici — devine vizibil clientului' : 'Apasă ca să retragi — devine invizibil clientului'}
      className={`inline-flex items-center gap-2 flex-shrink-0 ${textClass}`}
    >
      <span className={`relative inline-flex h-4 w-7 flex-shrink-0 items-center rounded-full transition-colors ${isDraft ? 'bg-[var(--p-border-strong)]' : 'bg-[var(--p-success)]'}`}>
        <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${isDraft ? 'translate-x-0.5' : 'translate-x-3.5'}`} />
      </span>
      <span className={colorClass}>{isDraft ? 'În pregătire' : 'Public'}</span>
    </button>
  )
}
