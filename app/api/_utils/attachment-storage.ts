// Obiectele din storage ale fișierelor-model.
//
// O copie trebuie să-și aibă propriul obiect, nu să arate spre al originalului:
// altfel ștergerea modelului de pe unul îl rupe pe celălalt, iar fiecare flux
// nou de ștergere trebuie să-și amintească de excepția asta.

import type { SupabaseClient } from '@supabase/supabase-js'

export const ATTACHMENT_BUCKET = 'project-files'

function safeName(name: string | null | undefined) {
  return (name || 'fisier').replace(/[^\w.\- ()[\]]+/g, '_')
}

/** Aceeași convenție ca la încărcarea din pagina proiectului. */
export function projectAttachmentPath(projectId: string, originalName: string | null | undefined) {
  return `${projectId}/cereri/${crypto.randomUUID()}_${safeName(originalName)}`
}

/** Aceeași convenție ca la încărcarea dintr-un șablon. */
export function templateAttachmentPath(originalName: string | null | undefined) {
  return `templates/attachments/${crypto.randomUUID()}_${safeName(originalName)}`
}

/**
 * Rezultatul unei copieri: calea nouă, sau motivul pentru care n-a existat.
 * Cele două eșecuri cer răspunsuri opuse, deci nu pot fi amândouă `null`:
 * „missing” e o stare pe care copia o poate moșteni, „failed” e un accident
 * după care copia n-are voie să rămână pe obiectul originalului.
 */
export type CopyResult =
  | { path: string; reason?: undefined }
  | { path: null; reason: 'missing' | 'failed' }

export interface TemplateAttachmentInput {
  id?: string | null
  storage_path: string
  original_name?: string | null
  mime_type?: string | null
  file_size?: number | null
  order_index?: number
  missing_at?: string | null
  missing_checked_at?: string | null
}

export interface TemplateAttachmentCopyResult {
  attachments: TemplateAttachmentInput[]
  legacyPath: string | null
  legacyOriginalName: string | null
  legacyMissingAt: string | null
  legacyMissingCheckedAt: string | null
}

/**
 * Obiectul sursă chiar nu mai există, spre deosebire de un 5xx, un timeout sau
 * o coliziune de nume. „Bucket not found” e o problemă de configurare, nu un
 * fișier-model șters, deci nu intră aici.
 */
export function isMissingObjectError(message: string | null | undefined): boolean {
  const text = (message ?? '').toLowerCase()
  if (text.includes('bucket not found')) return false
  return /not[\s_-]*found/.test(text) || /\b404\b/.test(text)
}

/**
 * Duplică obiectul din storage. Când sursa nu mai există, apelantul păstrează
 * calea veche împreună cu marcajul de fișier lipsă; la orice altă eroare
 * duplicarea trebuie oprită, altfel copia rămâne pe obiectul originalului.
 */
export async function copyStorageObject(
  admin: SupabaseClient,
  fromPath: string,
  toPath: string,
): Promise<CopyResult> {
  const { error } = await admin.storage.from(ATTACHMENT_BUCKET).copy(fromPath, toPath)
  if (!error) return { path: toPath }
  console.error('copyStorageObject error:', { fromPath, toPath, error: error.message })
  return { path: null, reason: isMissingObjectError(error.message) ? 'missing' : 'failed' }
}

/**
 * Căile deja folosite de altcineva, dintre cele primite. Serverul o folosește
 * ca să nu ajungă două cerințe diferite pe același obiect.
 */
export async function findReferencedPaths(
  admin: SupabaseClient,
  paths: readonly string[],
): Promise<Set<string>> {
  if (paths.length === 0) return new Set()

  const [templateDocs, projectDocs, attachments] = await Promise.all([
    admin.from('template_document_requirements').select('attachment_path').in('attachment_path', paths as string[]),
    admin.from('document_requirements').select('attachment_path').in('attachment_path', paths as string[]).is('deleted_at', null),
    admin.from('document_requirement_attachments').select('storage_path').in('storage_path', paths as string[]),
  ])

  const failed = [templateDocs.error, projectDocs.error, attachments.error].find(Boolean)
  if (failed) throw failed

  const referenced = new Set<string>()
  for (const row of templateDocs.data ?? []) if (row.attachment_path) referenced.add(row.attachment_path)
  for (const row of projectDocs.data ?? []) if (row.attachment_path) referenced.add(row.attachment_path)
  for (const row of attachments.data ?? []) if (row.storage_path) referenced.add(row.storage_path)
  return referenced
}

