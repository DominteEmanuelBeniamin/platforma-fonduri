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

// Formate Office randate client-side în pagina /preview (docx-preview + SheetJS).
// .doc (binar, pre-2007) nu e suportat de docx-preview — rămâne doar descărcabil.
const OFFICE_PREVIEWABLE_EXTENSIONS = new Set(['docx', 'xlsx', 'xls', 'csv'])

const OFFICE_PREVIEWABLE_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
])

function getExtension(name: string | null | undefined): string {
  if (!name) return ''
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function isOfficePreviewableFileName(name: string | null | undefined): boolean {
  return OFFICE_PREVIEWABLE_EXTENSIONS.has(getExtension(name))
}

export type PreviewKind = 'inline' | 'office'

// 'inline' → browserul afișează nativ (PDF/imagini, URL semnat direct);
// 'office' → pagina internă /preview randează fișierul; null → doar descărcare.
export function getPreviewKind({
  mimeType,
  fileName,
}: {
  mimeType?: string | null
  fileName?: string | null
}): PreviewKind | null {
  if (isPreviewableFile({ mimeType, fileName })) return 'inline'
  if (isOfficePreviewableFileName(fileName)) return 'office'
  if (mimeType && OFFICE_PREVIEWABLE_MIME_TYPES.has(mimeType.split(';')[0].trim().toLowerCase())) {
    return 'office'
  }
  return null
}

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
