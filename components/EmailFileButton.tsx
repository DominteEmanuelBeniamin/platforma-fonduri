'use client'

import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { CheckCircle2, Mail, Paperclip, Share2, X } from 'lucide-react'
import { useToast } from '@/app/providers/ToastProvider'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { serverMessage } from '@/lib/api-error'
import { MAX_EMAIL_ATTACHMENT_BYTES, parseEmailRecipients } from '@/lib/email-recipients'

type ApiFetch = (url: string, init?: RequestInit) => Promise<Response>

const field =
  'w-full rounded-[var(--radius-plate)] border border-rule bg-plate px-3 text-sm text-ink placeholder:text-ink-faint ' +
  'transition-colors duration-[120ms] focus:border-[var(--sg-accent)] aria-[invalid=true]:border-[var(--sg-danger)]'

function formatSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** Telefonul sau browserul poate deschide meniul „Partajează” cu un fișier atașat (Gmail, Outlook, Mail). */
function canShareFile(fileName: string, mimeType: string | null | undefined) {
  if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function') return false
  try {
    return navigator.canShare({ files: [new File([''], fileName, { type: mimeType || 'application/octet-stream' })] })
  } catch {
    return false
  }
}

/**
 * „Trimite pe email” pentru un fișier încărcat. Două căi, în aceeași fereastră:
 * - din Bonie: atașament, Reply-To la cel care trimite, copie la el;
 * - din aplicația de email a omului (Gmail, Outlook, Mail), unde browserul
 *   permite partajarea unui fișier: telefoane, Safari, Chrome/Edge pe Windows.
 *   Un site nu poate deschide Gmail cu un fișier atașat altfel; `mailto:` nu
 *   acceptă atașamente.
 */
