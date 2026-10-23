'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { X, Paperclip, AlertCircle } from 'lucide-react'
import { FeedbackMessage } from '@/components/FeedbackMessage'
import { REQUIREMENT_TYPES, REQUIREMENT_LABELS, type RequirementType } from '@/lib/requirement-type'
import type { SensitiveKind } from '@/lib/sensitive-documents'
import { SensitiveKindField } from '@/components/SensitiveKindField'
import type { TemplateAttachment } from './types'
import { formatFileSize } from '@/lib/client-upload'
import { DateField } from '@/components/ui/DatePicker'
import { useState } from 'react'
import { AutoGrowTextarea } from '@/components/template-editor/AutoGrowTextarea'

/**
 * Formularul de cerere de documente, creare și editare. A stat 163 de linii în
 * `DocumentRequests`; separat, se citește ca ce este — un formular — iar
 * componenta-mamă rămâne despre lista de cereri.
 */
export default function RequestFormDialog({
  open,
  editing,
  submitting,
  name,
  description,
  category, onCategoryChange,
  sensitiveKind, onSensitiveKindChange,
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
  /** Valorile de pornire; textul scris rămâne în dialog până la trimitere. */
  name: string
  description: string
  category: RequirementType; onCategoryChange: (v: RequirementType) => void
  sensitiveKind: SensitiveKind | null; onSensitiveKindChange: (v: SensitiveKind | null) => void
  deadline: string; onDeadlineChange: (v: string) => void
  templateFiles: File[]
  onTemplateFilesChange: (updater: (current: File[]) => File[]) => void
  onPickTemplateFiles: (e: React.ChangeEvent<HTMLInputElement>) => void
  templateAttachments: TemplateAttachment[]
  onTemplateAttachmentsChange: (updater: (current: TemplateAttachment[]) => TemplateAttachment[]) => void
  templateFileError: string | null
  onTemplateAttachmentsTouched: (v: boolean) => void
  onClose: () => void
  /** Numele și descrierea vin aici, la trimitere: în timpul scrisului stau în dialog. */
  onSubmit: (e: React.FormEvent, text: { name: string; description: string }) => void
}) {
  // Textul se ține în dialog, nu în lista de cereri: fiecare literă re-randa
  // toate cererile activității (S-26). Pornește de la valorile primite la
  // fiecare deschidere.
  const [draftName, setDraftName] = useState(name)
  const [draftDescription, setDraftDescription] = useState(description)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) { setDraftName(name); setDraftDescription(description) }
  }
  return (
    <Dialog.Root open={open} onOpenChange={open => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[999999]" style={{ backgroundColor: 'rgb(22 24 28 / 0.45)' }} />
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
            <form onSubmit={e => onSubmit(e, { name: draftName, description: draftDescription })} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-ink">Titlu document</label>
              <input
                type="text"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                required
                className="w-full px-4 py-3 rounded-xl border border-rule text-sm focus:border-[var(--sg-accent)] focus:ring-4 focus:ring-[var(--sg-accent)] outline-none transition-all bg-white"
              />
            </div>
            <div>
              <label htmlFor="request-deadline" className="mb-1.5 block text-sm font-semibold text-ink">Termen limită</label>
              <DateField
                id="request-deadline"
                value={deadline}
                onChange={onDeadlineChange}
                placeholder="Fără termen"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-semibold text-ink">Instrucțiuni</label>
            <AutoGrowTextarea value={draftDescription} onChange={setDraftDescription} />
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

          <SensitiveKindField value={sensitiveKind} onChange={onSensitiveKindChange} name="liveDocSensitive" layout="row" />

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

            <button data-tooltip={editing ? 'Salvează modificările cererii' : 'Creează cererea de document'}
              type="submit"
              disabled={submitting || !draftName.trim()}
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
                  <button data-tooltip="Scoate fișierul din listă"
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
                  <button data-tooltip="Scoate fișierul din listă"
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
