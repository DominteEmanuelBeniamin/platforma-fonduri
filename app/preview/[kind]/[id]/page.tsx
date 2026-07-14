'use client'

import { useEffect, useRef, useState, use } from 'react'
import { Download, Loader2, AlertCircle, FileText } from 'lucide-react'
import { useAuth } from '@/app/providers/AuthProvider'

// Randare client-side: documentul e descărcat direct din Supabase Storage
// (URL semnat) și randat în browser — nu trece prin niciun serviciu terț.

const MAX_PREVIEW_SIZE = 30 * 1024 * 1024

type Status = 'loading' | 'ready' | 'error'

function getExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

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

  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState('')
  const [fileName, setFileName] = useState('')
  const [sheetNames, setSheetNames] = useState<string[]>([])
  const [activeSheet, setActiveSheet] = useState(0)
  const [sheetHtml, setSheetHtml] = useState('')
  const [downloading, setDownloading] = useState(false)

  const docxContainerRef = useRef<HTMLDivElement | null>(null)
  const workbookRef = useRef<any>(null) // eslint-disable-line @typescript-eslint/no-explicit-any
  const startedRef = useRef(false)

  const endpoint = kind === 'attachment'
    ? `/api/document-requests/${id}/attachment/signed-download`
    : `/api/files/${id}/signed-download`

  useEffect(() => {
    if (authLoading || !token) return
    if (kind !== 'file' && kind !== 'attachment') {
      setError('Adresă de preview invalidă')
      setStatus('error')
      return
    }
    if (startedRef.current) return
    startedRef.current = true

    ;(async () => {
      try {
        const res = await apiFetch(endpoint, {
          method: 'POST',
          body: JSON.stringify({ expiresIn: 300 }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error || 'Nu s-a putut obține fișierul')

        const nameParam = new URLSearchParams(window.location.search).get('name')
        const name = nameParam || fileNameFromSignedUrl(data.url)
        setFileName(name)
        document.title = name

        const fileRes = await fetch(data.url)
        if (!fileRes.ok) throw new Error('Descărcarea fișierului a eșuat')
        const buffer = await fileRes.arrayBuffer()
        if (buffer.byteLength > MAX_PREVIEW_SIZE) {
          throw new Error('Fișierul e prea mare pentru previzualizare. Folosește descărcarea.')
        }

        const ext = getExtension(name)
        if (ext === 'docx') {
          const { renderAsync } = await import('docx-preview')
          setStatus('ready')
          // containerul există abia după render — așteptăm un frame
          await new Promise(requestAnimationFrame)
          if (!docxContainerRef.current) throw new Error('Containerul de randare lipsește')
          await renderAsync(buffer, docxContainerRef.current, undefined, {
            ignoreLastRenderedPageBreak: false,
          })
        } else if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
          const XLSX = await import('xlsx')
          const workbook = XLSX.read(buffer, { type: 'array' })
          if (!workbook.SheetNames.length) throw new Error('Fișierul nu conține foi de calcul')
          workbookRef.current = workbook
          setSheetNames(workbook.SheetNames)
          setSheetHtml(XLSX.utils.sheet_to_html(workbook.Sheets[workbook.SheetNames[0]]))
          setStatus('ready')
        } else {
          throw new Error(`Formatul .${ext || '?'} nu poate fi previzualizat`)
        }
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Eroare la încărcarea documentului')
        setStatus('error')
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, token, kind, id])

  const switchSheet = async (index: number) => {
    const workbook = workbookRef.current
    if (!workbook) return
    const XLSX = await import('xlsx')
    setActiveSheet(index)
    setSheetHtml(XLSX.utils.sheet_to_html(workbook.Sheets[workbook.SheetNames[index]]))
  }

  const handleDownload = async () => {
    setDownloading(true)
    try {
      const res = await apiFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify({ expiresIn: 300 }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Eroare la descărcare')
      const a = document.createElement('a')
      a.href = data.url
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Eroare la descărcare')
    } finally {
      setDownloading(false)
    }
  }

  const isSpreadsheet = sheetNames.length > 0

  return (
    <div className="min-h-screen flex flex-col bg-slate-100">
      {/* Bară de titlu */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 sm:px-6 py-3 bg-white border-b border-slate-200 shadow-sm sticky top-0 z-10">
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

      {/* Tab-uri foi de calcul */}
      {isSpreadsheet && sheetNames.length > 1 && (
        <div className="flex-shrink-0 flex items-center gap-1 px-4 sm:px-6 py-2 bg-white border-b border-slate-200 overflow-x-auto">
          {sheetNames.map((name, i) => (
            <button
              key={name}
              onClick={() => switchSheet(i)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                i === activeSheet
                  ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                  : 'text-slate-600 hover:bg-slate-100 border border-transparent'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {/* Conținut */}
      <div className="flex-1 overflow-auto">
        {status === 'loading' && (
          <div className="flex flex-col items-center justify-center py-32 gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
            <p className="text-sm text-slate-500">Se încarcă documentul…</p>
          </div>
        )}

        {status === 'error' && (
          <div className="flex flex-col items-center justify-center py-32 px-6 text-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center">
              <AlertCircle className="w-8 h-8 text-amber-600" />
            </div>
            <div>
              <p className="text-base font-bold text-slate-900 mb-1">Previzualizarea nu este disponibilă</p>
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

        {/* Word: docx-preview randează în acest container */}
        <div
          ref={docxContainerRef}
          className={status === 'ready' && !isSpreadsheet ? 'docx-preview-container py-6' : 'hidden'}
        />

        {/* Excel/CSV: tabel generat de SheetJS */}
        {status === 'ready' && isSpreadsheet && (
          <div
            className="sheet-preview p-4 sm:p-6"
            dangerouslySetInnerHTML={{ __html: sheetHtml }}
          />
        )}
      </div>

      <style jsx global>{`
        /* docx-preview: paginile ca foi albe centrate, ca într-un viewer */
        .docx-preview-container .docx-wrapper {
          background: transparent !important;
          padding: 0 16px !important;
        }
        .docx-preview-container .docx-wrapper > section.docx {
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12) !important;
          margin-bottom: 16px !important;
        }
        /* SheetJS: tabelul brut primește aspect de foaie de calcul */
        .sheet-preview table {
          border-collapse: collapse;
          background: #fff;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
          font-size: 13px;
        }
        .sheet-preview td {
          border: 1px solid #e2e8f0;
          padding: 4px 10px;
          white-space: nowrap;
          color: #1e293b;
        }
      `}</style>
    </div>
  )
}
