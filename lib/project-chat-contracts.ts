export const PROJECT_CHAT_BUCKET = 'project-files'
export const PROJECT_CHAT_MAX_IMAGES = 5
export const PROJECT_CHAT_MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const PROJECT_CHAT_SIGNED_URL_TTL_SECONDS = 60 * 60

export const PROJECT_CHAT_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const

export type ProjectChatImageMimeType = (typeof PROJECT_CHAT_IMAGE_MIME_TYPES)[number]

export type StoredChatImage = {
  path: string
  name: string
  mimeType: ProjectChatImageMimeType
  size: number
}

export type ChatImage = StoredChatImage & {
  signedUrl: string | null
  signedUrlExpiresAt: string | null
}

export type ChatImageReference = Pick<StoredChatImage, 'path' | 'name'>

export type ProjectChatMessage = {
  id: string
  project_id: string
  created_by: string
  body: string | null
  images: ChatImage[]
  created_at: string
  edited_at: string | null
  deleted_at: string | null
  is_deleted?: boolean
  body_masked?: boolean
}

export function isProjectChatImageMimeType(value: string): value is ProjectChatImageMimeType {
  return PROJECT_CHAT_IMAGE_MIME_TYPES.includes(value as ProjectChatImageMimeType)
}