/**
 * Copiază atașamentele existente ale unui document de șablon, păstrând lista
 * ca reprezentare principală. `createdPaths` este ledger-ul operației curente
 * și permite rutei să șteargă numai obiectele create aici la un eșec ulterior.
 */
export async function copyTemplateAttachments(
  admin: SupabaseClient,
  attachments: readonly TemplateAttachmentInput[],
  legacyPath: string | null,
  legacyOriginalName: string | null | undefined,
  referencedPaths: ReadonlySet<string>,
  createdPaths: string[] = [],
): Promise<TemplateAttachmentCopyResult> {
  const copyOne = async (item: TemplateAttachmentInput): Promise<TemplateAttachmentInput> => {
    const sourcePath = item.storage_path.trim()
    if (!referencedPaths.has(sourcePath)) {
      return { ...item, storage_path: sourcePath }
    }

    const copy = await copyStorageObject(admin, sourcePath, templateAttachmentPath(item.original_name))
    if (copy.reason === 'failed') {
      throw new Error(`Nu am putut copia fișierul-model "${item.original_name ?? sourcePath}".`)
    }
    if (copy.path) {
      createdPaths.push(copy.path)
      return { ...item, storage_path: copy.path, missing_at: null, missing_checked_at: null }
    }

    const checkedAt = new Date().toISOString()
    return {
      ...item,
      storage_path: sourcePath,
      missing_at: item.missing_at ?? checkedAt,
      missing_checked_at: checkedAt,
    }
  }

  if (attachments.length > 0) {
    const copied = []
    for (const attachment of attachments) copied.push(await copyOne(attachment))
    const first = copied[0]
    return {
      attachments: copied,
      legacyPath: first?.storage_path ?? null,
      legacyOriginalName: first?.original_name ?? null,
      legacyMissingAt: first?.missing_at ?? null,
      legacyMissingCheckedAt: first?.missing_checked_at ?? null,
    }
  }

  if (!legacyPath) {
    return {
      attachments: [],
      legacyPath: null,
      legacyOriginalName: null,
      legacyMissingAt: null,
      legacyMissingCheckedAt: null,
    }
  }

  const copiedLegacy = await copyOne({
    storage_path: legacyPath,
    original_name: legacyOriginalName ?? null,
  })
  return {
    attachments: [],
    legacyPath: copiedLegacy.storage_path,
    legacyOriginalName: copiedLegacy.original_name ?? legacyOriginalName ?? null,
    legacyMissingAt: copiedLegacy.missing_at ?? null,
    legacyMissingCheckedAt: copiedLegacy.missing_checked_at ?? null,
  }
}

/** Compensează numai rândul documentului nou și obiectele create de operație. */
export async function compensateTemplateDocument(
  admin: SupabaseClient,
  documentId: string | null,
  createdPaths: readonly string[],
): Promise<string[]> {
  const errors: string[] = []
  if (documentId) {
    try {
      const { error } = await admin
        .from('document_requirement_attachments')
        .delete()
        .eq('template_document_requirement_id', documentId)
      if (error) errors.push(`attachments: ${error.message}`)
    } catch (error: unknown) {
      errors.push(`attachments: ${error instanceof Error ? error.message : String(error)}`)
    }

    try {
      const { error } = await admin
        .from('template_document_requirements')
        .delete()
        .eq('id', documentId)
      if (error) errors.push(`document: ${error.message}`)
    } catch (error: unknown) {
      errors.push(`document: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (createdPaths.length > 0) {
    try {
      const { error } = await admin.storage.from(ATTACHMENT_BUCKET).remove([...createdPaths])
      if (error) errors.push(`storage: ${error.message}`)
    } catch (error: unknown) {
      errors.push(`storage: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (errors.length > 0) console.error('Template document compensation failed:', errors)
  return errors
}
