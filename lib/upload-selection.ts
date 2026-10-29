/**
 * Fișierele alese pentru o cerere, numărate pentru dialogul de încărcare al
 * clientului. Fără importuri cu alias, ca testele (`node --test`) să-l poată
 * încărca direct.
 */

import { countLabel } from './count-label.ts'

export type SelectionItem = {
  size: number
  validationError?: unknown
  uploadStatus?: 'pending' | 'uploading' | 'success' | 'error'
}

export type SelectionStats = {
  total: number
  /** Ce pleacă la următorul „Încarcă”: valide și neîncărcate încă. */
  toUpload: number
  invalid: number
  failed: number
  uploading: number
  uploaded: number
  /** Ales, dar neajuns la consultant: ce se pierde dacă închizi. */
  notUploaded: number
  totalSize: number
}

export function selectionStats(files: readonly SelectionItem[]): SelectionStats {
  const stats: SelectionStats = { total: files.length, toUpload: 0, invalid: 0, failed: 0, uploading: 0, uploaded: 0, notUploaded: 0, totalSize: 0 }
  for (const file of files) {
    stats.totalSize += file.size
    if (file.validationError) stats.invalid++
    else if (file.uploadStatus !== 'success') stats.toUpload++
    if (file.uploadStatus === 'error') stats.failed++
    if (file.uploadStatus === 'uploading') stats.uploading++
    if (file.uploadStatus === 'success') stats.uploaded++
    else stats.notUploaded++
  }
  return stats
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${parseFloat((bytes / 1024 ** index).toFixed(1))} ${units[index]}`
}

/** „3 fișiere selectate · 2.4 MB · 1 eroare”: erorile apar doar dacă există. */
export function selectionSummary(stats: SelectionStats): string {
  const parts = [
    `${countLabel(stats.total, 'fișier selectat', 'fișiere selectate')}`,
    formatFileSize(stats.totalSize),
  ]
  const errors = stats.invalid + stats.failed
  if (errors > 0) parts.push(countLabel(errors, 'eroare', 'erori'))
  return parts.join(' · ')
}

/** Textul confirmării la închidere, cu acordul verbului pentru un singur fișier. */
export function discardSelectionText(notUploaded: number): string {
  return notUploaded === 1
    ? 'Ai ales 1 fișier care nu s-a încărcat. Dacă închizi, selecția se pierde.'
    : `Ai ales ${countLabel(notUploaded, 'fișier', 'fișiere')} care nu s-au încărcat. Dacă închizi, selecția se pierde.`
}
