'use client'

import { useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AlertCircle, Check, Paperclip, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { REQUIREMENT_LABELS, REQUIREMENT_TYPES, type RequirementType } from '@/lib/requirement-type'
import { AutoGrowTextarea } from './AutoGrowTextarea'
import type { DocumentRequirement, TemplateAttachment } from './types'

export type DocDialogValues = {
  name: string
  description: string
  is_outgoing: boolean
  requirement_type: RequirementType
  templateFiles: File[]
  templateAttachments: TemplateAttachment[]
}

const inputClass =
  'h-11 w-full rounded-[var(--radius-plate)] border border-rule bg-plate px-3 text-sm text-ink ' +
  'placeholder:text-ink-faint transition-colors duration-[120ms] focus:border-[var(--sg-accent)] sm:h-10'

/**
 * Cererea de document din șablon: creare și modificare. Ține câmpurile în ea,
 * nu în pagină: altfel fiecare literă re-randa tot editorul (S-26). Pagina
 * primește valorile o singură dată, la „Adaugă” sau „Salvează”.
 */
export function DocDialog({
  editing,
  onSave,
  onClose,
}: {
  /** Cererea modificată, sau `null` pentru una nouă. */
  editing: DocumentRequirement | null
  onSave: (values: DocDialogValues) => void
  onClose: () => void
}) {
  const [name, setName] = useState(editing?.name ?? '')
  const [description, setDescription] = useState(editing?.description ?? '')
  const [outgoing, setOutgoing] = useState(editing?.is_outgoing ?? false)
  const [category, setCategory] = useState<RequirementType>(editing?.requirement_type ?? 'obligatoriu')
  const [files, setFiles] = useState<File[]>(editing?.templateFiles ?? [])
  const [attachments, setAttachments] = useState<TemplateAttachment[]>(editing?.templateAttachments ?? [])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [opener] = useState(() => (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null))
  const hasTemplate = files.length > 0 || attachments.length > 0
  const canSave = !!name.trim() && !(outgoing && !hasTemplate)

  const save = () => {
    if (!canSave) return
    onSave({
      name: name.trim(),
      description: description.trim(),
      is_outgoing: outgoing,
      requirement_type: outgoing ? 'optional' : category,
      templateFiles: files,
      templateAttachments: attachments,
    })
  }

  const title = editing ? 'Modifică cererea de document' : 'Adaugă cerere document'
  return (
    <Dialog.Root open onOpenChange={open => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[1000]" style={{ backgroundColor: 'rgb(22 24 28 / 0.45)' }} />
        <Dialog.Content
          aria-describedby={undefined}
          onCloseAutoFocus={event => {
            event.preventDefault()
            if (opener?.isConnected) opener.focus()
          }}
          className="fixed left-1/2 top-1/2 z-[1000] flex max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[var(--radius-plate-lg)] border border-rule bg-plate focus:outline-none"
          style={{ boxShadow: 'var(--sg-lift)' }}
        >
          <div className="flex shrink-0 items-center justify-between border-b border-rule px-6 py-4">
            <Dialog.Title className="font-bold text-ink">{title}</Dialog.Title>
            <Dialog.Close asChild>
              <IconButton label="Închide"><X className="h-5 w-5" /></IconButton>
            </Dialog.Close>
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto p-6">
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-ink">Nume document<span className="ml-0.5 text-[var(--sg-danger)]" aria-hidden="true">*</span></span>
              <input
                type="text"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save() } }}
                placeholder="Ex: Certificat constatator"
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-ink">Descriere</span>
              <AutoGrowTextarea
                value={description}
                onChange={setDescription}
                placeholder="Instrucțiuni pentru client…"
              />
            </label>
            <label className="flex cursor-pointer items-start gap-2 rounded-[var(--radius-plate)] border border-[var(--sg-accent)] bg-[var(--sg-accent-soft)] px-3 py-2">
              <input
                type="checkbox"
                checked={outgoing}
                onChange={(e) => {
                  setOutgoing(e.target.checked)
                  if (e.target.checked) setCategory('optional')
                }}
                className="mt-0.5 h-4 w-4 border-rule-strong text-[var(--sg-accent)]"
              />
              <span>
                <span className="block text-sm font-medium text-ink">Document de trimis (fără răspuns)</span>
                <span className="block text-xs text-ink-soft">Clientul îl poate descărca, fără upload înapoi.</span>
              </span>
            </label>
            <div>
              <span className="mb-2 block text-sm font-semibold text-ink">
                {outgoing ? <>Documente atașate<span className="ml-0.5 text-[var(--sg-danger)]" aria-hidden="true">*</span></> : 'Modele / template-uri (opțional)'}
              </span>
              <input
                ref={fileInputRef}
                type="file"
                onChange={(e) => {
                  const picked = Array.from(e.currentTarget.files ?? [])
                  if (picked.length) setFiles(current => [...current, ...picked])
                  e.currentTarget.value = ''
                }}
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png,.gif,.webp"
                multiple
              />
              {hasTemplate ? (
                <div className="space-y-2 rounded-[var(--radius-plate)] border border-[var(--sg-accent)] bg-[var(--sg-accent-soft)] p-3">
                  {attachments.map(attachment => (
                    <div key={attachment.id} className="flex items-center gap-3">
                      {attachment.missing_at ? (
                        <AlertCircle className="h-4 w-4 shrink-0 text-[var(--sg-warn)]" aria-hidden="true" />
                      ) : (
                        <Paperclip className="h-4 w-4 shrink-0 text-[var(--sg-accent)]" aria-hidden="true" />
                      )}
                      <p className={`flex-1 truncate text-sm font-medium ${attachment.missing_at ? 'text-[var(--sg-warn)]' : 'text-[var(--sg-accent)]'}`}>
                        {attachment.original_name || attachment.storage_path.split('/').pop() || 'fișier atașat'}
                        {attachment.missing_at && <span className="ml-1 text-xs">(indisponibil)</span>}
                      </p>
                      <button data-tooltip="Scoate fișierul-model din listă"
                        type="button"
                        onClick={() => setAttachments(current => current.filter(item => item.id !== attachment.id))}
                        className="text-xs font-medium text-[var(--sg-danger)] hover:brightness-90"
                      >
                        Elimină
                      </button>
                    </div>
                  ))}
                  {files.map((file, index) => (
                    <div key={`${file.name}-${file.size}-${index}`} className="flex items-center gap-3">
                      <Paperclip className="h-4 w-4 shrink-0 text-[var(--sg-accent)]" aria-hidden="true" />
                      <p className="flex-1 truncate text-sm font-medium text-[var(--sg-accent)]">{file.name}</p>
                      <p className="text-xs text-[var(--sg-accent)]">{(file.size / 1024).toFixed(1)} KB</p>
                      <button data-tooltip="Scoate fișierul-model din listă"
                        type="button"
                        onClick={() => setFiles(current => current.filter((_, fileIndex) => fileIndex !== index))}
                        className="text-xs font-medium text-[var(--sg-danger)] hover:brightness-90"
                      >
                        Elimină
                      </button>
                    </div>
                  ))}
                  <button data-tooltip="Atașează fișiere-model pe care clientul le descarcă și le completează"
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--sg-accent)] hover:text-[var(--sg-accent-ink)]"
                  >
                    <Upload className="h-3 w-3" aria-hidden="true" />
                    Adaugă fișiere
                  </button>
                </div>
              ) : (
                <button data-tooltip="Atașează fișiere-model pe care clientul le descarcă și le completează"
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex w-full flex-col items-center justify-center gap-2 rounded-[var(--radius-plate)] border-2 border-dashed border-rule p-6 transition-colors duration-[120ms] hover:border-[var(--sg-accent)] hover:bg-[var(--sg-accent-soft)]"
                >
                  <Upload className="h-8 w-8 text-ink-faint" aria-hidden="true" />
                  <span className="text-sm font-medium text-ink-soft">Click pentru a adăuga fișiere</span>
                  <span className="text-xs text-ink-faint">PDF, DOC, DOCX, XLS, XLSX, CSV, imagini</span>
                </button>
              )}
              {outgoing && !hasTemplate && (
                <p className="mt-1 text-xs text-[var(--sg-danger)]">Documentul de trimis are nevoie de fișier atașat.</p>
              )}
            </div>
            {!outgoing && (
              <fieldset>
                <legend className="mb-2 text-sm font-semibold text-ink">Tip cerință</legend>
                <div className="space-y-2">
                  {REQUIREMENT_TYPES.map(rt => (
                    <label key={rt} className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name="newDocCategoryTemplate"
                        value={rt}
                        checked={category === rt}
                        onChange={() => setCategory(rt)}
                        className="h-4 w-4 border-rule-strong text-[var(--sg-accent)]"
                      />
                      <span className="text-sm text-ink">{REQUIREMENT_LABELS[rt]}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          </div>
          <div className="flex shrink-0 gap-3 border-t border-rule bg-paper-sunk px-6 py-4">
            <Button data-tooltip="Închide fără să salvezi" variant="secondary" className="flex-1" onClick={onClose}>
              Anulează
            </Button>
            <Button data-tooltip={editing ? 'Salvează cererea de document' : 'Adaugă cererea de document în activitate'}
              variant="primary"
              className="flex-1"
              onClick={save}
              disabled={!canSave}
            >
              <Check className="h-4 w-4" aria-hidden="true" /> {editing ? 'Salvează' : 'Adaugă'}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
