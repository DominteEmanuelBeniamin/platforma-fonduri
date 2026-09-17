'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { X, Paperclip, AlertCircle } from 'lucide-react'
import { FeedbackMessage } from '@/components/FeedbackMessage'
import { REQUIREMENT_TYPES, REQUIREMENT_LABELS, type RequirementType } from '@/lib/requirement-type'
import type { TemplateAttachment } from './types'
import { formatFileSize } from '@/lib/client-upload'

/**
 * Formularul de cerere de documente, creare și editare. A stat 163 de linii în
 * `DocumentRequests`; separat, se citește ca ce este — un formular — iar
 * componenta-mamă rămâne despre lista de cereri.
 */
export default function RequestFormDialog({
  open,
  editing,
  submitting,
  name, onNameChange,
  description, onDescriptionChange,
  category, onCategoryChange,
  deadline, onDeadlineChange,
  templateFiles, onTemplateFilesChange, onPickTemplateFiles,
  templateAttachments, onTemplateAttachmentsChange,
  templateFileError,
  onTemplateAttachmentsTouched,
  onClose,
  onSubmit,
}: {
  open: boolean
  /** Cererea în editare, sau `null` la creare. */
  editing: { attachment_missing_at?: string | null } | null
  submitting: boolean
  name: string; onNameChange: (v: string) => void
  description: string; onDescriptionChange: (v: string) => void
  category: RequirementType; onCategoryChange: (v: RequirementType) => void
  deadline: string; onDeadlineChange: (v: string) => void
  templateFiles: File[]
  onTemplateFilesChange: (updater: (current: File[]) => File[]) => void
  onPickTemplateFiles: (e: React.ChangeEvent<HTMLInputElement>) => void
  templateAttachments: TemplateAttachment[]
  onTemplateAttachmentsChange: (updater: (current: TemplateAttachment[]) => TemplateAttachment[]) => void
  templateFileError: string | null
  onTemplateAttachmentsTouched: (v: boolean) => void
  onClose: () => void
  onSubmit: (e: React.FormEvent) => void
}) {
  return (
    <Dialog.Root open={open} onOpenChange={open => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 backdrop-blur-sm z-[999999]" style={{ backgroundColor: 'rgb(22 24 28 / 0.45)' }} />
        <Dialog.Content
          onCloseAutoFocus={event => event.preventDefault()}
          className="fixed left-1/2 top-1/2 z-[999999] max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[var(--radius-plate-lg)] border border-rule bg-plate focus:outline-none"
          style={{ boxShadow: 'var(--sg-lift)' }}
        >
          <div className="p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <Dialog.Title className="text-sm font-semibold text-ink">
                  {editing ? 'Modifică cererea de document' : 'Cerere de document nouă'}
                </Dialog.Title>
                <Dialog.Description className="text-xs text-ink-soft">
                  {editing ? 'Actualizează detaliile cererii pentru client.' : 'Completează detaliile cererii pentru client.'}
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="p-2 rounded-lg text-ink-faint hover:text-ink hover:bg-paper-sunk transition-colors flex-shrink-0"
                  aria-label="Închide"
                >
                  <X className="w-4 h-4" />
                </button>
              </Dialog.Close>
            </div>
            <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-ink">Titlu document</label>
              <input
                type="text"
                value={name}
                onChange={(e) => onNameChange(e.target.value)}
                required
                className="w-full px-4 py-3 rounded-xl border border-rule text-sm focus:border-[var(--sg-accent)] focus:ring-4 focus:ring-[var(--sg-accent)] outline-none transition-all bg-white"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-ink">Termen limită</label>
              <input
                type="date"
                value={deadline}
                onChange={(e) => onDeadlineChange(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-rule text-sm focus:border-[var(--sg-accent)] focus:ring-4 focus:ring-[var(--sg-accent)] outline-none transition-all bg-white"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-semibold text-ink">Instrucțiuni</label>
            <textarea
              value={description}
              onChange={(e) => onDescriptionChange(e.target.value)}
              rows={3}
              className="w-full px-4 py-3 rounded-xl border border-rule text-sm focus:border-[var(--sg-accent)] focus:ring-4 focus:ring-[var(--sg-accent)] outline-none resize-none transition-all bg-white"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-semibold text-ink">Tip cerință</label>
            <div className="flex flex-wrap gap-4">
              {REQUIREMENT_TYPES.map((rt: RequirementType) => (
                <label key={rt} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="liveDocCategory"
                    value={rt}
                    checked={category === rt}
                    onChange={() => onCategoryChange(rt)}
                    className="w-4 h-4 border-rule-strong text-[var(--sg-accent)] focus:ring-[var(--sg-accent)]"
                  />
                  <span className="text-sm text-ink">{REQUIREMENT_LABELS[rt]}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <label className="flex-1 cursor-pointer">
              <div className={`px-4 py-3 border-2 border-dashed rounded-xl text-center transition-all ${
                templateFiles.length > 0 ? 'border-[var(--sg-accent)] bg-[var(--sg-accent-soft)]' : 'border-rule hover:border-rule-strong hover:bg-paper-sunk'
              }`}>
                <div className="flex items-center justify-center gap-2 text-sm">
                  <Paperclip className={`w-4 h-4 ${templateFiles.length > 0 ? 'text-[var(--sg-accent)]' : 'text-ink-faint'}`} />
                  <span className={templateFiles.length > 0 ? 'text-[var(--sg-accent)] font-medium' : 'text-ink-soft'}>
                    {templateFiles.length > 0
                      ? templateFiles.map(file => file.name).join(', ')
                      : editing
                      ? 'Adaugă modele (opțional)'
                      : 'Atașează modele (opțional)'}
                  </span>
                </div>
              </div>
              <input
                type="file"
                multiple
                onClick={(e) => { e.currentTarget.value = '' }}
                onChange={onPickTemplateFiles}
                className="hidden"
              />
            </label>

            <button
              type="submit"
              disabled={submitting || !name.trim()}
              className="px-6 py-3 bg-[var(--sg-accent)] text-white rounded-xl text-sm font-semibold hover:bg-[var(--sg-accent-ink)] disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
            >
              {submitting
                ? editing ? 'Se salvează...' : 'Se trimite...'
                : editing ? 'Salvează modificările' : 'Trimite cerere'}
            </button>
          </div>
          {(templateAttachments.length > 0 || templateFiles.length > 0) && (
            <div className="space-y-2 rounded-xl border border-rule bg-paper-sunk p-3">
              {templateAttachments.map(attachment => (
                <div key={attachment.id} className="flex items-center gap-2 text-xs text-ink-soft">
                  <Paperclip className="w-3.5 h-3.5 text-ink-faint flex-shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{attachment.original_name || attachment.storage_path.split('/').pop() || 'model atașat'}</span>
                  <button
                    type="button"
                    onClick={() => {
                      onTemplateAttachmentsChange(current => current.filter(item => item.id !== attachment.id))
                      onTemplateAttachmentsTouched(true)
                    }}
                    className="text-[var(--sg-danger)] hover:brightness-90"
                  >
                    Elimină
                  </button>
                </div>
              ))}
              {templateFiles.map((file, index) => (
                <div key={`${file.name}-${file.size}-${index}`} className="flex items-center gap-2 text-xs text-[var(--sg-accent)]">
                  <Paperclip className="w-3.5 h-3.5 text-[var(--sg-accent)] flex-shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{file.name}</span>
                  <span className="text-[var(--sg-accent)]">{formatFileSize(file.size)}</span>
                  <button
                    type="button"
                    onClick={() => {
                      onTemplateFilesChange(current => current.filter((_, fileIndex) => fileIndex !== index))
                      onTemplateAttachmentsTouched(true)
                    }}
                    className="text-[var(--sg-danger)] hover:brightness-90"
                  >
                    Elimină
                  </button>
                </div>
              ))}
            </div>
          )}
          {templateFileError && <FeedbackMessage variant="error" className="text-xs"><span className="whitespace-pre-line">{templateFileError}</span></FeedbackMessage>}
          {editing?.attachment_missing_at && (
            <div className="flex items-center gap-2 text-xs text-[var(--sg-warn)]">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>Modelul existent este indisponibil. Alege un fișier nou pentru înlocuire.</span>
            </div>
          )}
            </form>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
