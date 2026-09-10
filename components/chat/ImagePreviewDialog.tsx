'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { ChevronLeft, ChevronRight, Download } from 'lucide-react'
import type { ChatImage } from '@/lib/project-chat-contracts'

type Preview = { messageId: string; image: ChatImage }

/**
 * Previzualizarea unei imagini din chat, pe tot ecranul, cu navigare între
 * imaginile aceluiași mesaj. A stat 62 de linii în burta lui
 * `ProjectChatDrawer`; aici e o suprafață de sine stătătoare.
 */
export default function ImagePreviewDialog({
  preview,
  setPreview,
  siblings,
  index,
  onStep,
  unavailableImages,
  imageRetryKey,
  onImageError,
  onDownload,
  downloading,
}: {
  preview: Preview | null
  setPreview: (p: Preview | null) => void
  siblings: ChatImage[]
  index: number
  onStep: (delta: number) => void
  unavailableImages: Set<string>
  imageRetryKey: (messageId: string, image: ChatImage) => string
  onImageError: (messageId: string, image: ChatImage) => void
  onDownload?: (messageId: string, image: ChatImage) => void
  downloading?: boolean
}) {
  return (
    <Dialog.Root open={!!preview} onOpenChange={(open) => { if (!open) setPreview(null); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[1000000] backdrop-blur-sm" style={{ backgroundColor: 'rgb(22 24 28 / 0.45)' }} />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[1000001] max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-5xl -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl bg-white p-3 shadow-2xl focus:outline-none sm:max-h-[94vh] sm:w-[calc(100%-2rem)] sm:rounded-2xl sm:p-4">
          <Dialog.Title className="mb-2 truncate pr-8 text-sm font-semibold text-ink sm:mb-3">
            {preview?.image.name ?? 'Imagine'}
            {siblings.length > 1 && index >= 0 && (
              <span className="ml-2 font-normal text-ink-faint">
                {index + 1} din {siblings.length}
              </span>
            )}
          </Dialog.Title>
          <Dialog.Description className="sr-only">Previzualizare imagine din chat</Dialog.Description>
          {preview && preview.image.signedUrl && !unavailableImages.has(imageRetryKey(preview.messageId, preview.image)) ? (
            <div className="relative">
              <img
                src={preview.image.signedUrl}
                alt={preview.image.name}
                className="mx-auto max-h-[calc(100dvh-7rem)] w-auto max-w-full object-contain sm:max-h-[calc(94vh-7.5rem)]"
                onError={() => { onImageError(preview.messageId, preview.image); }}
              />
              {siblings.length > 1 && (
                <>
                  <button
                    type="button"
                    aria-label="Imaginea anterioară"
                    onClick={() => onStep(-1)}
                    className="absolute left-1 top-1/2 -translate-y-1/2 rounded-full bg-ink p-2 text-white transition-colors hover:brightness-90 focus:outline-none focus:ring-2 focus:ring-white"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Imaginea următoare"
                    onClick={() => onStep(1)}
                    className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full bg-ink p-2 text-white transition-colors hover:brightness-90 focus:outline-none focus:ring-2 focus:ring-white"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </>
              )}
            </div>
          ) : (
            <p className="py-12 text-center text-sm text-ink-soft">Imagine indisponibilă</p>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <Dialog.Close asChild>
              <button type="button" className="rounded-lg px-3 py-2 text-sm text-ink-soft hover:bg-paper-sunk">Închide</button>
            </Dialog.Close>
            {preview && (
              <button
                type="button"
                onClick={() => onDownload?.(preview.messageId, preview.image)}
                disabled={downloading}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-plate)] bg-[var(--sg-accent)] px-3 text-sm font-semibold text-white transition-colors duration-[120ms] hover:bg-[var(--sg-accent-ink)] disabled:opacity-55 sm:min-h-10"
              >
                <Download className="h-4 w-4" /> Descarcă
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
