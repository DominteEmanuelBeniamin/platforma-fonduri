import type { ClientUploadCandidate, UploadValidationError } from '@/lib/client-upload'

/**
 * Un fișier ales de utilizator, cu starea încărcării lui. Tipul a stat în
 * `DocumentRequests`; l-am scos aici ca să-l poată folosi și bucățile
 * desprinse din el, fără import circular.
 */
export type PickedFile = ClientUploadCandidate & {
  validationError?: UploadValidationError
  uploadProgress?: number // 0-100
  uploadStatus?: 'pending' | 'uploading' | 'success' | 'error'
  uploadError?: string
}

/** Un fișier-model atașat unei cereri de documente. */
export type TemplateAttachment = {
  id: string
  storage_path: string
  original_name: string | null
  mime_type?: string | null
  file_size?: number | null
  order_index?: number
  missing_at?: string | null
  missing_checked_at?: string | null
}
