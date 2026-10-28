'use client'

import { useEffect, useRef, useState, type DragEvent, type JSX } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AlertCircle, CheckCircle2, FolderUp, Loader2, MessageSquare, Plus, Upload, X } from 'lucide-react'
import { useToast } from '@/app/providers/ToastProvider'
import { FeedbackMessage } from '@/components/FeedbackMessage'
import { Button } from '@/components/ui/Button'
import { runClientUpload, validateUploadFile, type ClientUploadFileState, type PendingClientUploadCompletion } from '@/lib/client-upload'
import { discardSelectionText, formatFileSize, selectionStats, selectionSummary } from '@/lib/upload-selection'
import type { PickedFile } from './types'

type ApiFetch = (input: RequestInfo, init?: RequestInit) => Promise<Response>

export type ClientUploadTarget = {
  id: string
  name: string
  rejected: boolean
  /** Motivul respingerii: cine reîncarcă trebuie să-l aibă sub ochi. */
  rejectionReason?: string | null
}

const WAIT_FOR_UPLOAD = 'Așteaptă să se termine încărcarea'

/**
 * Încărcarea clientului, câte un dialog pe cerere (feedback-ul lui Sandu, 21
 * octombrie 2026). Lista de fișiere stă în dialog, nu în tabel: cât timp era o
 * singură listă pe activitate, fișierele alese la o cerere plecau la cererea
 * aleasă după ea. Acum fiecare dialog își ține fișierele și le trimite doar la
 * cererea lui.
 *
 * Se montează doar cât e deschis, deci o redeschidere pornește de la zero.
 * Închiderea cu fișiere neîncărcate cere confirmare; în timpul încărcării nu
 * se poate închide deloc.
 */
