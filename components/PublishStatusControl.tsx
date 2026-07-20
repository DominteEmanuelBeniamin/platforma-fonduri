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
  const badgeClass = size === 'sm' ? 'text-[10px] px-2 py-0.5' : 'text-[11px] px-2.5 py-1'
  const btnClass = size === 'sm' ? 'text-[10px] px-2 py-1' : 'text-[11px] px-2.5 py-1.5'

  return (
    <div className="flex items-center gap-1.5 flex-shrink-0" onClick={e => e.stopPropagation()}>
      <span
        className={`inline-flex items-center gap-1 font-bold rounded-full ${badgeClass} ${
          isDraft ? 'bg-[var(--p-draft-soft)] text-[var(--p-draft)]' : 'bg-[var(--p-success-soft)] text-[var(--p-success)]'
        }`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-current" />
        {isDraft ? 'În pregătire' : 'Public'}
      </span>
      {canPublish && (
        isDraft ? (
          <button
            type="button"
            onClick={onToggle}
            className={`font-bold rounded-lg bg-[var(--p-accent)] text-white hover:opacity-90 transition-opacity ${btnClass}`}
          >
            Publică
          </button>
        ) : (
          <button
            type="button"
            onClick={onToggle}
            title="Revenire la „În pregătire” — decizie deschisă în #53, neconfirmată încă"
            className="text-[10px] font-semibold text-[var(--p-ink-faint)] hover:text-[var(--p-ink-soft)] underline decoration-dotted underline-offset-2"
          >
            Retrage*
          </button>
        )
      )}
    </div>
  )
}
