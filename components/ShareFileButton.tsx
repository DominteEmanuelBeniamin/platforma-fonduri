'use client'

import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AlertTriangle, Paperclip, Share2, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { Spinner } from '@/components/ui/Spinner'

type ApiFetch = (url: string, init?: RequestInit) => Promise<Response>

/** Ce trimitem: un fișier încărcat sau un atașament al cererii (model, document trimis clientului). */
export type ShareTarget =
  | { kind: 'file'; fileId: string }
  | { kind: 'attachment'; requestId: string; attachmentId?: string | null }

function downloadRoute(target: ShareTarget) {
  return target.kind === 'file'
    ? { url: `/api/files/${target.fileId}/signed-download`, extra: {} }
    : { url: `/api/document-requests/${target.requestId}/attachment/signed-download`, extra: target.attachmentId ? { attachment_id: target.attachmentId } : {} }
}

// Tipurile pe care Chrome le lasă să plece spre alte aplicații (lista din
// Chromium, third_party/blink/renderer/modules/webshare/FILE_TYPES.md). Orice
// altceva — Word, Excel, „application/octet-stream” — primește
// „NotAllowedError: Permission denied”. Tipul îl dăm noi după extensie: cel
// venit de la stocare poate fi generic și ar bloca și un PDF.
const CHROME_SHAREABLE: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', pjp: 'image/jpeg', pjpeg: 'image/jpeg',
  png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp',
  tif: 'image/tiff', tiff: 'image/tiff', svg: 'image/svg+xml',
  txt: 'text/plain', text: 'text/plain', csv: 'text/csv',
  mp3: 'audio/mpeg', m4a: 'audio/x-m4a', wav: 'audio/wav', mp4: 'video/mp4', webm: 'video/webm',
}
// Pe iPhone (Safari) pleacă și documentele Office.
const OTHER_TYPES: Record<string, string> = {
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet',
}

function shareType(fileName: string) {
  const extension = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : ''
  const chrome = CHROME_SHAREABLE[extension]
  return { mime: chrome ?? OTHER_TYPES[extension] ?? null, chromeAllows: !!chrome }
}

/** Chrome (Android, și Chromium în general) refuză tipurile din afara listei. */
function isChromium() {
  return typeof navigator !== 'undefined' && /Chrome|CriOS|Android/i.test(navigator.userAgent) && !/iPhone|iPad|iPod/i.test(navigator.userAgent)
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
  | { name: 'failed'; message: string; file?: File; detail?: string }

/**
 * „Partajează”, pe telefon: deschide meniul „Partajează” al telefonului
 * cu documentul atașat, iar omul alege Gmail, Outlook, WhatsApp etc. și trimite de pe
 * adresa lui. Un site nu poate deschide aplicația de email cu un fișier atașat
 * altfel (`mailto:` nu acceptă atașamente). Pe calculator butonul nu apare.
 *
 * Fișierul se aduce la deschiderea ferestrei: telefonul cere ca partajarea să
 * pornească chiar din apăsarea butonului, nu după o descărcare.
 */
export function ShareFileButton({
  target,
  fileName,
  apiFetch,
  className = '',
}: {
  target: ShareTarget
  fileName: string
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
    const type = shareType(fileName)
    // Știm dinainte că telefonul îl va refuza: nu-l mai descărcăm degeaba.
    if (!type.mime || (isChromium() && !type.chromeAllows)) {
      setStage({ name: 'unsupported' })
      return
    }
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
        const file = new File([blob], fileName, { type: type.mime })
        if (cancelled) return
        setStage(canShareFiles([file]) ? { name: 'ready', file } : { name: 'unsupported' })
      } catch (error) {
        if (!cancelled) setStage({ name: 'failed', message: error instanceof Error ? error.message : 'Documentul nu s-a putut pregăti.' })
      }
    })()
    return () => { cancelled = true }
    // `routeKey` ține locul obiectului `route`, refăcut la fiecare desenare.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, routeKey, fileName, apiFetch])

  const share = () => {
    const file = stage.name === 'ready' || stage.name === 'failed' ? stage.file : undefined
    if (!file) return
    // Doar fișierul și titlul: cu text pe lângă, unele aplicații (Gmail pe iPhone)
    // păstrează textul și pierd atașamentul.
    navigator.share({ files: [file], title: fileName })
      .then(() => setOpen(false))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        const name = error instanceof DOMException ? error.name : 'Error'
        // Fișierul rămâne pregătit: o nouă apăsare e un gest nou al omului, pe
        // care telefonul îl acceptă adesea. Mesajul tehnic al telefonului ne
        // spune de ce a refuzat (gestul nu s-a numărat sau tipul de fișier).
        setStage({
          name: 'failed',
          file,
          message: name === 'NotAllowedError'
            ? 'Telefonul n-a permis deschiderea aplicației. Apasă din nou butonul.'
            : `Telefonul n-a putut deschide meniul de partajare (${name}).`,
          detail: `${name}: ${error instanceof Error ? error.message : String(error)}`,
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
          title="Partajează"
          aria-label={`Partajează ${fileName}`}
          className={className || 'p-2 rounded-lg text-ink-faint hover:text-[var(--sg-accent)] hover:bg-paper-sunk transition-colors'}
        >
          <Share2 className="h-4 w-4" aria-hidden="true" />
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
              <Dialog.Title className="text-lg font-bold text-ink">Partajează documentul</Dialog.Title>
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
                <span>Pe acest telefon, browserul nu lasă acest tip de fișier să plece spre alte aplicații (Chrome pe Android acceptă doar PDF, imagini și text, nu Word sau Excel). Descarcă documentul și atașează-l din aplicația în care vrei să-l trimiți.</span>
              </p>
            ) : (
              <>
                <Button type="button" variant="primary" className="w-full" onClick={share} disabled={stage.name === 'loading' || (stage.name === 'failed' && !stage.file)}>
                  {stage.name === 'loading' ? <Spinner size="sm" /> : <Share2 className="h-4 w-4" aria-hidden="true" />}
                  {stage.name === 'loading' ? 'Se pregătește documentul…' : 'Alege aplicația'}
                </Button>
                {stage.name === 'failed' ? (
                  <div role="alert" className="space-y-1">
                    <p className="text-sm leading-6 text-[var(--sg-danger)]">{stage.message}</p>
                    {stage.detail && <p className="break-words text-xs leading-5 text-ink-faint">{stage.detail}</p>}
                  </div>
                ) : (
                  <p className="text-sm leading-6 text-ink-soft">
                    Alegi Gmail, Outlook, WhatsApp sau altă aplicație; documentul e deja atașat.
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
