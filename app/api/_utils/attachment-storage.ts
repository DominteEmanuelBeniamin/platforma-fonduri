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
 * Duplică obiectul din storage. Întoarce calea nouă, sau `null` dacă sursa nu
 * mai există — caz în care apelantul păstrează calea veche, ca marcajul de
 * fișier lipsă să rămână vizibil în loc să apară o cale nouă și goală.
 */
export async function copyStorageObject(
  admin: SupabaseClient,
  fromPath: string,
  toPath: string,
): Promise<string | null> {
  const { error } = await admin.storage.from(ATTACHMENT_BUCKET).copy(fromPath, toPath)
  if (error) {
    console.error('copyStorageObject error:', { fromPath, toPath, error: error.message })
    return null
  }
  return toPath
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

  const referenced = new Set<string>()
  for (const row of templateDocs.data ?? []) if (row.attachment_path) referenced.add(row.attachment_path)
  for (const row of projectDocs.data ?? []) if (row.attachment_path) referenced.add(row.attachment_path)
  for (const row of attachments.data ?? []) if (row.storage_path) referenced.add(row.storage_path)
  return referenced
}
