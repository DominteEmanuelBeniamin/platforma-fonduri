import { NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'
import { firstClaimedUploadBatch, isRetentionPolicyEnabled } from '@/lib/data-retention'
import {
  DATA_RETENTION_BATCH_SIZE,
  DATA_RETENTION_DUE_JOB_LIMIT,
  acquireDataRetentionLease,
  expectedUploadStoragePaths,
  isMissingStorageObjectError,
  releaseDataRetentionLease,
  retentionHoursToMilliseconds,
  uploadBatchStoragePrefix,
  type RetentionPolicyRow,
  type UploadBatchRow,
} from '@/app/api/_utils/data-retention'

const UPLOAD_BUCKET = 'project-files'

type CronReport = {
  ok: boolean
  run_id: string
  dry_run: boolean
  skipped: boolean
  due_jobs_inspected: number
  orphan_batches_inspected: number
  orphan_batches_deleted: number
  storage_objects_removed: number
  failures: number
  failure_codes: string[]
  error?: string
}

function emptyReport(runId: string, dryRun: boolean): CronReport {
  return {
    ok: true,
    run_id: runId,
    dry_run: dryRun,
    skipped: false,
    due_jobs_inspected: 0,
    orphan_batches_inspected: 0,
    orphan_batches_deleted: 0,
    storage_objects_removed: 0,
    failures: 0,
    failure_codes: [],
  }
}

function logFailure(runId: string, code: string, batchId?: string) {
  console.error('data retention failure', {
    run_id: runId,
    code,
    ...(batchId ? { batch_id: batchId } : {}),
  })
}

async function inspectDueJobs(
  admin: ReturnType<typeof createSupabaseServiceClient>,
  report: CronReport,
) {
  const { data, error } = await admin
    .from('data_deletion_jobs')
    .select('id')
    .eq('status', 'queued')
    .lte('execute_after', new Date().toISOString())
    .order('execute_after', { ascending: true })
    .limit(DATA_RETENTION_DUE_JOB_LIMIT)
  if (error) throw error
  report.due_jobs_inspected = data?.length ?? 0
}

async function loadOrphanBatches(
  admin: ReturnType<typeof createSupabaseServiceClient>,
  cutoff: string,
) {
  const { data, error } = await admin
    .from('document_upload_batches')
    .select('id, requirement_id, uploaded_by, expected_files, created_at')
    .is('completed_at', null)
    .is('version_number', null)
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(DATA_RETENTION_BATCH_SIZE)
  if (error) throw error
  return (data ?? []) as UploadBatchRow[]
}

async function restoreIncompleteBatch(
  admin: ReturnType<typeof createSupabaseServiceClient>,
  batch: UploadBatchRow,
) {
  try {
    const { error } = await admin
      .from('document_upload_batches')
      .insert({
        id: batch.id,
        requirement_id: batch.requirement_id,
        uploaded_by: batch.uploaded_by,
        expected_files: batch.expected_files,
        created_at: batch.created_at,
        completed_file_ids: null,
        version_number: null,
        completed_at: null,
      })
    return !error
  } catch {
    return false
  }
}

async function cleanOrphanBatches(
  admin: ReturnType<typeof createSupabaseServiceClient>,
  batches: UploadBatchRow[],
  report: CronReport,
  runId: string,
) {
  if (batches.length === 0) return

  const requirementIds = [...new Set(batches.map(batch => batch.requirement_id))]
  const { data: requirements, error: requirementError } = await admin
    .from('document_requirements')
    .select('id, project_id')
    .in('id', requirementIds)
  if (requirementError) throw requirementError

  const projectByRequirement = new Map(
    (requirements ?? []).map((row: { id: string; project_id: string }) => [row.id, row.project_id]),
  )

  for (const batch of batches) {
    report.orphan_batches_inspected++
    const projectId = projectByRequirement.get(batch.requirement_id)
    const prefix = projectId
      ? uploadBatchStoragePrefix(projectId, batch.requirement_id, batch.id)
      : null
    const expectedPaths = prefix
      ? expectedUploadStoragePaths(batch.expected_files, prefix)
      : null
    if (!expectedPaths) {
      report.failures++
      logFailure(runId, 'invalid_upload_batch', batch.id)
      continue
    }

    const { data: liveFiles, error: fileError } = await admin
      .from('files')
      .select('storage_path')
      .in('storage_path', expectedPaths)
      .is('deleted_at', null)
    if (fileError) {
      report.failures++
      logFailure(runId, 'live_file_lookup_failed', batch.id)
      continue
    }

    const livePaths = new Set((liveFiles ?? []).map((row: { storage_path: string }) => row.storage_path))
    const { data: claimedRows, error: claimError } = await admin
      .from('document_upload_batches')
      .delete()
      .eq('id', batch.id)
      .is('completed_at', null)
      .is('version_number', null)
      .select('id, requirement_id, uploaded_by, expected_files, created_at')
    if (claimError) {
      report.failures++
      report.failure_codes.push('batch_claim_failed')
      logFailure(runId, 'batch_claim_failed', batch.id)
      continue
    }

    const claimedBatch = firstClaimedUploadBatch(claimedRows as UploadBatchRow[])
    if (!claimedBatch) continue

    const claimedPrefix = uploadBatchStoragePrefix(projectId!, claimedBatch.requirement_id, claimedBatch.id)
    const claimedPaths = expectedUploadStoragePaths(claimedBatch.expected_files, claimedPrefix)
    if (!claimedPaths) {
      report.failures++
      report.failure_codes.push('claimed_batch_invalid')
      logFailure(runId, 'claimed_batch_invalid', batch.id)
      if (!await restoreIncompleteBatch(admin, claimedBatch)) {
        report.failures++
        report.failure_codes.push('batch_restore_failed')
        logFailure(runId, 'batch_restore_failed', batch.id)
      }
      continue
    }

    const removablePaths = claimedPaths.filter(path => !livePaths.has(path))
    if (removablePaths.length > 0) {
      let storageError: { message?: string | null } | null = null
      try {
        const result = await admin.storage.from(UPLOAD_BUCKET).remove(removablePaths)
        storageError = result.error
      } catch {
        storageError = { message: 'storage removal exception' }
      }
      if (storageError && !isMissingStorageObjectError(storageError.message)) {
        report.failures++
        report.failure_codes.push('storage_remove_failed')
        logFailure(runId, 'storage_remove_failed', batch.id)
        if (!await restoreIncompleteBatch(admin, claimedBatch)) {
          report.failures++
          report.failure_codes.push('batch_restore_failed')
          logFailure(runId, 'batch_restore_failed', batch.id)
        }
        continue
      }
      report.storage_objects_removed += removablePaths.length
    }

    report.orphan_batches_deleted++
  }
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runId = crypto.randomUUID()
  const dryRun = process.env.DATA_RETENTION_DRY_RUN !== 'false'
  const report = emptyReport(runId, dryRun)
  let admin: ReturnType<typeof createSupabaseServiceClient>

  try {
    admin = createSupabaseServiceClient()
    const lease = await acquireDataRetentionLease(admin, runId)
    if (lease.error) throw lease.error
    if (!lease.acquired) {
      report.skipped = true
      return NextResponse.json(report)
    }

    try {
      await inspectDueJobs(admin, report)
      const { data: policy, error: policyError } = await admin
        .from('retention_policies')
        .select('policy_key, enabled, retention_hours')
        .eq('policy_key', 'orphan_upload')
        .maybeSingle()
      if (policyError) throw policyError

      const retentionMs = retentionHoursToMilliseconds((policy as RetentionPolicyRow | null)?.retention_hours)
      if (!isRetentionPolicyEnabled(policy as RetentionPolicyRow | null) || retentionMs === null) {
        report.skipped = true
      } else {
        const cutoff = new Date(Date.now() - retentionMs).toISOString()
        const batches = await loadOrphanBatches(admin, cutoff)
        if (!dryRun) await cleanOrphanBatches(admin, batches, report, runId)
        else report.orphan_batches_inspected = batches.length
      }
    } finally {
      const release = await releaseDataRetentionLease(admin, runId)
      if (release.error || !release.released) {
        report.failures++
        report.ok = false
        logFailure(runId, 'lease_release_failed')
      }
    }
  } catch {
    report.ok = false
    report.error = 'Rularea retenției datelor a eșuat.'
    logFailure(runId, 'run_failed')
  }

  return NextResponse.json(report, { status: report.ok ? 200 : 500 })
}
