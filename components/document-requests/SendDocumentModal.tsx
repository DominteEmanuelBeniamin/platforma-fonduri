'use client'

import type { JSX } from 'react'
import { X, Files, Upload, Loader2, Plus, AlertCircle, CheckCircle2 } from 'lucide-react'
import { formatFileSize } from '@/lib/client-upload'
import { normalizeFileName } from './utils'
import type { PickedFile } from './types'
import { FeedbackMessage } from '@/components/FeedbackMessage'

/**
 * Trimiterea de documente către client. A stat 188 de linii în burta lui
 * `DocumentRequests`, care ajunsese la 2.092; aici e o suprafață de sine
 * stătătoare, cu ce-i trebuie primit prin proprietăți.
 */
export default function SendDocumentModal({
  open,
  files,
  fileStats,
  submitting,
  onClose,
  onSubmit,
  onPickFiles,
  onRemoveFile,
  onClearFiles,
  outgoingDocs,
  getFileIcon,
}: {
  open: boolean
  files: PickedFile[]
  fileStats: { total: number; valid: number; invalid: number; uploading: number; totalSize: number }
  submitting: boolean
  onClose: () => void
  onSubmit: (e: React.FormEvent) => void
  onPickFiles: (list: FileList | null) => void
  onRemoveFile: (id: string) => void
  onClearFiles: () => void
  /** Documentele deja trimise, ca să putem avertiza la nume identice. */
  outgoingDocs: { attachment_original_name?: string | null; name?: string | null }[]
  getFileIcon: (file: PickedFile) => JSX.Element
}) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="px-6 py-4 border-b border-rule flex items-center justify-between">
          <h3 className="font-semibold text-ink">Trimite documente către client</h3>
          <button type="button" onClick={onClose} className="p-1 text-ink-faint hover:text-ink-soft" disabled={submitting}>
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={onSubmit}>
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-2">Documente *</label>
              {files.length === 0 ? (
                <label className="flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed border-rule rounded-xl cursor-pointer hover:border-[var(--sg-ok)] hover:bg-[var(--sg-ok-soft)] transition-colors">
                  <Upload className="w-8 h-8 text-ink-faint" />
                  <span className="text-sm text-ink-soft font-medium">Click pentru a încărca documente</span>
                  <span className="text-xs text-ink-faint">PDF, DOC, DOCX, XLS, XLSX, CSV, imagini</span>
                  <input
                    type="file"
                    multiple
                    onClick={(e) => { e.currentTarget.value = '' }}
                    onChange={(e) => {
                      onPickFiles(e.currentTarget.files)
                      e.currentTarget.value = ''
                    }}
                    className="hidden"
                  />
                </label>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-[var(--sg-ok-soft)] border border-[var(--sg-ok)] rounded-xl">
                    <div className="flex items-center gap-3">
                      <Files className="w-5 h-5 text-[var(--sg-ok)]" />
                      <div>
                        <p className="text-sm font-bold text-[var(--sg-ok)]">
                          {fileStats.total} {fileStats.total === 1 ? 'document selectat' : 'documente selectate'}
                        </p>
                        <p className="text-xs text-[var(--sg-ok)]">
                          {fileStats.valid} {fileStats.valid === 1 ? 'document valid' : 'documente valide'} • {formatFileSize(fileStats.totalSize)}
                          {fileStats.invalid > 0 && ` • ${fileStats.invalid} erori`}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={onClearFiles}
                      disabled={submitting}
                      className="p-2 text-ink-faint hover:text-ink-soft rounded-lg hover:bg-white transition-all disabled:opacity-50"
                      title="Anulează tot"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                    {files.map((pickedFile) => {
                      const hasError = !!pickedFile.validationError
                      const isUploading = pickedFile.uploadStatus === 'uploading'
                      const isSuccess = pickedFile.uploadStatus === 'success'
                      const isError = pickedFile.uploadStatus === 'error'
                      const normalizedName = normalizeFileName(pickedFile.name)
                      const hasSameNameInSelection = normalizedName !== '' && files.some(file => file.id !== pickedFile.id && normalizeFileName(file.name) === normalizedName)
                      const hasSameNameInOutgoing = normalizedName !== '' && outgoingDocs.some((doc) => normalizeFileName(doc.attachment_original_name || doc.name) === normalizedName)
                      const nameWarning = !hasError && !isError && !isSuccess
                        ? hasSameNameInOutgoing
                          ? 'Există deja un document trimis cu acest nume'
                          : hasSameNameInSelection
                          ? 'Ai selectat deja un document cu acest nume'
                          : ''
                        : ''

                      return (
                        <div
                          key={pickedFile.id}
                          className={`p-3 rounded-xl border transition-all ${
                            hasError || isError
                              ? 'bg-[var(--sg-danger-soft)] border-[var(--sg-danger)]'
                              : isSuccess
                              ? 'bg-[var(--sg-ok-soft)] border-[var(--sg-ok)]'
                              : isUploading
                              ? 'bg-[var(--sg-accent-soft)] border-[var(--sg-accent)]'
                              : nameWarning
                              ? 'bg-[var(--sg-warn-soft)] border-[var(--sg-warn)]'
                              : 'bg-white border-rule'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                              hasError || isError
                                ? 'bg-[var(--sg-danger-soft)] text-[var(--sg-danger)]'
                                : isSuccess
                                ? 'bg-[var(--sg-ok-soft)] text-[var(--sg-ok)]'
                                : isUploading
                                ? 'bg-[var(--sg-accent-soft)] text-[var(--sg-accent)]'
                                : nameWarning
                                ? 'bg-[var(--sg-warn-soft)] text-[var(--sg-warn)]'
                                : 'bg-paper-sunk text-ink-soft'
                            }`}>
                              {isUploading ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                              ) : isSuccess ? (
                                <CheckCircle2 className="w-5 h-5" />
                              ) : (isError || hasError) ? (
                                <AlertCircle className="w-5 h-5" />
                              ) : nameWarning ? (
                                <AlertCircle className="w-5 h-5" />
                              ) : (
                                getFileIcon(pickedFile)
                              )}
                            </div>

                            <div className="flex-1 min-w-0">
                              <p className={`text-sm font-medium truncate ${
                                hasError || isError ? 'text-[var(--sg-danger)]' : isSuccess ? 'text-[var(--sg-ok)]' : nameWarning ? 'text-[var(--sg-warn)]' : 'text-ink'
                              }`}>
                                {pickedFile.name}
                              </p>
                              <p className="text-xs text-ink-soft mt-0.5">{formatFileSize(pickedFile.size)}</p>
                              {hasError && <FeedbackMessage variant="error" className="mt-1 text-xs">{pickedFile.validationError?.message}</FeedbackMessage>}
                              {isError && pickedFile.uploadError && <FeedbackMessage variant="error" className="mt-1 text-xs">{pickedFile.uploadError}</FeedbackMessage>}
                              {nameWarning && (
                                <p className="text-xs text-[var(--sg-warn)] font-medium mt-1 flex items-center gap-1">
                                  <AlertCircle className="w-3 h-3" />
                                  {nameWarning}
                                </p>
                              )}
                              {isSuccess && (
                                <p className="text-xs text-[var(--sg-ok)] font-medium mt-1 flex items-center gap-1">
                                  <CheckCircle2 className="w-3 h-3" />
                                  Trimis
                                </p>
                              )}
                            </div>

                            {!submitting && !isUploading && !isSuccess && (
                              <button
                                type="button"
                                onClick={() => onRemoveFile(pickedFile.id)}
                                className="p-1.5 text-ink-faint hover:text-[var(--sg-danger)] rounded-lg hover:bg-white transition-all flex-shrink-0"
                                title="Elimină"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  <label className="cursor-pointer block">
                    <div className="flex items-center justify-center gap-2 px-4 py-2.5 border-2 border-dashed border-rule rounded-xl text-ink-soft hover:border-[var(--sg-ok)] hover:bg-[var(--sg-ok-soft)] hover:text-[var(--sg-ok)] transition-all">
                      <Plus className="w-4 h-4" />
                      <span className="text-sm font-medium">Adaugă mai multe</span>
                    </div>
                    <input
                      type="file"
                      multiple
                      onClick={(e) => { e.currentTarget.value = '' }}
                      onChange={(e) => {
                        onPickFiles(e.currentTarget.files)
                        e.currentTarget.value = ''
                      }}
                      disabled={submitting}
                      className="hidden"
                    />
                  </label>
                </div>
              )}
            </div>
            <p className="text-xs text-ink-soft">Clientul va putea descărca aceste documente. Nu i se va cere să încarce nimic înapoi.</p>
          </div>
          <div className="px-6 py-4 bg-paper-sunk border-t border-rule flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 border border-rule rounded-lg text-sm font-medium text-ink hover:bg-white" disabled={submitting}>
              Anulează
            </button>
            <button type="submit" disabled={submitting || fileStats.valid === 0 || fileStats.uploading > 0} className="flex-1 px-4 py-2.5 bg-[var(--sg-ok)] text-white rounded-lg text-sm font-medium hover:brightness-90 disabled:opacity-50 flex items-center justify-center gap-2">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {submitting
                ? fileStats.valid === 1 ? 'Se trimite...' : 'Se trimit...'
                : fileStats.valid === 1 ? 'Trimite document (1)' : `Trimite documente${fileStats.valid > 0 ? ` (${fileStats.valid})` : ''}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
