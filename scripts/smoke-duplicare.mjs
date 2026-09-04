// Smoke pentru duplicarea fazelor și activităților (#89).
//
// Rulează numai cu configurația E2E dedicată și E2E_WRITES=1. Proiectul este
// creat de fixture la fiecare rulare; nu există ID-uri reale sau fallback la
// `.env.local`. Node este pornit cu --experimental-strip-types pentru helperul
// TypeScript comun (a se actualiza scriptul package de către orchestrator).

import { createClient } from '@supabase/supabase-js'
import {
  cleanupCreated,
  createCreatedRegistry,
  createTemporaryProject,
  destroyTemporaryProject,
  e2eEnv,
  protectSourceStoragePath,
  registerCreatedActivity,
  registerCreatedPhase,
  requireE2EConfig,
  serviceClient,
  storagePathsForPhase,
  verifyServerUsesFixture,
} from '../tests/e2e/helpers/project-state.ts'

const config = requireE2EConfig(e2eEnv())
const admin = serviceClient()
if (!admin) throw new Error('Clientul service E2E lipsește din configurația dedicată')

const results = []
const check = (label, ok, detail = '') => {
  results.push({ ok, label })
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ' — ' + detail : ''}`)
}
const readOne = async (query, label) => {
  const result = await query
  if (result.error) throw new Error(`${label}: ${result.error.message || result.error}`)
  if (!result.data) throw new Error(`${label}: rând lipsă`)
  return result.data
}
const readMany = async (query, label) => {
  const result = await query
  if (result.error) throw new Error(`${label}: ${result.error.message || result.error}`)
  return result.data ?? []
}

let fixture = null
let copies = null
let staffToken = ''
let clientToken = ''

async function signIn() {
  const anon = createClient(config.supabaseUrl, config.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const staff = await anon.auth.signInWithPassword({ email: config.staffEmail, password: config.staffPassword })
  if (staff.error || !staff.data.session) throw staff.error || new Error('autentificarea staff a eșuat')
  staffToken = staff.data.session.access_token
  const client = await anon.auth.signInWithPassword({ email: config.clientEmail, password: config.clientPassword })
  if (client.error || !client.data.session) throw client.error || new Error('autentificarea client a eșuat')
  clientToken = client.data.session.access_token
}

async function api(path, options = {}) {
  return fetch(`${config.baseUrl}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${staffToken}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
}

async function cleanupAll() {
  const failures = []
  try {
    if (admin && copies) await cleanupCreated(admin, copies)
  } catch (error) {
    failures.push(error)
  } finally {
    try {
      if (admin && fixture) await destroyTemporaryProject(admin, fixture)
    } catch (error) {
      failures.push(error)
    } finally {
      copies = null
      fixture = null
    }
  }
  if (failures.length) {
    throw new Error(failures.map(error => error instanceof Error ? error.message : String(error)).join('\n'))
  }
}

try {
  await signIn()
  fixture = await createTemporaryProject(admin, config)
  await verifyServerUsesFixture(config, fixture.projectId)
  copies = createCreatedRegistry(fixture.projectId)
  const sourcePaths = await storagePathsForPhase(admin, fixture.phaseId)
  for (const path of sourcePaths) protectSourceStoragePath(copies, path)

  const sourcePhase = await readOne(admin.from('project_phases').select('*').eq('id', fixture.phaseId).single(), 'citirea fazei fixture')
  const sourceActivity = await readOne(admin.from('project_activities').select('*').eq('id', fixture.activityId).single(), 'citirea activității fixture')
  const sourceRequests = await readMany(admin.from('document_requirements').select('*').eq('activity_id', fixture.activityId).is('deleted_at', null), 'citirea cererilor fixture')

  const phaseResponse = await api(`/api/projects/${fixture.projectId}/phases/${fixture.phaseId}/duplicate`, { method: 'POST' })
  const phaseBody = await phaseResponse.json()
  registerCreatedPhase(copies, phaseBody.phase?.id)
  check('POST duplicate fază → 201', phaseResponse.status === 201, `status ${phaseResponse.status}`)
  if (!phaseResponse.ok) throw new Error(JSON.stringify(phaseBody))
  const phaseCopy = phaseBody.phase
  check('copia fazei este draft și apare după original', phaseCopy.visibility === 'draft' && phaseCopy.order_index === sourcePhase.order_index + 1)

  const copyActivities = await readMany(admin.from('project_activities').select('*').eq('phase_id', phaseCopy.id).order('order_index'), 'citirea activităților copii')
  check('activitatea s-a copiat cu termen și responsabil', copyActivities.length === 1 && copyActivities[0].deadline_at === sourceActivity.deadline_at && copyActivities[0].assigned_to === sourceActivity.assigned_to)
  const copyRequests = await readMany(admin.from('document_requirements').select('*').in('activity_id', copyActivities.map(item => item.id)).is('deleted_at', null), 'citirea cererilor copii')
  check('cererile s-au copiat', copyRequests.length === sourceRequests.length)
  check('fișierele clientului nu s-au copiat', (await readMany(admin.from('files').select('id').in('requirement_id', copyRequests.map(item => item.id)), 'verificarea fișierelor client')).length === 0)
  const copyAttachments = await readMany(admin.from('document_requirement_attachments').select('storage_path').in('document_requirement_id', copyRequests.map(item => item.id)), 'verificarea modelelor copii')
  check('modelul are obiect storage propriu', copyAttachments.length === 1 && !sourcePaths.includes(copyAttachments[0].storage_path))

  const activityResponse = await api(`/api/projects/${fixture.projectId}/phases/${fixture.phaseId}/activities/${fixture.activityId}/duplicate`, { method: 'POST' })
  const activityBody = await activityResponse.json()
  registerCreatedActivity(copies, activityBody.activity?.id, fixture.phaseId)
  check('POST duplicate activitate → 201', activityResponse.status === 201, `status ${activityResponse.status}`)
  if (!activityResponse.ok) throw new Error(JSON.stringify(activityBody))
  const directRequests = await readMany(admin.from('document_requirements').select('id').eq('activity_id', activityBody.activity.id).is('deleted_at', null), 'citirea cererilor activității copii')
  check('activitatea duplicată are cererile sursei', directRequests.length === sourceRequests.length)

  const forbidden = await fetch(`${config.baseUrl}/api/projects/${fixture.projectId}/phases/${fixture.phaseId}/duplicate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${clientToken}`, 'Content-Type': 'application/json' },
  })
  check('clientul este respins', forbidden.status === 403 || forbidden.status === 404, `status ${forbidden.status}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  results.push({ ok: false, label: 'execuția smoke' })
} finally {
  try {
    await cleanupAll()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    results.push({ ok: false, label: 'cleanup smoke' })
  }
  const failed = results.filter(result => !result.ok)
  console.log(`\n${results.length - failed.length}/${results.length} verificări trecute`)
  if (failed.length) {
    console.log('EȘUATE:', failed.map(result => result.label).join(' | '))
    process.exitCode = 1
  }
}
