'use client'

import { useEffect, useRef, useState, use } from 'react'
import { Download, Loader2, AlertCircle, FileText } from 'lucide-react'
import { useAuth } from '@/app/providers/AuthProvider'
import { useToast } from '@/app/providers/ToastProvider'
import { getExtension, isImageFileName } from '@/lib/file-preview'

// Vizualizare într-o pagină proprie: fișierul e descărcat din Supabase Storage
// (URL semnat, obținut în culise) și afișat printr-un blob URL. Adresa din bară
// rămâne a aplicației și nu conține niciun token — linkul nu funcționează
// pentru cineva neautentificat sau fără acces la proiect.

type Status = 'loading' | 'ready' | 'error'

// Numele fișierului, când nu vine prin query: din parametrul `download` al
// URL-ului semnat sau, în lipsă, din calea de storage.
function fileNameFromSignedUrl(signedUrl: string): string {
  try {
    const u = new URL(signedUrl)
    const download = u.searchParams.get('download')
    if (download) return download
    return decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || 'fisier')
  } catch {
    return 'fisier'
  }
}

export default function PreviewPage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>
}) {
  const { kind, id } = use(params)
  const { apiFetch, token, loading: authLoading } = useAuth()
  const { showToast } = useToast()

  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState('')
  const [fileName, setFileName] = useState('')
  const [blobUrl, setBlobUrl] = useState('')
  const [isImage, setIsImage] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const startedRef = useRef(false)

  const endpoint = kind === 'attachment'
    ? `/api/document-requests/${id}/attachment/signed-download`
    : `/api/files/${id}/signed-download`

  // pentru cereri cu mai multe modele: care atașament anume se previzualizează
  // (randare doar client-side, deci window există mereu la momentul citirii)
  const attachmentId = kind === 'attachment' && typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('attachmentId')
    : null

  useEffect(() => {
    if (authLoading || !token) return
    if (kind !== 'file' && kind !== 'attachment') {
      setError('Adresă de vizualizare invalidă')
      setStatus('error')
      return
    }
    if (startedRef.current) return
    startedRef.current = true

    ;(async () => {
      try {
        const res = await apiFetch(endpoint, {
          method: 'POST',
          body: JSON.stringify({
            expiresIn: 300,
            disposition: 'inline',
            ...(attachmentId ? { attachment_id: attachmentId } : {}),
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error || 'Nu s-a putut obține fișierul')

        const nameParam = new URLSearchParams(window.location.search).get('name')
        const name = nameParam || fileNameFromSignedUrl(data.url)
        setFileName(name)
        document.title = name

        const fileRes = await fetch(data.url)
        if (!fileRes.ok) throw new Error('Descărcarea fișierului a eșuat')
        const blob = await fileRes.blob()

        const ext = getExtension(name)
        const image = isImageFileName(name) || blob.type.startsWith('image/')
        const pdf = ext === 'pdf' || blob.type === 'application/pdf'
        if (!image && !pdf) {
          throw new Error(`Formatul .${ext || '?'} nu poate fi vizualizat. Folosește descărcarea.`)
        }

        // mime type-ul decide cum afișează browserul blob-ul în iframe
        const typed = pdf && blob.type !== 'application/pdf'
          ? new Blob([blob], { type: 'application/pdf' })
          : blob
        setIsImage(image)
        setBlobUrl(URL.createObjectURL(typed))
        setStatus('ready')
      } catch {
        setError('Nu am putut încărca fișierul. Reîncearcă.')
        setStatus('error')
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, token, kind, id])

  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [blobUrl])

  const handleDownload = async () => {
    setDownloading(true)
    try {
      const res = await apiFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify({
          expiresIn: 300,
          ...(attachmentId ? { attachment_id: attachmentId } : {}),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Eroare la descărcare')
      const a = document.createElement('a')
      a.href = data.url
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch {
      showToast('Nu am putut descărca fișierul. Reîncearcă.', 'error')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="h-screen flex flex-col bg-slate-100">
      {/* Bară de titlu */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 sm:px-6 py-3 bg-white border-b border-slate-200 shadow-sm z-10">
        <div className="w-9 h-9 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 flex-shrink-0">
          <FileText className="w-4 h-4" />
        </div>
        <p className="flex-1 min-w-0 truncate text-sm font-semibold text-slate-900">
          {fileName || 'Document'}
        </p>
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-60 flex-shrink-0"
        >
          {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          <span className="hidden sm:inline">Descarcă</span>
        </button>
      </div>

      {/* Conținut */}
      {status === 'loading' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
          <p className="text-sm text-slate-500">Se încarcă fișierul…</p>
        </div>
      )}

      {status === 'error' && (
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center">
            <AlertCircle className="w-8 h-8 text-amber-600" />
          </div>
          <div>
            <p className="text-base font-bold text-slate-900 mb-1">Vizualizarea nu este disponibilă</p>
            <p className="text-sm text-slate-500 max-w-md">{error}</p>
          </div>
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-60"
          >
            {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Descarcă fișierul
          </button>
        </div>
      )}

      {status === 'ready' && isImage && (
        <div className="flex-1 overflow-auto flex items-center justify-center p-4 sm:p-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={blobUrl}
            alt={fileName}
            className="max-w-full max-h-full object-contain rounded-lg shadow-md bg-white"
          />
        </div>
      )}

      {status === 'ready' && !isImage && (
        <iframe src={blobUrl} title={fileName} className="flex-1 w-full border-0" />
      )}
    </div>
  )
}
