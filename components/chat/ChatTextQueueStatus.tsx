'use client'

import type { ChatTextQueueItem } from '@/hooks/useChatTextQueue'

type Props = {
  items: ChatTextQueueItem[]
  sendingId: number | null
  failed: boolean
  onRetry: () => void
  onDiscard: () => void
}

export default function ChatTextQueueStatus({ items, sendingId, failed, onRetry, onDiscard }: Props) {
  const first = items[0]
  if (!first) return null

  const label = failed
    ? 'Nu s-a trimis'
    : sendingId === first.id
      ? 'Se trimite'
      : 'În așteptare'

  return (
    <div className="mb-2 max-h-9 overflow-hidden rounded-lg bg-paper-sunk px-2 py-1 text-xs text-ink-soft" role="status">
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate" title={first.text}>
          {label}: {first.text}
        </span>
        {items.length > 1 && <span className="shrink-0">+{items.length - 1} în așteptare</span>}
        {failed && (
          <>
            <button
              type="button"
              onClick={onRetry}
              className="shrink-0 font-semibold text-ink underline"
              aria-label="Reîncearcă trimiterea mesajului"
            >
              Reîncearcă
            </button>
            <button
              type="button"
              onClick={onDiscard}
              className="shrink-0 font-semibold text-ink underline"
              aria-label="Renunță la mesajul netrimis și pune-l înapoi în editor"
            >
              Renunță
            </button>
          </>
        )}
      </div>
    </div>
  )
}
