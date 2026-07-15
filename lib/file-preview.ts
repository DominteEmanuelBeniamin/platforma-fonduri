// Deschiderea inline în browser este permisă doar pentru PDF și imagini raster.
// SVG este exclus intenționat: poate conține script-uri executate la afișare.

const PREVIEWABLE_EXTENSIONS = new Set(['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp'])

const PREVIEWABLE_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
])

export function isPreviewableFileName(name: string | null | undefined): boolean {
  if (!name) return false
  const dot = name.lastIndexOf('.')
  if (dot < 0) return false
  return PREVIEWABLE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase())
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

export type PreviewKind = 'inline'

// 'inline' → browserul afișează nativ (PDF/imagini, URL semnat direct);
// null → doar descărcare. Word/Excel/CSV nu se previzualizează.
export function getPreviewKind({
  mimeType,
  fileName,
}: {
  mimeType?: string | null
  fileName?: string | null
}): PreviewKind | null {
  return isPreviewableFile({ mimeType, fileName }) ? 'inline' : null
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
