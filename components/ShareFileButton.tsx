'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Paperclip, Share2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { Spinner } from '@/components/ui/Spinner'
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTrigger } from '@/components/ui/Sheet'
import { MAX_UPLOAD_FILE_SIZE } from '@/lib/document-action-idempotency'
import { formatFileSize } from '@/lib/upload-selection'

// Cât primește platforma la încărcare și cât acceptă și Gmail ca atașament:
// peste atât, documentul oricum n-ar pleca din aplicația de email.
const MAX_SHARE_BYTES = MAX_UPLOAD_FILE_SIZE

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
  | { name: 'loading'; received: number; total: number | null }
  | { name: 'ready'; file: File }
  | { name: 'unsupported' }
  | { name: 'tooLarge'; size: number }
  | { name: 'failed'; message: string; file?: File }

/** Eroare cu mesaj scris pentru om; orice altceva primește un mesaj general. */
class ShareFailure extends Error {}

class TooLargeError extends Error {
  constructor(readonly size: number) { super('too large') }
}

/**
 * Aduce documentul bucată cu bucată, ca să arătăm cât a venit și să ne oprim
 * imediat ce trece de limită, fără să descărcăm tot pe datele mobile.
 */
async function readWithProgress(
  response: Response,
  signal: AbortSignal,
  onProgress: (received: number, total: number | null) => void,
): Promise<Blob> {
  const header = Number(response.headers.get('Content-Length'))
  const total = Number.isFinite(header) && header > 0 ? header : null
  if (total !== null && total > MAX_SHARE_BYTES) throw new TooLargeError(total)
  if (!response.body) {
    const blob = await response.blob()
    if (blob.size > MAX_SHARE_BYTES) throw new TooLargeError(blob.size)
    return blob
  }
  const reader = response.body.getReader()
  const chunks: BlobPart[] = []
  let received = 0
  let lastReported = -1
  onProgress(0, total)
  while (true) {
    if (signal.aborted) {
      await reader.cancel()
      throw new DOMException('Aborted', 'AbortError')
    }
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value as Uint8Array<ArrayBuffer>)
    received += value.byteLength
    if (received > MAX_SHARE_BYTES) {
      await reader.cancel()
      throw new TooLargeError(total ?? received)
    }
    // Un procent nou (sau, fără mărime cunoscută, câte 256 KB) e destul de des.
    const step = total ? Math.floor((received / total) * 100) : Math.floor(received / 262144)
    if (step !== lastReported) {
      lastReported = step
      onProgress(received, total)
    }
  }
  return new Blob(chunks)
}

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
}: {
  target: ShareTarget
  fileName: string
  documentName?: string | null
  apiFetch: ApiFetch
}) {
  const [available, setAvailable] = useState(false)
  const [open, setOpen] = useState(false)
  const [stage, setStage] = useState<Stage>({ name: 'loading', received: 0, total: null })
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
    // Închiderea ferestrei oprește și descărcarea, nu doar afișarea ei.
    const controller = new AbortController()
    const { signal } = controller
    setStage({ name: 'loading', received: 0, total: null })
    void (async () => {
      try {
        const res = await apiFetch(route.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expiresIn: 120, ...route.extra }),
          signal,
        })
        const { url } = res.ok ? await res.json() as { url?: string } : {}
        if (!url) throw new ShareFailure('Nu am primit documentul de la server. Încearcă din nou.')
        const response = await fetch(url, { signal })
        if (!response.ok) throw new ShareFailure('Documentul nu s-a putut descărca. Încearcă din nou.')
        const blob = await readWithProgress(response, signal, (received, total) => {
          if (!signal.aborted) setStage({ name: 'loading', received, total })
        })
        const file = new File([blob], fileName, { type: type.mime })
        if (signal.aborted) return
        setStage(canShareFiles([file]) ? { name: 'ready', file } : { name: 'unsupported' })
      } catch (error) {
        if (signal.aborted) return
        if (error instanceof TooLargeError) {
          setStage({ name: 'tooLarge', size: error.size })
          return
        }
        console.warn('[Partajează] pregătirea documentului a eșuat', error)
        setStage({
          name: 'failed',
          message: error instanceof TypeError
            ? 'Conexiunea s-a întrerupt. Verifică internetul și deschide din nou.'
            : error instanceof ShareFailure ? error.message : 'Documentul nu s-a putut pregăti. Încearcă din nou.',
        })
      }
    })()
    return () => controller.abort()
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
        // care telefonul îl acceptă adesea. Motivul tehnic (gestul nu s-a
        // numărat sau tipul de fișier) merge în consolă, nu în fața omului.
        console.warn('[Partajează] telefonul a refuzat meniul de partajare', error)
        setStage({
          name: 'failed',
          file,
          message: name === 'NotAllowedError'
            ? 'Telefonul n-a permis deschiderea meniului. Apasă din nou butonul.'
            : 'Telefonul n-a putut deschide meniul de partajare. Încearcă din nou sau descarcă documentul.',
        })
      })
  }

  if (!available) return null

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <IconButton
          label={`Partajează ${fileName}`}
          title="Partajează"
          onClick={event => event.stopPropagation()}
        >
          <Share2 className="h-4 w-4" aria-hidden="true" />
        </IconButton>
      </SheetTrigger>
      <SheetContent onClick={event => event.stopPropagation()}>
        <SheetHeader
          title="Partajează documentul"
          description={
            <span className="flex items-center gap-1.5">
              <Paperclip className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{fileName}</span>
            </span>
          }
        />
        <SheetBody className="space-y-3">
          {stage.name === 'tooLarge' ? (
            <p role="alert" className="flex gap-3 text-sm leading-6 text-ink">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--sg-warn)]" aria-hidden="true" />
              <span>Documentul are {formatFileSize(stage.size)}, peste {formatFileSize(MAX_SHARE_BYTES)}, cât se poate trimite ca atașament (și Gmail se oprește tot aici). Descarcă-l din butonul „Descarcă”.</span>
            </p>
          ) : stage.name === 'unsupported' ? (
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
              {stage.name === 'loading' && <DownloadProgress received={stage.received} total={stage.total} />}
              {stage.name === 'failed' ? (
                <p role="alert" className="text-sm leading-6 text-[var(--sg-danger)]">{stage.message}</p>
              ) : stage.name === 'loading' ? null : (
                <p className="text-sm leading-6 text-ink-soft">
                  Alegi Gmail, Outlook, WhatsApp sau altă aplicație; documentul e deja atașat.
                </p>
              )}
            </>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}

/** Bara de sub buton: procentul când știm mărimea, altfel doar cât a venit. */
function DownloadProgress({ received, total }: { received: number; total: number | null }) {
  const percent = total ? Math.min(100, Math.round((received / total) * 100)) : null
  return (
    <div className="space-y-1.5">
      <div
        role="progressbar"
        aria-label="Descărcarea documentului"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        className="h-1.5 overflow-hidden rounded-full bg-paper-sunk"
      >
        <div
          className={`h-full rounded-full bg-[var(--sg-accent)] transition-[width] duration-150 ${percent === null ? 'w-1/3 animate-pulse' : ''}`}
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>
      <p className="text-xs tabular-nums text-ink-faint">
        {total
          ? `${formatFileSize(received)} din ${formatFileSize(total)} · ${percent}%`
          : received > 0 ? `${formatFileSize(received)} descărcați` : 'Se conectează…'}
      </p>
    </div>
  )
}
