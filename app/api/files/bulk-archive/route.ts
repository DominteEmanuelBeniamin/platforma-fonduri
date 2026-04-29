import { NextResponse } from 'next/server'
import archiver from 'archiver'
import { PassThrough, Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { z } from 'zod'
import { guardToResponse, requireProjectAccess } from '@/app/api/_utils/auth'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'

const BUCKET = 'project-files'
const SIGNED_URL_EXPIRES_IN = 60 * 10 // 10 minute
const FETCH_TIMEOUT_MS = 60 * 1000

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BulkArchiveSchema = z.object({
  fileIds: z.array(z.string().uuid()).min(1).max(100),
  zipName: z.string().trim().min(1).max(200).optional(),
})

// Supabase returnează document_requirements ca array chiar dacă relația e many-to-one
// când nu există un foreign key explicit definit în schema publică. Dacă vezi că
// la runtime e obiect singular, schimbă în `{ project_id: string | null } | null`
// și înlocuiește flatMap cu map mai jos. Eroarea TypeScript originală confirma array.
type FileProjectRow = {
  id: string
  document_requirements: {
    project_id: string | null
  } | null
}

type FileStorageRow = {
  id: string
  storage_path: string
  original_name: string
}

type ArchivePlanEntry = FileStorageRow & {
  entryName: string
}

type SupabaseAdminClient = ReturnType<typeof createSupabaseServiceClient>

class ArchiveFileError extends Error {
  fileId: string
  fileName: string
  step: 'sign' | 'preflight' | 'fetch' | 'stream'

  constructor(params: {
    fileId: string
    fileName: string
    step: 'sign' | 'preflight' | 'fetch' | 'stream'
    message: string
  }) {
    super(params.message)
    this.name = 'ArchiveFileError'
    this.fileId = params.fileId
    this.fileName = params.fileName
    this.step = params.step
  }
}

function normalizeZipBaseName(name?: string) {
  const trimmed = (name || 'documente').trim()
  const withoutZip = trimmed.replace(/\.zip$/i, '')
  const safe = withoutZip
    .replace(/[^\p{L}\p{N}.\-() ]+/gu, '_')
    .trim()
    .slice(0, 200)
  return safe || 'documente'
}

function getSafeZipFileName(name?: string) {
  return `${normalizeZipBaseName(name)}.zip`
}

function getSafeEntryName(rawName: string, fallback: string, usedNames: Set<string>) {
  const sourceName = rawName || fallback

  const safeName =
    sourceName
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\.\.+/g, '.')
      .trim()
      .slice(0, 200) || fallback

  if (!usedNames.has(safeName)) {
    usedNames.add(safeName)
    return safeName
  }

  const dotIndex = safeName.lastIndexOf('.')
  const hasExt = dotIndex > 0
  const base = hasExt ? safeName.slice(0, dotIndex) : safeName
  const ext = hasExt ? safeName.slice(dotIndex) : ''

  let counter = 2
  let candidate = `${base} (${counter})${ext}`

  while (usedNames.has(candidate)) {
    counter++
    candidate = `${base} (${counter})${ext}`
  }

  usedNames.add(candidate)
  return candidate
}

