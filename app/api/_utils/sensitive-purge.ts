/* eslint-disable @typescript-eslint/no-explicit-any */
// Ștergerea automată a fișierelor din cererile cu date sensibile (copii de
// buletin, caziere). O cheamă zilnic `/api/cron/date-sensibile`.
//
// Până la `SENSITIVE_PURGE_ENABLED=true` jobul doar raportează ce ar șterge:
// termenele trebuie confirmate întâi de avocat. Ordinea unei ștergeri e
// storage, apoi bază: dacă se oprește între ele, următoarea rulare o reia,
// iar ștergerea din storage e idempotentă.

import type { SupabaseClient } from '@supabase/supabase-js'
import { logAction } from './audit'
import { isSensitiveKind, isSensitivePurgeDue, sensitivePurgeAt, SENSITIVE_LABELS, type SensitiveKind } from '@/lib/sensitive-documents'

const BUCKET = 'project-files'
const PAGE_SIZE = 1000
const REMOVE_BATCH = 1000
const REVIEW_CHUNK = 200
// Calea pusă de `purge_sensitive_request_metadata` în locul celei vechi.
const PURGED_PATH_PREFIX = 'sters-automat/'

export type SensitivePurgeItem = {
  requestId: string
  projectId: string | null
  kind: string
  purgeAt: string | null
  files: number
  purged: boolean
  error?: string
}

export type SensitivePurgeReport = {
  mode: 'simulare' | 'stergere'
  checked: number
  due: number
  purged: number
  failed: number
  items: SensitivePurgeItem[]
}

export function sensitivePurgeEnabled() {
  return process.env.SENSITIVE_PURGE_ENABLED?.trim().toLowerCase() === 'true'
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error && typeof (error as any).message === 'string') {
    return (error as any).message as string
  }
  return 'Eroare necunoscută'
}

async function loadCandidates(admin: SupabaseClient) {
  const rows: any[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from('document_requirements')
      .select('id, project_id, name, status, sensitive_kind, sensitive_hold_until, project:project_id(title, closed_at)')
      .not('sensitive_kind', 'is', null)
      .is('sensitive_purged_at', null)
      .order('id')
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE_SIZE) return rows
  }
}

/** Ultima aprobare a fiecărui cazier aprobat: de la ea curge termenul de 90 de zile. */
async function loadLatestApprovals(admin: SupabaseClient, requestIds: string[]) {
  const approvals = new Map<string, string>()
  for (let i = 0; i < requestIds.length; i += REVIEW_CHUNK) {
    const { data, error } = await admin
      .from('document_request_reviews')
      .select('requirement_id, reviewed_at')
      .in('requirement_id', requestIds.slice(i, i + REVIEW_CHUNK))
      .eq('action', 'approved')
      .order('reviewed_at', { ascending: false })
    if (error) throw error
    for (const row of data ?? []) {
      if (!approvals.has(row.requirement_id)) approvals.set(row.requirement_id, row.reviewed_at)
    }
  }
  return approvals
}

export async function runSensitivePurge(
  admin: SupabaseClient,
  options: { now: Date; enabled: boolean },
): Promise<SensitivePurgeReport> {
  const candidates = await loadCandidates(admin)
  const approvals = await loadLatestApprovals(
    admin,
    candidates.filter(row => row.sensitive_kind === 'cazier' && row.status === 'approved').map(row => row.id),
  )

  const report: SensitivePurgeReport = {
    mode: options.enabled ? 'stergere' : 'simulare',
    checked: candidates.length,
    due: 0,
    purged: 0,
    failed: 0,
    items: [],
  }

  for (const row of candidates) {
    if (!isSensitiveKind(row.sensitive_kind)) continue
    const kind: SensitiveKind = row.sensitive_kind
    const project = Array.isArray(row.project) ? row.project[0] : row.project
    const input = {
      kind,
      status: row.status,
      approvedAt: approvals.get(row.id) ?? null,
      projectClosedAt: project?.closed_at ?? null,
      holdUntil: row.sensitive_hold_until,
    }
    if (!isSensitivePurgeDue(input, options.now.getTime())) continue
    report.due += 1

    const item: SensitivePurgeItem = {
      requestId: row.id,
      projectId: row.project_id ?? null,
      kind,
      purgeAt: sensitivePurgeAt(input),
      files: 0,
      purged: false,
    }

    try {
      // Toate versiunile, inclusiv cele șterse din interfață: obiectul lor
      // e încă în storage.
      const { data: files, error: filesError } = await admin
        .from('files')
        .select('id, storage_path')
        .eq('requirement_id', row.id)
      if (filesError) throw filesError
      const paths = [...new Set((files ?? [])
        .map((file: any) => file.storage_path)
        .filter((path: unknown): path is string => typeof path === 'string' && path.length > 0 && !path.startsWith(PURGED_PATH_PREFIX)))]
      item.files = paths.length

      if (options.enabled) {
        for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
          const { error: removeError } = await admin.storage.from(BUCKET).remove(paths.slice(i, i + REMOVE_BATCH))
          if (removeError) throw removeError
        }
        const { error: purgeError } = await admin.rpc('purge_sensitive_request_metadata', {
          p_requirement_id: row.id,
          p_purged_at: options.now.toISOString(),
        })
        if (purgeError) throw purgeError
        item.purged = true
        report.purged += 1

        await logAction({
          actorId: null,
          actionType: 'purge',
          entityType: 'document_request',
          entityId: row.id,
          entityName: row.name,
          newValues: {
            sensitive_kind: kind,
            project_id: row.project_id ?? null,
            project_title: project?.title ?? null,
            purge_at: item.purgeAt,
            files_removed: paths.length,
          },
          description: `Ștergere automată: ${paths.length === 1 ? 'fișierul' : `cele ${paths.length} fișiere ale`} documentului "${row.name}" (${SENSITIVE_LABELS[kind]}) din proiectul "${project?.title ?? row.project_id}", la termenul pentru date sensibile`,
          ipAddress: 'cron',
          userAgent: 'vercel-cron',
        })
      }
    } catch (error) {
      item.error = errorMessage(error)
      report.failed += 1
    }
    report.items.push(item)
  }

  return report
}
