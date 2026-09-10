'use client'

/**
 * Adresa semnată a unui fișier din Drive și miniaturile de imagine — scrise
 * până acum de două ori, câte o dată în fiecare vedere, cu aceleași reguli.
 */
import { useEffect, useRef, useState } from 'react'
import { getExt, isImageExt } from './parts'

/** Aceeași formă ca `DriveCommonProps.apiFetch`. */
type ApiFetch = (url: string, init?: RequestInit) => Promise<Response>

export type DriveDownloadTarget = {
  downloadKind?: 'file' | 'requestAttachment'
  fileId?: string
  requestId?: string
  attachmentId?: string
  storagePath: string
}

export const DOWNLOAD_ERROR = 'Nu am putut descărca fișierul. Reîncearcă.'

/** `null` înseamnă „n-a mers” — cine cheamă spune asta mai departe. */
export async function fetchDriveSignedUrl(
  apiFetch: ApiFetch,
  target: DriveDownloadTarget,
): Promise<string | null> {
  const endpoint = target.downloadKind === 'requestAttachment'
    ? `/api/document-requests/${target.requestId}/attachment/signed-download`
    : `/api/files/${target.fileId}/signed-download`

  const res = await apiFetch(endpoint, {
    method: 'POST',
    body: JSON.stringify({
      expiresIn: 300,
      ...(target.attachmentId ? { attachment_id: target.attachmentId } : {}),
    }),
  })
  const data = await res.json().catch(() => ({}))
  return res.ok ? (data.url as string) : null
}

/**
 * Miniaturile: doar imaginile, doar fișierele proprii, o singură cerere per
 * fișier cât ține pagina. Lipsa unei miniaturi nu e o eroare de arătat.
 */
export function useDriveImagePreviews(apiFetch: ApiFetch, items: DriveDownloadTarget[]) {
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({})
  const fetchedIds = useRef<Set<string>>(new Set())

  useEffect(() => {
    items.forEach(item => {
      const fileId = item.fileId
      if (item.downloadKind === 'requestAttachment' || !fileId) return
      if (!isImageExt(getExt(item.storagePath)) || fetchedIds.current.has(fileId)) return
      fetchedIds.current.add(fileId)
      ;(async () => {
        try {
          const res = await apiFetch(`/api/files/${fileId}/signed-download`, {
            method: 'POST',
            body: JSON.stringify({ expiresIn: 600 }), // plafon server-side
          })
          if (res.ok) {
            const { url } = await res.json()
            setPreviewUrls(prev => ({ ...prev, [fileId]: url }))
          }
        } catch { /* miniatura e opțională */ }
      })()
    })
  }, [items, apiFetch])

  return previewUrls
}
