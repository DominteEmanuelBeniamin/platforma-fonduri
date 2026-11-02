import { NextResponse } from 'next/server'
import { requireProjectAccess, guardToResponse } from './auth'
import { createSupabaseServiceClient } from './supabase'
import { isClientVisibleDocument } from '@/lib/client-visibility'
import { isLatestFileVersion } from '@/lib/document-versions'

// Cine poate citi un fișier încărcat într-o cerere: echipa proiectului, iar
// clientul doar documentele publicate pentru el și doar ultima versiune.
// O singură regulă pentru descărcare și pentru trimiterea pe email.

export type ReadableFileRow = {
  id: string
  requirement_id: string
  version_number: number
  storage_path: string
  original_name: string | null
  mime_type: string | null
  file_size: number | null
  document_requirements:
    | { project_id: string | null; name: string | null; deleted_at: string | null; activity_id: string | null; visibility: string | null; activity?: unknown }
    | Array<{ project_id: string | null; name: string | null; deleted_at: string | null; activity_id: string | null; visibility: string | null; activity?: unknown }>
    | null
}

export type ReadableFile = {
  access: Extract<Awaited<ReturnType<typeof requireProjectAccess>>, { ok: true }>
  file: ReadableFileRow
  fileName: string
  projectId: string
  projectTitle: string
  requirementName: string | null
}

export function fileDisplayName(fileRow: Pick<ReadableFileRow, 'original_name' | 'storage_path'>) {
  const originalName = typeof fileRow.original_name === 'string' ? fileRow.original_name.trim() : ''
  if (originalName) return originalName
  return fileRow.storage_path.split('/').filter(Boolean).pop() || 'fisier'
}

export async function readableFile(request: Request, fileId: string): Promise<{ ok: true; value: ReadableFile } | { ok: false; response: Response }> {
  const admin = createSupabaseServiceClient()
  const { data: fileRow, error } = await admin
    .from('files')
    .select('id, requirement_id, version_number, storage_path, original_name, mime_type, file_size, deleted_at, document_requirements(project_id, name, deleted_at, activity_id, visibility, activity:activity_id(visibility, phase:phase_id(visibility)))')
    .eq('id', fileId)
    .is('deleted_at', null)
    .single()

  if (error || !fileRow) return { ok: false, response: NextResponse.json({ error: 'File not found' }, { status: 404 }) }

  const file = fileRow as ReadableFileRow
  const relation = file.document_requirements
  const requirement = Array.isArray(relation) ? relation[0] : relation
  if (requirement?.deleted_at) return { ok: false, response: NextResponse.json({ error: 'File not found' }, { status: 404 }) }

  const projectId = requirement?.project_id ?? undefined
  if (!projectId) return { ok: false, response: NextResponse.json({ error: 'Invalid file relation' }, { status: 500 }) }

  const access = await requireProjectAccess(request, projectId)
  if (!access.ok) return { ok: false, response: guardToResponse(access) }
  if (access.profile.role === 'client' && !isClientVisibleDocument(requirement)) {
    return { ok: false, response: NextResponse.json({ error: 'File not found' }, { status: 404 }) }
  }

  if (access.profile.role === 'client') {
    // Doar rândul cu versiunea maximă, nu toate rândurile cererii: pe un
    // requirement cu multe fișiere, plafonul de rânduri al PostgREST ar putea
    // tăia tocmai versiunea curentă și i-am refuza clientului propriul document.
    const { data: latestFile, error: versionError } = await admin
      .from('files')
      .select('version_number')
      .eq('requirement_id', file.requirement_id)
      .is('deleted_at', null)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (versionError) {
      console.error('latest file version lookup error:', versionError)
      return { ok: false, response: NextResponse.json({ error: 'Failed to validate file access' }, { status: 500 }) }
    }
    if (!isLatestFileVersion(file, latestFile ? [latestFile] : [])) {
      return { ok: false, response: NextResponse.json({ error: 'File not found' }, { status: 404 }) }
    }
  }

  const { data: projectRow } = await admin
    .from('projects')
    .select('title')
    .eq('id', projectId)
    .maybeSingle()

  return {
    ok: true,
    value: {
      access,
      file,
      fileName: fileDisplayName(file),
      projectId,
      projectTitle: projectRow?.title ?? projectId,
      requirementName: requirement?.name || null,
    },
  }
}
