import {
  PROJECT_CHAT_BUCKET,
  PROJECT_CHAT_MAX_IMAGE_BYTES,
  PROJECT_CHAT_SIGNED_URL_TTL_SECONDS,
  type ChatImage,
  type ProjectChatMessage,
  type StoredChatImage,
  isProjectChatImageMimeType,
} from '../../../lib/project-chat-contracts.ts'
import { createSupabaseServiceClient } from './supabase.ts'

export type ProjectChatMessageRow = Omit<ProjectChatMessage, 'images'> & {
  images?: unknown
  profiles?: unknown
}

export type ProjectChatBodyMaskResult = {
  body: string | null
  masked?: boolean
}

export type ProjectChatBodyMasker = (
  row: ProjectChatMessageRow,
) => ProjectChatBodyMaskResult | Promise<ProjectChatBodyMaskResult>

type SignedUrlResult = {
  path?: unknown
  signedUrl?: unknown
  signedURL?: unknown
}

function toStoredImage(value: unknown): StoredChatImage | null {
  if (!value || typeof value !== 'object') return null
  const image = value as Record<string, unknown>
  if (
    typeof image.path !== 'string' ||
    !image.path ||
    typeof image.name !== 'string' ||
    !image.name ||
    typeof image.mimeType !== 'string' ||
    !isProjectChatImageMimeType(image.mimeType) ||
    typeof image.size !== 'number' ||
    !Number.isSafeInteger(image.size) ||
    image.size < 1 ||
    image.size > PROJECT_CHAT_MAX_IMAGE_BYTES
  ) {
    return null
  }
  return {
    path: image.path,
    name: image.name,
    mimeType: image.mimeType,
    size: image.size,
  }
}

function readImages(value: unknown): StoredChatImage[] {
  if (!Array.isArray(value)) return []
  return value.map(toStoredImage).filter((image): image is StoredChatImage => image !== null)
}

function readSignedUrl(value: unknown): { path: string; signedUrl: string | null } | null {
  if (!value || typeof value !== 'object') return null
  const row = value as SignedUrlResult
  const path = typeof row.path === 'string' ? row.path : ''
  if (!path) return null
  const signedUrl = typeof row.signedUrl === 'string'
    ? row.signedUrl
    : typeof row.signedURL === 'string'
      ? row.signedURL
      : null
  return { path, signedUrl }
}

export async function serializeProjectChatMessages(
  rows: readonly ProjectChatMessageRow[],
  admin: ReturnType<typeof createSupabaseServiceClient> = createSupabaseServiceClient(),
  maskBody?: ProjectChatBodyMasker,
): Promise<ProjectChatMessage[]> {
  const prepared = [] as Array<{
    row: ProjectChatMessageRow
    deleted: boolean
    body: string | null
    images: StoredChatImage[]
    bodyMasked: boolean
  }>

  for (const row of rows) {
    const deleted = !!row.deleted_at
    if (deleted) {
      prepared.push({ row, deleted: true, body: null, images: [], bodyMasked: false })
      continue
    }

    let body = typeof row.body === 'string' ? row.body : null
    let bodyMasked = !!row.body_masked
    if (maskBody) {
      const masked = await maskBody(row)
      body = masked.body
      bodyMasked = !!masked.masked
    }
    prepared.push({ row, deleted: false, body, images: readImages(row.images), bodyMasked })
  }

  const paths = [...new Set(prepared.flatMap(({ images }) => images.map(image => image.path)))]
  const signedByPath = new Map<string, string | null>()
  const signedUrlExpiresAt = paths.length
    ? new Date(Date.now() + PROJECT_CHAT_SIGNED_URL_TTL_SECONDS * 1000).toISOString()
    : null

  if (paths.length > 0) {
    try {
      const { data, error } = await admin.storage
        .from(PROJECT_CHAT_BUCKET)
        .createSignedUrls(paths, PROJECT_CHAT_SIGNED_URL_TTL_SECONDS)
      if (!error && Array.isArray(data)) {
        for (const [index, item] of data.entries()) {
          const signed = readSignedUrl(item)
          if (signed) {
            signedByPath.set(signed.path, signed.signedUrl)
          } else if (item && typeof item === 'object') {
            const fallbackUrl = (item as SignedUrlResult).signedUrl ?? (item as SignedUrlResult).signedURL
            if (typeof fallbackUrl === 'string' || fallbackUrl === null) {
              signedByPath.set(paths[index], typeof fallbackUrl === 'string' ? fallbackUrl : null)
            }
          }
        }
      }
    } catch {
      // A missing object must not hide the rest of the conversation.
    }
  }

  return prepared.map(({ row, deleted, body, images, bodyMasked }) => {
    const serializedImages: ChatImage[] = deleted
      ? []
      : images.map(image => ({
          ...image,
          signedUrl: signedByPath.get(image.path) ?? null,
          signedUrlExpiresAt: signedByPath.get(image.path) ? signedUrlExpiresAt : null,
        }))

    return {
      ...row,
      body: deleted ? null : body,
      images: serializedImages,
      is_deleted: deleted,
      ...(bodyMasked ? { body_masked: true } : {}),
    }
  })
}

export async function serializeProjectChatMessage(
  row: ProjectChatMessageRow,
  admin?: ReturnType<typeof createSupabaseServiceClient>,
  maskBody?: ProjectChatBodyMasker,
): Promise<ProjectChatMessage> {
  const [message] = await serializeProjectChatMessages([row], admin, maskBody)
  return message
}