export function EmailFileButton({
  fileId,
  fileName,
  mimeType,
  fileSize,
  documentName,
  apiFetch,
  className = '',
}: {
  fileId: string
  fileName: string
  mimeType?: string | null
  fileSize?: number | null
  documentName?: string | null
  apiFetch: ApiFetch
  className?: string
}) {
  const { showToast } = useToast()
  const ids = useId()
  const [open, setOpen] = useState(false)
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [copyToMe, setCopyToMe] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<{ field: 'to' | 'subject' | null; message: string } | null>(null)
  const [sentTo, setSentTo] = useState<string[] | null>(null)
  const [shareable, setShareable] = useState(false)
  const [shareFile, setShareFile] = useState<File | null>(null)
  const [shareState, setShareState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle')
  const toRef = useRef<HTMLTextAreaElement>(null)
  const tooLarge = typeof fileSize === 'number' && fileSize > MAX_EMAIL_ATTACHMENT_BYTES

  const reset = () => {
    setTo('')
    setSubject(documentName?.trim() || fileName)
    setMessage('')
    setCopyToMe(true)
    setError(null)
    setSentTo(null)
  }

  // Partajarea cere fișierul gata în memorie în momentul clicului (Safari
  // anulează gestul dacă așteptăm descărcarea după el), deci îl aducem la deschidere.
  useEffect(() => {
    if (!open || tooLarge || !canShareFile(fileName, mimeType)) return
    setShareable(true)
    if (shareFile) return
    let cancelled = false
    setShareState('loading')
    void (async () => {
      try {
        const res = await apiFetch(`/api/files/${fileId}/signed-download`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expiresIn: 120 }),
        })
        const { url } = res.ok ? await res.json() as { url?: string } : {}
        if (!url) throw new Error('no url')
        const blob = await (await fetch(url)).blob()
        if (cancelled) return
        setShareFile(new File([blob], fileName, { type: mimeType || blob.type || 'application/octet-stream' }))
        setShareState('ready')
      } catch {
        if (!cancelled) setShareState('failed')
      }
    })()
    return () => { cancelled = true }
  }, [open, tooLarge, fileName, mimeType, fileId, apiFetch, shareFile])

  const shareInMailApp = async () => {
    if (!shareFile) return
    try {
      await navigator.share({ files: [shareFile], title: subject.trim() || fileName, ...(message.trim() ? { text: message.trim() } : {}) })
      setOpen(false)
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === 'AbortError') return
      showToast('Aplicația de email nu s-a deschis. Trimite din Bonie, cu butonul „Trimite”.', 'warning')
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (sending) return
    const recipients = parseEmailRecipients(to)
    if (!recipients.ok) {
      setError({ field: 'to', message: recipients.message })
      toRef.current?.focus()
      return
    }
    if (!subject.trim()) {
      setError({ field: 'subject', message: 'Scrie un subiect.' })
      return
    }
    setSending(true)
    setError(null)
    try {
      const res = await apiFetch(`/api/files/${fileId}/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, subject: subject.trim(), message, copyToMe }),
      })
      if (!res.ok) {
        const body: unknown = await res.clone().json().catch(() => null)
        const code = (body as { code?: unknown } | null)?.code
        setError({
          field: code === 'invalid_recipients' ? 'to' : code === 'invalid_subject' ? 'subject' : null,
          message: await serverMessage(res, 'Nu am putut trimite emailul. Încearcă din nou.'),
        })
        return
      }
      setSentTo(recipients.emails)
      showToast(`Documentul a plecat către ${recipients.emails.join(', ')}.`, 'success')
    } catch {
      setError({ field: null, message: 'Nu am putut trimite emailul. Verifică legătura la internet și încearcă din nou.' })
    } finally {
      setSending(false)
    }
  }

  const errorId = `${ids}-eroare`

  return (
    <Dialog.Root open={open} onOpenChange={next => { if (!sending) setOpen(next) }}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          onClick={event => { event.stopPropagation(); reset() }}
          title="Trimite pe email"
          aria-label={`Trimite pe email ${fileName}`}
          data-tooltip="Trimite documentul ca atașament, oricui: ANAF, contabil, bancă"
          className={className || 'p-2 rounded-lg text-ink-faint hover:text-[var(--sg-accent)] hover:bg-paper-sunk transition-colors'}
        >
          <Mail className="h-4 w-4" aria-hidden="true" />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[1000001]" style={{ backgroundColor: 'rgb(22 24 28 / 0.45)' }} />
        <Dialog.Content
          onClick={event => event.stopPropagation()}
          onOpenAutoFocus={event => { event.preventDefault(); toRef.current?.focus() }}
          className="fixed left-1/2 top-1/2 z-[1000001] max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[var(--radius-plate-lg)] border border-rule bg-plate focus:outline-none"
          style={{ boxShadow: 'var(--sg-lift)' }}
        >
          <div className="flex items-start justify-between gap-3 border-b border-rule px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="text-lg font-bold text-ink">Trimite pe email</Dialog.Title>
              <Dialog.Description className="mt-1 flex items-center gap-1.5 text-sm text-ink-soft">
                <Paperclip className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{fileName}</span>
                {typeof fileSize === 'number' && <span className="shrink-0 tabular-nums">· {formatSize(fileSize)}</span>}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <IconButton label="Închide" disabled={sending}><X className="h-4 w-4" aria-hidden="true" /></IconButton>
            </Dialog.Close>
          </div>

          {tooLarge ? (
            <p role="alert" className="px-5 py-5 text-sm text-ink">
              Fișierul are peste 25 MB și nu încape într-un email. Descarcă-l și trimite-l printr-un serviciu de transfer (de exemplu WeTransfer).
            </p>
          ) : sentTo ? (
            <div className="space-y-4 px-5 py-5" role="status" aria-live="polite">
              <div className="flex gap-3 rounded-[var(--radius-plate)] border border-[var(--sg-ok)] bg-[var(--sg-ok-soft)] p-4">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[var(--sg-ok)]" aria-hidden="true" />
                <p className="text-sm leading-6 text-ink">
                  Emailul a plecat către <strong>{sentTo.join(', ')}</strong>, cu documentul atașat.
                  {copyToMe ? ' Ai primit și tu o copie.' : ''} Răspunsurile vin direct pe adresa ta.
                </p>
              </div>
              <div className="flex justify-end gap-3">
                <Button variant="secondary" onClick={reset}>Trimite și altcuiva</Button>
                <Dialog.Close asChild><Button variant="primary">Gata</Button></Dialog.Close>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} noValidate aria-busy={sending} className="space-y-4 px-5 py-5">
              <div>
                <label htmlFor={`${ids}-catre`} className="mb-1.5 block text-sm font-semibold text-ink">Către</label>
                <textarea
                  id={`${ids}-catre`}
                  ref={toRef}
                  rows={1}
                  value={to}
                  onChange={event => { setTo(event.target.value); if (error?.field === 'to') setError(null) }}
                  placeholder="registratura@anaf.ro, contabil@firma.ro"
                  autoComplete="email"
                  spellCheck={false}
                  disabled={sending}
                  aria-invalid={error?.field === 'to' || undefined}
                  aria-describedby={`${ids}-catre-indiciu${error?.field === 'to' ? ` ${errorId}` : ''}`}
                  className={`${field} min-h-11 resize-y py-2.5`}
                />
                <p id={`${ids}-catre-indiciu`} className="mt-1 text-xs text-ink-soft">Orice adresă, și fără cont în Bonie. Mai multe, despărțite prin virgulă (cel mult 5).</p>
              </div>
              <div>
                <label htmlFor={`${ids}-subiect`} className="mb-1.5 block text-sm font-semibold text-ink">Subiect</label>
                <input
                  id={`${ids}-subiect`}
                  value={subject}
                  maxLength={200}
                  onChange={event => { setSubject(event.target.value); if (error?.field === 'subject') setError(null) }}
                  disabled={sending}
                  aria-invalid={error?.field === 'subject' || undefined}
                  aria-describedby={error?.field === 'subject' ? errorId : undefined}
                  className={`${field} h-11`}
                />
              </div>
              <div>
                <label htmlFor={`${ids}-mesaj`} className="mb-1.5 block text-sm font-semibold text-ink">Mesaj <span className="font-normal text-ink-soft">(opțional)</span></label>
                <textarea
                  id={`${ids}-mesaj`}
                  rows={4}
                  maxLength={5000}
                  value={message}
                  onChange={event => setMessage(event.target.value)}
                  placeholder="Bună ziua, vă transmit atașat documentul solicitat."
                  disabled={sending}
                  className={`${field} resize-y py-2.5 leading-6`}
                />
              </div>
              <label className="flex min-h-11 items-center gap-3 text-sm text-ink">
                <input type="checkbox" checked={copyToMe} onChange={event => setCopyToMe(event.target.checked)} disabled={sending} className="h-4 w-4 accent-[var(--sg-accent)]" />
                Trimite-mi și mie o copie
              </label>

              {error && <p id={errorId} role="alert" className="text-sm text-[var(--sg-danger)]">{error.message}</p>}

              <div className="flex flex-col-reverse gap-3 border-t border-rule pt-4 sm:flex-row sm:items-center sm:justify-between">
                {shareable ? (
                  <Button
                    type="button"
                    variant="quiet"
                    onClick={() => void shareInMailApp()}
                    disabled={sending || shareState !== 'ready'}
                    data-tooltip="Deschide Gmail, Outlook sau Mail cu documentul atașat; trimiți de pe adresa ta"
                  >
                    <Share2 className="h-4 w-4" aria-hidden="true" />
                    {shareState === 'loading' ? 'Se pregătește…' : shareState === 'failed' ? 'Aplicația de email nu e disponibilă' : 'Deschide în aplicația de email'}
                  </Button>
                ) : <span className="hidden sm:block" />}
                <Button type="submit" variant="primary" disabled={sending} data-tooltip="Trimite emailul din Bonie, cu documentul atașat">
                  <Mail className="h-4 w-4" aria-hidden="true" />
                  {sending ? 'Se trimite…' : 'Trimite'}
                </Button>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
