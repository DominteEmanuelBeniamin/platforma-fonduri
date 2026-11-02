'use client'

import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AlertTriangle, Mail, Paperclip, Share2, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { Spinner } from '@/components/ui/Spinner'

type ApiFetch = (url: string, init?: RequestInit) => Promise<Response>

/** Ce trimitem: un fișier încărcat sau un atașament al cererii (model, document trimis clientului). */
export type EmailTarget =
  | { kind: 'file'; fileId: string }
  | { kind: 'attachment'; requestId: string; attachmentId?: string | null }

function downloadRoute(target: EmailTarget) {
  return target.kind === 'file'
    ? { url: `/api/files/${target.fileId}/signed-download`, extra: {} }
    : { url: `/api/document-requests/${target.requestId}/attachment/signed-download`, extra: target.attachmentId ? { attachment_id: target.attachmentId } : {} }
}

// Tipul fișierului după extensie: atașamentele n-au tipul salvat, iar Chrome pe
// Android decide după el (și după extensie) dacă îl poate da altei aplicații.
const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  txt: 'text/plain', csv: 'text/csv',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

function mimeFor(fileName: string, known?: string | null) {
  if (known && known !== 'application/octet-stream') return known
  const extension = fileName.split('.').pop()?.toLowerCase() ?? ''
  return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream'
}

function canShareFiles(files: File[]) {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false
  try {
    return navigator.canShare({ files })
  } catch {
    return false
  }
}

/** Doar pe telefon: acolo omul trimite din Gmail, Outlook sau Mail, de pe adresa lui. */
function isPhoneWithShare() {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(pointer: coarse)').matches && canShareFiles([new File([''], 'proba.pdf', { type: 'application/pdf' })])
}

type Stage =
  | { name: 'loading' }
  | { name: 'ready'; file: File }
  | { name: 'unsupported' }
  | { name: 'failed'; message: string }

/**
 * „Trimite pe email”, pe telefon: deschide meniul „Partajează” al telefonului
 * cu documentul atașat, iar omul alege Gmail, Outlook sau Mail și trimite de pe
 * adresa lui. Un site nu poate deschide aplicația de email cu un fișier atașat
 * altfel (`mailto:` nu acceptă atașamente). Pe calculator butonul nu apare.
 *
 * Fișierul se aduce la deschiderea ferestrei: telefonul cere ca partajarea să
 * pornească chiar din apăsarea butonului, nu după o descărcare.
 */
export function EmailFileButton({
  target,
  fileName,
  mimeType,
  apiFetch,
  className = '',
}: {
  target: EmailTarget
  fileName: string
  mimeType?: string | null
  documentName?: string | null
  apiFetch: ApiFetch
  className?: string
}) {
  const [available, setAvailable] = useState(false)
  const [open, setOpen] = useState(false)
  const [stage, setStage] = useState<Stage>({ name: 'loading' })
  const route = downloadRoute(target)
  const routeKey = route.url + JSON.stringify(route.extra)

  useEffect(() => {
    setAvailable(isPhoneWithShare())
  }, [])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setStage({ name: 'loading' })
    void (async () => {
      try {
        const res = await apiFetch(route.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expiresIn: 120, ...route.extra }),
        })
        const { url } = res.ok ? await res.json() as { url?: string } : {}
        if (!url) throw new Error('Nu am primit documentul de la server.')
        const response = await fetch(url)
        if (!response.ok) throw new Error('Documentul nu s-a putut descărca.')
        const blob = await response.blob()
        const file = new File([blob], fileName, { type: mimeFor(fileName, mimeType ?? (blob.type || null)) })
        if (cancelled) return
        setStage(canShareFiles([file]) ? { name: 'ready', file } : { name: 'unsupported' })
      } catch (error) {
        if (!cancelled) setStage({ name: 'failed', message: error instanceof Error ? error.message : 'Documentul nu s-a putut pregăti.' })
      }
    })()
    return () => { cancelled = true }
    // `routeKey` ține locul obiectului `route`, refăcut la fiecare desenare.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, routeKey, fileName, mimeType, apiFetch])

  const share = () => {
    if (stage.name !== 'ready') return
    // Doar fișierul și titlul: cu text pe lângă, unele aplicații (Gmail pe iPhone)
    // păstrează textul și pierd atașamentul.
    navigator.share({ files: [stage.file], title: fileName })
      .then(() => setOpen(false))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        const name = error instanceof DOMException ? error.name : 'Error'
        setStage({
          name: 'failed',
          message: name === 'NotAllowedError'
            ? 'Telefonul n-a permis deschiderea aplicației. Închide fereastra și încearcă din nou.'
            : `Telefonul n-a putut deschide aplicația de email (${name}).`,
        })
      })
  }

  if (!available) return null

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          onClick={event => event.stopPropagation()}
          title="Trimite pe email"
          aria-label={`Trimite pe email ${fileName}`}
          className={className || 'p-2 rounded-lg text-ink-faint hover:text-[var(--sg-accent)] hover:bg-paper-sunk transition-colors'}
        >
          <Mail className="h-4 w-4" aria-hidden="true" />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[1000001]" style={{ backgroundColor: 'rgb(22 24 28 / 0.45)' }} />
        <Dialog.Content
          onClick={event => event.stopPropagation()}
          className="fixed inset-x-0 bottom-0 z-[1000001] rounded-t-[var(--radius-plate-lg)] border border-rule bg-plate pb-[max(1rem,env(safe-area-inset-bottom))] focus:outline-none"
          style={{ boxShadow: 'var(--sg-lift)' }}
        >
          <div className="flex items-start justify-between gap-3 border-b border-rule px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="text-lg font-bold text-ink">Trimite pe email</Dialog.Title>
              <Dialog.Description className="mt-1 flex items-center gap-1.5 text-sm text-ink-soft">
                <Paperclip className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{fileName}</span>
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <IconButton label="Închide"><X className="h-4 w-4" aria-hidden="true" /></IconButton>
            </Dialog.Close>
          </div>

          <div className="space-y-3 px-5 py-5">
            {stage.name === 'unsupported' ? (
              <p role="alert" className="flex gap-3 text-sm leading-6 text-ink">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--sg-warn)]" aria-hidden="true" />
                <span>Pe acest telefon, browserul nu poate da acest tip de fișier altei aplicații (de obicei Word sau Excel, pe Android). Descarcă-l și atașează-l din aplicația de email.</span>
              </p>
            ) : (
              <>
                <Button type="button" variant="primary" className="w-full" onClick={share} disabled={stage.name !== 'ready'}>
                  {stage.name === 'loading' ? <Spinner size="sm" /> : <Share2 className="h-4 w-4" aria-hidden="true" />}
                  {stage.name === 'loading' ? 'Se pregătește documentul…' : 'Deschide aplicația de email'}
                </Button>
                {stage.name === 'failed' ? (
                  <p role="alert" className="text-sm leading-6 text-[var(--sg-danger)]">{stage.message}</p>
                ) : (
                  <p className="text-sm leading-6 text-ink-soft">
                    Alegi Gmail, Outlook sau Mail; documentul e deja atașat. Scrii adresa și trimiți de pe emailul tău.
                  </p>
                )}
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
