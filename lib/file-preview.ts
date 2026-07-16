// Deschiderea inline în browser este permisă doar pentru PDF și imagini raster.
// SVG este exclus intenționat: poate conține script-uri executate la afișare.

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp'])
const PREVIEWABLE_EXTENSIONS = new Set(['pdf', ...IMAGE_EXTENSIONS])

const PREVIEWABLE_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
])

export function getExtension(name: string | null | undefined): string {
  if (!name) return ''
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function isImageFileName(name: string | null | undefined): boolean {
  return IMAGE_EXTENSIONS.has(getExtension(name))
}

export function isPreviewableFileName(name: string | null | undefined): boolean {
  const ext = getExtension(name)
  return ext !== '' && PREVIEWABLE_EXTENSIONS.has(ext)
}

export function isPreviewableMimeType(mime: string | null | undefined): boolean {
  if (!mime) return false
  return PREVIEWABLE_MIME_TYPES.has(mime.split(';')[0].trim().toLowerCase())
}

// Când mime type-ul e stocat, el decide; extensia e doar fallback pentru
// fișierele fără mime type (ex. atașamentele cererilor).
export function isPreviewableFile({
  mimeType,
  fileName,
}: {
  mimeType?: string | null
  fileName?: string | null
}): boolean {
  if (mimeType) return isPreviewableMimeType(mimeType)
  return isPreviewableFileName(fileName)
}

// Pagina internă /preview afișează fișierul fără să expună URL-ul semnat
// în bara de adrese; linkul nu funcționează fără autentificare.
export function buildPreviewPageUrl(target: {
  type: 'file' | 'attachment'
  id: string
  name?: string | null
}): string {
  // numele poate veni ca storage path — păstrăm doar numele de fișier
  const baseName = target.name?.split('/').filter(Boolean).pop() || null
  const query = baseName ? `?name=${encodeURIComponent(baseName)}` : ''
  return `/preview/${target.type}/${target.id}${query}`
}

export function openInNewTab(url: string) {
  const a = document.createElement('a')
  a.href = url
  a.target = '_blank'
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

const EXPIRES_IN_MIN = 60
const EXPIRES_IN_MAX = 600
const EXPIRES_IN_DEFAULT = 300

// Plafon server-side pentru durata URL-urilor semnate: clientul poate cere
// orice valoare, dar nu poate obține un link valabil mai mult de 10 minute.
export function clampExpiresIn(requested: unknown): number {
  const value = typeof requested === 'number' ? requested : EXPIRES_IN_DEFAULT
  return Math.min(Math.max(Math.trunc(value), EXPIRES_IN_MIN), EXPIRES_IN_MAX)
}
