// Smoke pentru duplicarea fazelor și activităților (#15).
//
// Rulează peste dev server-ul pornit separat (`npm run dev`) și peste datele
// reale: duplică o fază și o activitate prin API, verifică rezultatul în baza
// de date, apoi șterge tot ce a creat și pune ordinea la loc. Proiectul rămâne
// exact cum era înainte.
//
//   node scripts/smoke-duplicare.mjs [phase_id]

import nextEnv from '@next/env'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const { loadEnvConfig } = nextEnv
loadEnvConfig(process.cwd())

// conturile de test stau separat, în .env.e2e.local
for (const line of readFileSync('.env.e2e.local', 'utf-8').split('\n')) {
  const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/)
  if (match) process.env[match[1]] ??= match[2].trim()
}

const BASE = process.env.SMOKE_BASE_URL || 'http://localhost:3000'
const PHASE_ID = process.argv[2] || '0aa6b64b-d81b-4ab1-bb6f-b2789f38c5c8'

const admin = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
)
const anon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

const results = []
const check = (label, ok, detail = '') => {
  results.push({ ok, label })
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ' — ' + detail : ''}`)
}

const { data: session, error: signInError } = await anon.auth.signInWithPassword({
  email: process.env.E2E_STAFF_EMAIL,
  password: process.env.E2E_STAFF_PASSWORD,
})
if (signInError) throw signInError
const token = session.session.access_token
const api = (path, options = {}) => fetch(`${BASE}${path}`, {
  ...options,
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
})

// ── Starea dinainte ──────────────────────────────────────────────────────────
const { data: phase } = await admin.from('project_phases').select('*').eq('id', PHASE_ID).maybeSingle()
if (!phase) {
  console.error(`Faza ${PHASE_ID} nu există. Dă alt id ca argument.`)
  process.exit(1)
}
const projectId = phase.project_id
const { data: phasesBefore } = await admin.from('project_phases').select('id, order_index').eq('project_id', projectId).order('order_index')
const { data: actsBefore } = await admin.from('project_activities').select('*').eq('phase_id', PHASE_ID).order('order_index')
const { data: reqsBefore } = await admin.from('document_requirements').select('*').in('activity_id', actsBefore.map(a => a.id)).is('deleted_at', null)
const { data: filesBefore } = await admin.from('files').select('id').in('requirement_id', reqsBefore.map(r => r.id))
const { data: attsBefore } = await admin.from('document_requirement_attachments').select('*').in('document_requirement_id', reqsBefore.map(r => r.id))
const sourceActivity = actsBefore[0]

console.log(`Faza test: „${phase.name}” — ${actsBefore.length} activități, ${reqsBefore.length} cereri, ${attsBefore.length} fișiere-model, ${filesBefore.length} fișiere de client\n`)

const created = { phases: [], activities: [], requests: [], storagePaths: [] }
const BUCKET = 'project-files'

async function storageObjectExists(path) {
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, 60)
  if (error || !data?.signedUrl) return false
  const res = await fetch(data.signedUrl, { method: 'HEAD' }).catch(() => null)
  return Boolean(res?.ok)
}

try {
  // ── Duplicare fază ─────────────────────────────────────────────────────────
  const phaseRes = await api(`/api/projects/${projectId}/phases/${PHASE_ID}/duplicate`, { method: 'POST' })
  const phaseBody = await phaseRes.json()
  check('POST duplicate fază → 201', phaseRes.status === 201, `status ${phaseRes.status}`)
  if (!phaseRes.ok) throw new Error(JSON.stringify(phaseBody))

  const copy = phaseBody.phase
  created.phases.push(copy.id)

  check('nume „(copie)”', copy.name === `${phase.name} (copie)`, copy.name)
  check('copia e în pregătire (draft)', copy.visibility === 'draft', `sursa era ${phase.visibility}`)
  check('status resetat la pending', copy.status === 'pending')
  check('fără legătură la șablon', copy.source_template_phase_id === null)
  check('clientul nu a fost notificat', copy.client_notified_at === null)
  check('aterizează imediat după original', copy.order_index === phase.order_index + 1)

  const { data: phasesAfter } = await admin.from('project_phases').select('id, order_index').eq('project_id', projectId).order('order_index')
  check('fazele de după s-au decalat cu o poziție',
    phasesBefore.filter(p => p.order_index > phase.order_index)
      .every(p => phasesAfter.find(x => x.id === p.id)?.order_index === p.order_index + 1))
  check('nicio poziție dublată', new Set(phasesAfter.map(p => p.order_index)).size === phasesAfter.length)

  const { data: copyActs } = await admin.from('project_activities').select('*').eq('phase_id', copy.id).order('order_index')
  created.activities.push(...copyActs.map(a => a.id))
  check('activitățile s-au copiat', copyActs.length === actsBefore.length, `${copyActs.length}/${actsBefore.length}`)
  check('activitățile păstrează numele originale', copyActs.every((a, i) => a.name === actsBefore[i].name))
  check('activitățile copiate sunt draft', copyActs.every(a => a.visibility === 'draft'))
  check('termenele activităților se copiază (#70 cere termen la publicare)',
    copyActs.every((a, i) => a.deadline_at === actsBefore[i].deadline_at),
    `sursa: ${actsBefore.map(a => a.deadline_at ?? 'gol').join(', ')} | copia: ${copyActs.map(a => a.deadline_at ?? 'gol').join(', ')}`)
  check('atribuirea păstrată', copyActs.every((a, i) => a.assigned_to === actsBefore[i].assigned_to))
  check('status activități resetat', copyActs.every(a => a.status === 'pending' && a.completed_at === null))

  const { data: copyReqs } = await admin.from('document_requirements').select('*').in('activity_id', copyActs.map(a => a.id)).is('deleted_at', null)
  created.requests.push(...copyReqs.map(r => r.id))
  check('cererile de documente s-au copiat', copyReqs.length === reqsBefore.length, `${copyReqs.length}/${reqsBefore.length}`)
  check('cererile copiate sunt draft', copyReqs.every(r => r.visibility === 'draft'))
  const deadlineSet = list => list.map(r => `${r.name}|${r.deadline_at ?? 'gol'}`).sort().join(' // ')
  check('termenele cererilor se copiază', deadlineSet(copyReqs) === deadlineSet(reqsBefore))
  check('cererile nu sunt blocate și n-au reminder trimis', copyReqs.every(r => !r.is_locked && r.reminder_sent_at === null))
  check('tipul cererii păstrat', copyReqs.every(r => reqsBefore.some(o =>
    o.name === r.name && o.requirement_type === r.requirement_type && o.is_outgoing === r.is_outgoing)))

  const { data: copyFiles } = await admin.from('files').select('id').in('requirement_id', copyReqs.map(r => r.id))
  check('FĂRĂ fișierele încărcate de client', (copyFiles ?? []).length === 0, `originalul are ${filesBefore.length}`)

  const { data: attsCopy } = await admin.from('document_requirement_attachments').select('*').in('document_requirement_id', copyReqs.map(r => r.id))
  created.storagePaths.push(...attsCopy.map(a => a.storage_path))
  created.storagePaths.push(...copyReqs.map(r => r.attachment_path).filter(Boolean))
  check('fișierele-model s-au copiat', attsCopy.length === attsBefore.length, `${attsCopy.length}/${attsBefore.length}`)
  check('fiecare fișier-model are obiect propriu în storage',
    attsCopy.every(a => !attsBefore.some(o => o.storage_path === a.storage_path)),
    attsCopy.map(a => a.storage_path.split('/').pop()).join(', '))
  check('obiectele copiate există în storage',
    (await Promise.all(attsCopy.map(a => storageObjectExists(a.storage_path)))).every(Boolean))
  check('obiectele originalului au rămas neatinse',
    (await Promise.all(attsBefore.map(a => storageObjectExists(a.storage_path)))).every(Boolean))

  // ── Duplicare activitate ───────────────────────────────────────────────────
  const actRes = await api(`/api/projects/${projectId}/phases/${PHASE_ID}/activities/${sourceActivity.id}/duplicate`, { method: 'POST' })
  const actBody = await actRes.json()
  check('POST duplicate activitate → 201', actRes.status === 201, `status ${actRes.status}`)
  if (actRes.ok) {
    const actCopy = actBody.activity
    created.activities.push(actCopy.id)
    check('nume activitate „(copie)”', actCopy.name === `${sourceActivity.name} (copie)`, actCopy.name)
    check('copia e draft, cu termenul și responsabilul preluate',
      actCopy.visibility === 'draft'
        && actCopy.deadline_at === sourceActivity.deadline_at
        && actCopy.assigned_to === sourceActivity.assigned_to)
    check('aterizează după originalul ei', actCopy.order_index === (sourceActivity.order_index ?? 0) + 1)
    check('rămâne în aceeași fază', actCopy.phase_id === PHASE_ID)
    const { data: actCopyReqs } = await admin.from('document_requirements').select('id').eq('activity_id', actCopy.id).is('deleted_at', null)
    created.requests.push(...actCopyReqs.map(r => r.id))
    check('cererile activității s-au copiat',
      actCopyReqs.length === reqsBefore.filter(r => r.activity_id === sourceActivity.id).length)
    const { data: actCopyAtts } = await admin.from('document_requirement_attachments').select('storage_path').in('document_requirement_id', actCopyReqs.map(r => r.id))
    created.storagePaths.push(...(actCopyAtts ?? []).map(a => a.storage_path))
    const { data: actCopyFiles } = await admin.from('files').select('id').in('requirement_id', actCopyReqs.map(r => r.id))
    check('FĂRĂ fișiere de client pe copia activității', (actCopyFiles ?? []).length === 0)
  }

  // ── Drepturi: clientul nu poate duplica ────────────────────────────────────
  const clientAuth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data: clientSession, error: clientError } = await clientAuth.auth.signInWithPassword({
    email: process.env.E2E_CLIENT_EMAIL, password: process.env.E2E_CLIENT_PASSWORD,
  })
  if (clientError) {
    check('login client pentru testul de drepturi', false, clientError.message)
  } else {
    const forbidden = await fetch(`${BASE}/api/projects/${projectId}/phases/${PHASE_ID}/duplicate`, {
      method: 'POST', headers: { Authorization: `Bearer ${clientSession.session.access_token}` },
    })
    check('clientul e respins', forbidden.status === 403 || forbidden.status === 404, `status ${forbidden.status}`)
  }

  // ── Audit (#22) ────────────────────────────────────────────────────────────
  const { data: auditRows } = await admin.from('audit_logs').select('description')
    .in('entity_id', [...created.phases, ...created.activities])
  check('acțiunile apar în jurnalul de audit', (auditRows ?? []).length >= 2)
} finally {
  // ── Curățare ───────────────────────────────────────────────────────────────
  if (created.storagePaths.length) {
    await admin.storage.from(BUCKET).remove([...new Set(created.storagePaths)])
  }
  if (created.requests.length) {
    await admin.from('document_requirement_attachments').delete().in('document_requirement_id', created.requests)
    await admin.from('files').delete().in('requirement_id', created.requests)
    await admin.from('document_requirements').delete().in('id', created.requests)
  }
  if (created.activities.length) await admin.from('project_activities').delete().in('id', created.activities)
  if (created.phases.length) await admin.from('project_phases').delete().in('id', created.phases)
  await admin.from('audit_logs').delete().in('entity_id', [...created.phases, ...created.activities])
  for (const p of phasesBefore) await admin.from('project_phases').update({ order_index: p.order_index }).eq('id', p.id)
  for (const a of actsBefore) await admin.from('project_activities').update({ order_index: a.order_index }).eq('id', a.id)

  const { data: phasesFinal } = await admin.from('project_phases').select('id, order_index').eq('project_id', projectId).order('order_index')
  const { data: actsFinal } = await admin.from('project_activities').select('id').eq('phase_id', PHASE_ID)
  const { data: reqsFinal } = await admin.from('document_requirements').select('id').in('activity_id', actsBefore.map(a => a.id)).is('deleted_at', null)
  const { data: filesFinal } = await admin.from('files').select('id').in('requirement_id', reqsBefore.map(r => r.id))
  check('curățare: proiectul a rămas exact cum era',
    phasesFinal.length === phasesBefore.length
      && phasesFinal.every((p, i) => p.id === phasesBefore[i].id && p.order_index === phasesBefore[i].order_index)
      && actsFinal.length === actsBefore.length
      && reqsFinal.length === reqsBefore.length
      && filesFinal.length === filesBefore.length,
    `faze ${phasesFinal.length}/${phasesBefore.length}, activități ${actsFinal.length}/${actsBefore.length}, cereri ${reqsFinal.length}/${reqsBefore.length}, fișiere ${filesFinal.length}/${filesBefore.length}`)

  const failed = results.filter(r => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} verificări trecute`)
  if (failed.length) {
    console.log('EȘUATE:', failed.map(f => f.label).join(' | '))
    process.exitCode = 1
  }
}
