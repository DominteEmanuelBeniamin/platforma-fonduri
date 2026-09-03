import { createSupabaseServiceClient } from './supabase.ts'
import { PROJECT_CHAT_BUCKET, type StoredChatImage } from '../../../lib/project-chat-contracts.ts'

type ProjectChatAdmin = ReturnType<typeof createSupabaseServiceClient>

/** Doar intrările care au forma din `project_chat_messages.images`. */
export function storedChatImages(value: unknown): StoredChatImage[] {
  if (!Array.isArray(value)) return []
  return value.filter((image): image is StoredChatImage => {
    if (!image || typeof image !== 'object') return false
    const row = image as Partial<StoredChatImage>
    return typeof row.path === 'string' &&
      typeof row.name === 'string' &&
      typeof row.mimeType === 'string' &&
      typeof row.size === 'number'
  })
}

/**
 * Un termen `cs` pentru o cale, ghilimelat.
 *
 * PostgREST desparte valorile filtrelor după paranteze și virgule, iar numele
 * de fișier acceptate de sanitizare le conțin pe primele — Windows numește
 * duplicatele „poza (1).png". Nequotată, o astfel de cale rupea filtrul, cu
 * `22P02: invalid input syntax for type json`: ștergerea unui mesaj nu mai
 * scotea pozele din bucket, iar ruta de cleanup întorcea 500. Ghilimelele nu
 * sunt o precauție teoretică, deci nu se scot.
 */
export function projectChatImagePathFilter(path: string): string {
  const json = JSON.stringify([{ path }])
  return `images.cs."${json.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * Ce path-uri mai sunt folosite de un mesaj viu din proiect.
 *
 * O singură interogare pentru tot lotul, nu una pe imagine: `images` e un
 * `jsonb[]`, iar `cs` (contains) face potrivire parțială pe obiect, deci un
 * `or` peste path-uri e suficient.
 */
export async function referencedProjectChatImagePaths(
  admin: ProjectChatAdmin,
  projectId: string,
  paths: readonly string[],
): Promise<Set<string>> {
  if (paths.length === 0) return new Set()

  const { data, error } = await admin
    .from('project_chat_messages')
    .select('images')
    .eq('project_id', projectId)
    .is('deleted_at', null)
    .or(paths.map(projectChatImagePathFilter).join(','))

  if (error) throw error

  const wanted = new Set(paths)
  const referenced = new Set<string>()
  for (const row of data ?? []) {
    for (const image of storedChatImages((row as { images?: unknown }).images)) {
      if (wanted.has(image.path)) referenced.add(image.path)
    }
  }
  return referenced
}

/**
 * Șterge din bucket doar path-urile pe care nu le mai ține niciun mesaj viu.
 * Aruncă la eroare — apelantul decide dacă e fatal (ruta de cleanup) sau
 * best-effort (ștergerea unui mesaj).
 */
export async function removeUnreferencedProjectChatImages(
  admin: ProjectChatAdmin,
  projectId: string,
  paths: readonly string[],
): Promise<{ removed: string[]; skipped: string[] }> {
  const unique = [...new Set(paths)]
  if (unique.length === 0) return { removed: [], skipped: [] }

  const referenced = await referencedProjectChatImagePaths(admin, projectId, unique)
  const removed = unique.filter(path => !referenced.has(path))
  if (removed.length > 0) {
    const { error } = await admin.storage.from(PROJECT_CHAT_BUCKET).remove(removed)
    if (error) throw error
  }
  return { removed, skipped: unique.filter(path => referenced.has(path)) }
}