export default function ClientUploadDialog({
  request,
  startWith,
  returnFocusTo,
  canUploadFolder,
  apiFetch,
  onUploaded,
  onClose,
  getFileIcon,
}: {
  request: ClientUploadTarget
  /** „Încarcă folder” deschide dialogul cu alegerea folderului pornită. */
  startWith: 'files' | 'folder'
  /**
   * Unde se întoarce focusul la închidere: butonul de sub rând. Radix îl duce
   * doar pe un `Dialog.Trigger`, iar aici dialogul se deschide din alt loc.
   */
  returnFocusTo?: HTMLElement | null
  canUploadFolder: boolean
  apiFetch: ApiFetch
  onUploaded: () => Promise<void> | void
  onClose: () => void
  getFileIcon: (file: PickedFile) => JSX.Element
}) {
  const { showToast, confirm } = useToast()
  const [files, setFiles] = useState<PickedFile[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [dragging, setDragging] = useState(false)
  const pendingRef = useRef<PendingClientUploadCompletion | null>(null)
  const askingRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stats = selectionStats(files)

  // Alegerea folderului pornește din clicul care a deschis dialogul: activarea
  // dată de clic ține câteva secunde, deci browserul acceptă `click()`-ul.
  useEffect(() => {
    if (startWith === 'folder' && canUploadFolder) folderInputRef.current?.click()
  }, [startWith, canUploadFolder])

  const addFiles = (list: FileList | null) => {
    const picked = Array.from(list ?? [])
    if (picked.length === 0) return
    setFiles(prev => {
      const next: PickedFile[] = []
      for (const file of picked) {
        const candidate: PickedFile = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
          file,
          name: file.name,
          size: file.size,
          type: file.type || 'application/octet-stream',
          relativePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || null,
          uploadStatus: 'pending',
        }
        // Duplicatele se caută doar printre fișierele acestei cereri.
        const error = validateUploadFile(file, [...prev, ...next])
        if (error) candidate.validationError = error
        next.push(candidate)
      }
      return [...prev, ...next]
    })
  }

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(file => file.id !== id))
  }

  const requestClose = async () => {
    if (submitting || askingRef.current) return
    const notUploaded = stats.notUploaded + (pendingRef.current?.fileIds.length ?? 0)
    if (notUploaded === 0) { onClose(); return }
    askingRef.current = true
    try {
      const discard = await confirm({
        title: 'Renunți la fișierele alese?',
        description: discardSelectionText(notUploaded),
        confirmText: 'Renunță la ele',
      })
      if (discard) {
        pendingRef.current = null
        setFiles([])
        onClose()
      }
    } finally {
      askingRef.current = false
    }
  }

  const upload = async () => {
    if (submitting) return
    const toSend = files.filter(file => !file.validationError && file.uploadStatus !== 'success')
    const pending = pendingRef.current
    if (!pending && toSend.length === 0) {
      showToast('Nu există fișiere valide. Verifică erorile de validare.', 'warning')
      return
    }

    setSubmitting(true)
    try {
      const options = {
        apiFetch,
        requestId: request.id,
        onPending: (next: PendingClientUploadCompletion | null) => { pendingRef.current = next },
        onFileState: (id: string, state: ClientUploadFileState) => setFiles(prev => prev.map(file => file.id !== id ? file : (
          state.status === 'uploading' ? { ...file, uploadStatus: 'uploading' as const, uploadError: undefined }
            : state.status === 'success' ? { ...file, uploadStatus: 'success' as const }
            : { ...file, uploadStatus: 'error' as const, uploadError: state.message }
        ))),
      }
      const completed = pending ? await runClientUpload({ ...options, files: [], pending }) : null
      const result = toSend.length > 0
        ? await runClientUpload({ ...options, files: toSend, pending: null })
        : { successful: 0, failed: 0 }
      const successful = (completed?.successful ?? 0) + result.successful

      showToast(
        result.failed === 0
          ? `Au fost încărcate ${successful} fișiere.`
          : `${successful} fișiere au fost încărcate, iar ${result.failed} au eșuat. Verifică lista fișierelor.`,
        result.failed === 0 ? 'success' : 'warning',
      )
      await onUploaded()
      // Cu eșecuri, dialogul rămâne deschis: fișierele căzute se reîncearcă.
      if (result.failed === 0) onClose()
    } catch (error) {
      showToast(
        error instanceof Error && error.message ? error.message : 'Nu am putut încărca fișierele. Reîncearcă.',
        'error',
      )
    } finally {
      setSubmitting(false)
    }
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    if (!submitting) addFiles(event.dataTransfer.files)
  }

  const pickButtons = (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={submitting}
        onClick={() => fileInputRef.current?.click()}
        data-autofocus
        data-tooltip={files.length > 0 ? 'Alege și alte fișiere pentru aceeași cerere' : 'Alege fișierele de pe dispozitiv'}
      >
        {files.length > 0 ? <Plus className="h-4 w-4" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
        {files.length > 0 ? 'Adaugă mai multe' : 'Alege fișiere'}
      </Button>
      {canUploadFolder ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={submitting}
          onClick={() => folderInputRef.current?.click()}
          data-tooltip="Alege un folder întreg: se încarcă toate fișierele din el"
        >
          <FolderUp className="h-4 w-4" aria-hidden="true" />
          Alege folder
        </Button>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-xs text-ink-faint">
          <FolderUp className="h-4 w-4" aria-hidden="true" />
          Folder indisponibil pe mobil
        </span>
      )}
    </div>
  )

  return (
    <Dialog.Root open onOpenChange={open => { if (!open) void requestClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[999999]" style={{ backgroundColor: 'rgb(22 24 28 / 0.45)' }} />
        <Dialog.Content
          ref={contentRef}
          // Escape și clicul pe fundal trec prin aceeași întrebare ca X-ul.
          // Clicurile din confirmarea de deasupra nu ajung aici: Radix le dă
          // doar stratului de sus.
          onEscapeKeyDown={event => { event.preventDefault(); void requestClose() }}
          onPointerDownOutside={event => { event.preventDefault(); void requestClose() }}
          // Focusul intră pe „Alege fișiere”, primul pas, nu pe X-ul din colț,
          // și se întoarce pe butonul care a deschis dialogul.
          onOpenAutoFocus={event => {
            event.preventDefault()
            contentRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus()
          }}
          onCloseAutoFocus={event => {
            event.preventDefault()
            if (returnFocusTo?.isConnected) returnFocusTo.focus()
          }}
          className="fixed left-1/2 top-1/2 z-[999999] flex max-h-[90vh] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-[var(--radius-plate-lg)] border border-rule bg-plate focus:outline-none"
          style={{ boxShadow: 'var(--sg-lift)' }}
        >
          <div className="flex items-start justify-between gap-3 border-b border-rule px-5 py-4">
            <div className="min-w-0">
              <p className="text-xs font-medium text-ink-faint">{request.rejected ? 'Reîncarcă fișierele pentru' : 'Încarcă fișierele pentru'}</p>
              <Dialog.Title className="break-words text-base font-semibold leading-snug text-ink">{request.name}</Dialog.Title>
              <Dialog.Description className="sr-only">
                Alege fișierele, verifică lista, apoi apasă „Încarcă”.
              </Dialog.Description>
            </div>
            <button
              type="button"
              aria-label="Închide"
              aria-disabled={submitting || undefined}
              data-tooltip={submitting ? WAIT_FOR_UPLOAD : 'Închide fereastra de încărcare'}
              onClick={() => { void requestClose() }}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-plate)] text-ink-faint transition-colors duration-[120ms] hover:bg-paper-sunk hover:text-ink aria-disabled:cursor-not-allowed aria-disabled:opacity-55 pointer-fine:h-9 pointer-fine:w-9"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
            {request.rejected && (
              <div className="flex items-start gap-2 rounded-[var(--radius-plate)] border border-[var(--sg-danger)] bg-[var(--sg-danger-soft)] p-3">
                <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-[var(--sg-danger)]" aria-hidden="true" />
                <div>
                  <p className="text-xs font-semibold text-[var(--sg-danger)]">Motivul respingerii</p>
                  <p className="text-sm text-[var(--sg-danger)]">{request.rejectionReason || 'Motivul respingerii nu este disponibil pentru acest istoric.'}</p>
                </div>
              </div>
            )}

            {/* Zona de tras fișiere; butoanele din ea sunt drumul de la tastatură. */}
            <div
              onDragOver={event => { event.preventDefault(); if (!submitting) setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={`rounded-[var(--radius-plate)] border border-dashed px-4 text-center transition-colors duration-[120ms] ${
                files.length > 0 ? 'py-3' : 'py-7'
              } ${dragging ? 'border-[var(--sg-accent)] bg-[var(--sg-accent-soft)]' : 'border-rule-strong bg-paper'}`}
            >
              {files.length === 0 && (
                <>
                  <Upload className="mx-auto mb-2 h-6 w-6 text-ink-faint" aria-hidden="true" />
                  <p className="mb-3 text-sm text-ink-soft">Trage fișierele aici sau alege-le de pe dispozitiv.</p>
                </>
              )}
              {pickButtons}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              tabIndex={-1}
              aria-hidden="true"
              onClick={event => { event.currentTarget.value = '' }}
              onChange={event => { addFiles(event.currentTarget.files); event.currentTarget.value = '' }}
              className="sr-only"
            />
            {canUploadFolder && (
              <input
                ref={element => {
                  folderInputRef.current = element
                  element?.setAttribute('webkitdirectory', '')
                  element?.setAttribute('directory', '')
                }}
                type="file"
                multiple
                tabIndex={-1}
                aria-hidden="true"
                onClick={event => { event.currentTarget.value = '' }}
                onChange={event => { addFiles(event.currentTarget.files); event.currentTarget.value = '' }}
                className="sr-only"
              />
            )}

            {files.length > 0 && (
              <>
                <p className="text-xs font-medium text-ink-soft tabular-nums">{selectionSummary(stats)}</p>
                <ul aria-live="polite" aria-label="Fișierele alese" className="divide-y divide-rule rounded-[var(--radius-plate)] border border-rule">
                  {files.map(file => {
                    const invalid = !!file.validationError
                    const failed = file.uploadStatus === 'error'
                    const uploading = file.uploadStatus === 'uploading'
                    const done = file.uploadStatus === 'success'
                    return (
                      <li
                        key={file.id}
                        className={`flex items-start gap-3 px-3 py-2.5 ${invalid || failed ? 'bg-[var(--sg-danger-soft)]' : done ? 'bg-[var(--sg-ok-soft)]' : ''}`}
                      >
                        <span className={`mt-0.5 shrink-0 ${invalid || failed ? 'text-[var(--sg-danger)]' : done ? 'text-[var(--sg-ok)]' : 'text-ink-soft'}`}>
                          {uploading ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                            : done ? <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
                            : invalid || failed ? <AlertCircle className="h-5 w-5" aria-hidden="true" />
                            : getFileIcon(file)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className={`truncate text-sm font-medium ${invalid || failed ? 'text-[var(--sg-danger)]' : 'text-ink'}`}>{file.name}</p>
                          <p className="text-xs text-ink-soft">
                            {formatFileSize(file.size)}
                            {file.relativePath && ` · ${file.relativePath}`}
                            {uploading && ' · Se încarcă…'}
                            {done && ' · Încărcat'}
                          </p>
                          {invalid && <FeedbackMessage variant="error" className="mt-1 text-xs">{file.validationError?.message}</FeedbackMessage>}
                          {failed && file.uploadError && <FeedbackMessage variant="error" className="mt-1 text-xs">{file.uploadError}</FeedbackMessage>}
                        </div>
                        {!submitting && !done && (
                          <button
                            type="button"
                            onClick={() => removeFile(file.id)}
                            aria-label={`Scoate ${file.name} din listă`}
                            data-tooltip="Scoate fișierul din listă"
                            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-plate)] text-ink-faint transition-colors duration-[120ms] hover:bg-paper-sunk hover:text-[var(--sg-danger)] pointer-fine:h-8 pointer-fine:w-8"
                          >
                            <X className="h-4 w-4" aria-hidden="true" />
                          </button>
                        )}
                      </li>
                    )
                  })}
                </ul>
                {stats.invalid > 0 && (
                  <p className="text-xs text-ink-soft">
                    Doar fișierele valide se încarcă. Scoate-le pe cele cu erori sau alege altele în locul lor.
                  </p>
                )}
              </>
            )}
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-rule px-5 py-3 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="quiet"
              aria-disabled={submitting || undefined}
              data-tooltip={submitting ? WAIT_FOR_UPLOAD : 'Închide fără să încarci'}
              onClick={() => { void requestClose() }}
              className="aria-disabled:cursor-not-allowed aria-disabled:opacity-55"
            >
              Anulează
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => { void upload() }}
              disabled={submitting || (stats.toUpload === 0 && !pendingRef.current)}
              aria-busy={submitting || undefined}
              data-tooltip="Trimite consultantului fișierele alese"
              className="min-w-[9.5rem]"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
              {`Încarcă${stats.toUpload > 0 ? ` (${stats.toUpload})` : ''}`}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
