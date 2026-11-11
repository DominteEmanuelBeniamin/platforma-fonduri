export const ALLOWED_UPLOAD_TYPES = [
  'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv', 'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
]

export const ALLOWED_UPLOAD_EXTENSIONS = [
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'jpg', 'jpeg', 'png', 'gif', 'webp',
]

export function getFileExtension(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : ''
}

export function isAllowedUploadFile(file: { name: string; type: string }): boolean {
  return ALLOWED_UPLOAD_TYPES.includes(file.type) || ALLOWED_UPLOAD_EXTENSIONS.includes(getFileExtension(file.name))
}
