type DownloadFilesArchiveParams = {
    fileIds: string[]
    apiFetch: (input: RequestInfo, init?: RequestInit) => Promise<Response>
    zipName?: string
  }
  
  type ArchiveErrorResponse = {
    error?: string
    message?: string
    fileId?: string
    fileName?: string
    step?: 'sign' | 'preflight' | 'fetch' | 'stream'
  }
  
  function getFilenameFromContentDisposition(header: string | null) {
    if (!header) return 'documente.zip'
  
    const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i)
    if (utf8Match?.[1]) {
      return decodeURIComponent(utf8Match[1])
    }
  
    const asciiMatch = header.match(/filename="([^"]+)"/i)
    if (asciiMatch?.[1]) {
      return asciiMatch[1]
    }
  
    return 'documente.zip'
  }
  
  function triggerBrowserDownload(blob: Blob, filename: string) {
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
  
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  
    window.URL.revokeObjectURL(url)
  }
  
  export async function downloadFilesArchive({
    fileIds,
    apiFetch,
    zipName,
  }: DownloadFilesArchiveParams) {
    if (!fileIds.length) {
      throw new Error('Nu există fișiere selectate.')
    }
  
    const response = await apiFetch('/api/files/bulk-archive', {
      method: 'POST',
      body: JSON.stringify({
        fileIds,
        zipName,
      }),
    })
  
    const contentType = response.headers.get('content-type') || ''
  
    if (!response.ok) {
      if (contentType.includes('application/json')) {
        const errorData = (await response.json().catch(() => null)) as ArchiveErrorResponse | null
  
        const baseMessage = errorData?.message || errorData?.error || 'Arhiva nu a putut fi generată.'
  
        if (errorData?.fileName) {
          throw new Error(`${baseMessage} Fișier: ${errorData.fileName}`)
        }
  
        throw new Error(baseMessage)
      }
  
      throw new Error('Arhiva nu a putut fi generată.')
    }
  
    if (!contentType.includes('application/zip')) {
      throw new Error('Răspuns invalid de la server.')
    }
  
    const blob = await response.blob()
    const filename = getFilenameFromContentDisposition(
      response.headers.get('content-disposition')
    )
  
    triggerBrowserDownload(blob, filename)
  }