function buildContentDisposition(filename: string) {
  const asciiFallback = filename.replace(/[^\x20-\x7E]+/g, '_')
  const encoded = encodeURIComponent(filename)
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`
}

function createTimeoutSignal(timeoutMs: number) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  }
}

// Primește admin ca parametru — nu instanțiază client nou la fiecare apel
async function createSignedUrlOrThrow(
  admin: SupabaseAdminClient,
  storagePath: string,
  fileId: string,
  fileName: string,
): Promise<string> {
  const { data, error } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_EXPIRES_IN, { download: false })

  if (error || !data?.signedUrl) {
    throw new ArchiveFileError({
      fileId,
      fileName,
      step: 'sign',
      message: `Failed to create signed URL for "${fileName}"`,
    })
  }

  return data.signedUrl
}

// Preflight cu signed URL propriu — URL-ul generat aici nu e reutilizat la stream,
// deci nu există risc de expirare între cele două faze.
// Notă: folosim HEAD pentru simplitate. Dacă CDN-ul/proxy-ul vostru tratează HEAD
// diferit față de GET (rare, dar posibil), înlocuiți cu GET + Range: bytes=0-0.
async function preflightFileOrThrow(
  admin: SupabaseAdminClient,
  file: FileStorageRow,
  fileName: string,
): Promise<void> {
  const signedUrl = await createSignedUrlOrThrow(admin, file.storage_path, file.id, fileName)

  const { signal, clear } = createTimeoutSignal(FETCH_TIMEOUT_MS)

  try {
    const res = await fetch(signedUrl, { method: 'HEAD', signal })

    if (!res.ok) {
      throw new ArchiveFileError({
        fileId: file.id,
        fileName,
        step: 'preflight',
        message: `Preflight failed for "${fileName}" with status ${res.status}`,
      })
    }
  } catch (error) {
    if (error instanceof ArchiveFileError) throw error

    throw new ArchiveFileError({
      fileId: file.id,
      fileName,
      step: 'preflight',
      message: `Preflight request failed for "${fileName}"`,
    })
  } finally {
    clear()
  }
}

// Generează un signed URL fresh chiar înainte de stream — independent de cel din preflight.
// Asta elimină riscul de expirare între faza de preflight și faza de streaming,
// cu costul unui request suplimentar la Supabase Storage (acceptabil vs. robustețe).
async function streamFileIntoArchiveOrThrow(params: {
  admin: SupabaseAdminClient
  file: FileStorageRow
  fileName: string
  archive: archiver.Archiver
}): Promise<void> {
  const { admin, file, fileName, archive } = params

  const signedUrl = await createSignedUrlOrThrow(admin, file.storage_path, file.id, fileName)

  const { signal, clear } = createTimeoutSignal(FETCH_TIMEOUT_MS)

  try {
    const res = await fetch(signedUrl, { signal })

    if (!res.ok || !res.body) {
      throw new ArchiveFileError({
        fileId: file.id,
        fileName,
        step: 'fetch',
        message: `Failed to fetch "${fileName}" with status ${res.status}`,
      })
    }

    const entryStream = new PassThrough()
    archive.append(entryStream, { name: fileName })

    // res.body e ReadableStream<Uint8Array> din Web Streams API.
    // Readable.fromWeb din Node.js are o signatură incompatibilă structural
    // în @types/node — cast prin unknown rezolvă fără a pierde siguranța reală.
    const nodeReadable = Readable.fromWeb(
      res.body as unknown as Parameters<typeof Readable.fromWeb>[0],
    )

    await pipeline(nodeReadable, entryStream)
  } catch (error) {
    if (error instanceof ArchiveFileError) throw error

    throw new ArchiveFileError({
      fileId: file.id,
      fileName,
      step: 'stream',
      message: `Failed while streaming "${fileName}" into archive`,
    })
  } finally {
    clear()
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)

    const parsed = BulkArchiveSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid body', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const fileIds = Array.from(new Set(parsed.data.fileIds))
    const zipFileName = getSafeZipFileName(parsed.data.zipName)

    const admin = createSupabaseServiceClient()

    /**
     * 1) Query minim: existența fișierelor + project_id pentru auth
     */
    const { data: fileProjectRows, error: projectLookupError } = await admin
      .from('files')
      .select('id, document_requirements!inner(project_id)')
      .in('id', fileIds)
     
      
    if (projectLookupError) {
      console.error('bulk-archive: failed to resolve project ids', {
        error: projectLookupError,
        fileIds,
      })
      return NextResponse.json({ error: 'Failed to load files' }, { status: 500 })
    }

    if (!fileProjectRows || fileProjectRows.length === 0) {
      return NextResponse.json({ error: 'No files found' }, { status: 404 })
    }

    const typedProjectRows = fileProjectRows as unknown as FileProjectRow[]

    const foundIds = new Set(typedProjectRows.map(file => file.id))
    const missing = fileIds.filter(id => !foundIds.has(id))

    if (missing.length > 0) {
      return NextResponse.json(
        { error: 'Some files were not found', missing },
        { status: 400 },
      )
    }

    const projectIds = new Set(
      typedProjectRows
        .map(file => file.document_requirements?.project_id ?? null)
        .filter((id): id is string => Boolean(id)),
    )

    if (projectIds.size !== 1) {
      return NextResponse.json(
        { error: 'All files must belong to the same project' },
        { status: 400 },
      )
    }

    const projectId = Array.from(projectIds)[0]

    if (!projectId) {
      return NextResponse.json({ error: 'Invalid file relation' }, { status: 500 })
    }

    /**
     * 2) Auth check imediat după ce avem projectId
     */
    const access = await requireProjectAccess(request, projectId)
    if (!access.ok) {
      return guardToResponse(access)
    }

    /**
     * 3) Încărcăm storage_path-urile doar după auth
     */
    const { data: fileStorageRows, error: storageLookupError } = await admin
      .from('files')
      .select('id, storage_path, original_name')
      .in('id', fileIds)

    if (storageLookupError) {
      console.error('bulk-archive: failed to load file storage paths', {
        error: storageLookupError,
        fileIds,
      })
      return NextResponse.json({ error: 'Failed to load files' }, { status: 500 })
    }

    if (!fileStorageRows || fileStorageRows.length !== fileIds.length) {
      return NextResponse.json(
        { error: 'Some files could not be loaded' },
        { status: 400 },
      )
    }

    const filesById = new Map(
      (fileStorageRows as FileStorageRow[]).map(file => [file.id, file]),
    )

    const orderedFiles = fileIds
      .map(id => filesById.get(id))
      .filter((file): file is FileStorageRow => Boolean(file))

    /**
     * 4) Calculăm entryName-urile upfront (fără signed URLs).
     *    Signed URL-urile sunt generate lazy — câte unul fresh la preflight
     *    și câte unul fresh la stream — eliminând riscul de expirare.
     */
    const usedNames = new Set<string>()
    const archivePlan: ArchivePlanEntry[] = orderedFiles.map(file => ({
      ...file,
      entryName: getSafeEntryName(file.original_name, file.id, usedNames),
    }))

    /**
     * 5) Preflight complet înainte să începem streaming-ul.
     *    Fiecare fișier primește propriul signed URL fresh.
     *    Dacă un fișier nu e accesibil, returnăm JSON clar — nu un ZIP corupt.
     */
    for (const entry of archivePlan) {
      await preflightFileOrThrow(admin, entry, entry.entryName)
    }

    /**
     * 6) Streaming ZIP.
     *    Fiecare fișier primește un nou signed URL generat chiar înainte de fetch,
     *    deci nu există risc de expirare din faza de preflight.
     */
    const archive = archiver('zip', { zlib: { level: 9 } })
    const output = new PassThrough()

    archive.on('warning', warning => {
      console.warn('bulk-archive warning:', warning)
    })

    archive.on('error', error => {
      console.error('bulk-archive error:', error)
      if (!output.destroyed) {
        output.destroy(error)
      }
    })

    output.on('error', error => {
      console.error('bulk-archive output error:', error)
      archive.abort()
    })

    archive.pipe(output)

    const buildArchivePromise = (async () => {
      for (const entry of archivePlan) {
        await streamFileIntoArchiveOrThrow({
          admin,
          file: entry,
          fileName: entry.entryName,
          archive,
        })
      }
      await archive.finalize()
    })()

    buildArchivePromise.catch(error => {
      console.error('bulk-archive: failed while building archive', error)
      if (!output.destroyed) {
        output.destroy(error as Error)
      }
    })

    return new Response(Readable.toWeb(output) as ReadableStream, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': buildContentDisposition(zipFileName),
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('POST bulk-archive error:', error)

    if (error instanceof ArchiveFileError) {
      return NextResponse.json(
        {
          error: 'Failed to generate archive',
          fileId: error.fileId,
          fileName: error.fileName,
          step: error.step,
          message: error.message,
        },
        { status: 500 },
      )
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Server error' },
      { status: 500 },
    )
  }
}
