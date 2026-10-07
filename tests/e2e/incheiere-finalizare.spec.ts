import { randomUUID } from 'node:crypto'
import { test, expect, type Browser } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { e2eEnv, requireE2EConfig, serviceClient } from './helpers/project-state'

/**
 * Încheierea și redeschiderea proiectului, finalizarea fazelor și activităților,
 * închiderea cererilor de documente (#109), verificate pe serverul real, prin
 * API și în bază.
 *
 * Suita își face proiectele și șablonul, cu un sufix unic per rulare, și le
 * șterge la final. Conturile de consultant sunt fixe și se refolosesc: jurnalul
 * de audit e append-only, deci un cont care a acționat nu se mai poate șterge.
 *
 * Aplicația trebuie pornită cu un Resend de test (tests/e2e/helpers/resend-mock.mjs):
 * suita nu trimite intenționat niciun email, dar o regresie n-are voie să
 * ajungă la un client real.
 */

const ENV = e2eEnv()
const CONFIG = requireE2EConfig(ENV)
const ADMIN_LOGIN = {
  email: ENV.E2E_ADMIN_EMAIL || CONFIG.staffEmail,
  password: ENV.E2E_ADMIN_PASSWORD || CONFIG.staffPassword,
}
const STAMP = Date.now().toString(36)
const PASSWORD = `Incheiere-${STAMP}-2026!`
const FILE_PREFIX = 'test-fixtures/incheiere'

test.describe.configure({ mode: 'serial' })
test.setTimeout(180_000)

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Person = { id: string; email: string; token: string; label: string }

const service = serviceClient() as SupabaseClient
const created = { projects: new Set<string>(), templates: new Set<string>() }
const testAccounts = new Set<string>()
let admin: Person
let senior: Person // senior membru (supervizor)
let junior: Person // junior membru
let outsider: Person // senior, dar nu e membru
let client: Person // clientul proiectelor
let clientId = ''
let statusId = ''

// ─── Ajutoare ────────────────────────────────────────────────────────────────

async function call(who: Person | null, method: string, url: string, body?: unknown) {
  const res = await fetch(`${CONFIG.baseUrl}${url}`, {
    method,
    headers: {
      ...(who ? { Authorization: `Bearer ${who.token}` } : {}),
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await res.json().catch(() => null) as Json | null
  return { status: res.status, json: json ?? {} }
}

/** Cererea trebuie să reușească: e pregătire de scenariu, nu verificare. */
async function must(who: Person, method: string, url: string, body?: unknown) {
  const res = await call(who, method, url, body)
  expect(res.status, `${method} ${url}: ${JSON.stringify(res.json).slice(0, 300)}`).toBeLessThan(300)
  return res.json
}

/** Statusul HTTP așteptat, cu tot răspunsul în mesaj dacă nu se potrivește. */
function expectStatus(res: { status: number; json: Json }, status: number, what: string) {
  expect.soft(res.status, `${what}: ${JSON.stringify(res.json).slice(0, 300)}`).toBe(status)
}

async function signIn(email: string, password: string) {
  const anon = createClient(CONFIG.supabaseUrl, CONFIG.anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await anon.auth.signInWithPassword({ email, password })
  if (error || !data.session) throw new Error(`Autentificare ${email}: ${error?.message}`)
  return data.session.access_token
}

async function makeConsultant(tag: 'senior' | 'junior' | 'nemembru', level: 'junior' | 'senior'): Promise<Person> {
  const email = `incheiere.${tag}@test.local`
  const name = `Test încheiere — ${tag}`
  let id: string | undefined
  const { data, error } = await service.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
  if (data?.user) {
    id = data.user.id
  } else {
    const { data: existing } = await service.from('profiles').select('id').eq('email', email).maybeSingle()
    if (!existing) throw new Error(`Nu am putut crea ${email}: ${error?.message}`)
    id = existing.id
    const { error: resetError } = await service.auth.admin.updateUserById(existing.id, { password: PASSWORD })
    if (resetError) throw new Error(`Parola pentru ${email}: ${resetError.message}`)
  }
  testAccounts.add(id!)
  const { error: profileError } = await service.from('profiles').upsert({
    id, email, role: 'consultant', consultant_level: level, full_name: name, is_active: true,
  })
  if (profileError) throw new Error(`Profil ${email}: ${profileError.message}`)
  return { id: id!, email, label: `${level} ${tag}`, token: await signIn(email, PASSWORD) }
}

/** Proiect nou: seniorul e supervizor, juniorul e adăugat în echipă. */
async function createProject(title: string) {
  const json = await must(admin, 'POST', '/api/projects', { title: `Încheiere ${STAMP} — ${title}`, client_id: clientId, supervisor_ids: [senior.id] })
  const id = json.project.id as string
  created.projects.add(id)
  await must(admin, 'POST', `/api/projects/${id}/members`, { consultant_id: junior.id })
  return id
}

async function addPhase(projectId: string, name: string) {
  return (await must(admin, 'POST', `/api/projects/${projectId}/phases`, { name })).phase.id as string
}

async function addActivity(projectId: string, phaseId: string, name: string) {
  return (await must(admin, 'POST', `/api/projects/${projectId}/phases/${phaseId}/activities`, { name })).activity.id as string
}

async function addRequest(projectId: string, activityId: string, name: string) {
  return (await must(admin, 'POST', `/api/projects/${projectId}/document-requests`, {
    name, activity_id: activityId, deadline_at: '2030-01-03T00:00:00.000Z',
  })).id as string
}

/**
 * Tot ce e în proiect devine vizibil clientului. Prin baza de date, nu prin
 * rute: publicarea cere responsabil, iar o atribuire prin rută ar trimite email.
 */
async function publishEverything(projectId: string) {
  const { data: phases } = await service.from('project_phases').select('id').eq('project_id', projectId)
  const phaseIds = (phases ?? []).map(row => row.id)
  for (const [table, column, ids] of [
    ['project_phases', 'project_id', [projectId]],
    ['project_activities', 'phase_id', phaseIds],
    ['document_requirements', 'project_id', [projectId]],
  ] as const) {
    const { error } = await service.from(table).update({ visibility: 'published' }).in(column, ids as string[])
    if (error) throw new Error(`Publicare ${table}: ${error.message}`)
  }
}

/** Un fișier al clientului, deci cererea ajunge „În verificare". */
async function putInReview(requestId: string) {
  const { error: fileError } = await service.from('files').insert({
    id: randomUUID(), requirement_id: requestId, storage_path: `${FILE_PREFIX}/${requestId}/document.pdf`,
    original_name: 'document.pdf', file_size: 10, mime_type: 'application/pdf', version_number: 1, uploaded_by: clientId,
  })
  if (fileError) throw new Error(`Fișier fixture: ${fileError.message}`)
  const { error } = await service.from('document_requirements').update({ status: 'review' }).eq('id', requestId)
  if (error) throw new Error(`Status review: ${error.message}`)
}

async function requestRow(id: string) {
  const { data, error } = await service.from('document_requirements')
    .select('id, status, status_before_close, closed_at, closed_by, activity_id, deleted_at, name')
    .eq('id', id).single()
  if (error) throw new Error(`Cererea ${id}: ${error.message}`)
  return data as Json
}

async function auditRows(entityId: string, actions: string[]) {
  const { data, error } = await service.from('audit_logs')
    .select('action_type, user_id, entity_type, old_values, new_values')
    .eq('entity_id', entityId)
    .in('action_type', actions)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`Audit ${entityId}: ${error.message}`)
  return (data ?? []) as Json[]
}

/** Cine nu are voie (D1): juniorul membru, clientul și seniorul care nu e membru. */
async function refusedFor(method: string, url: string, what: string) {
  for (const person of [junior, client, outsider]) {
    expectStatus(await call(person, method, url), 403, `${person.label}: ${what}`)
  }
}

function templateTree(name: string, phaseNames: string[]) {
  return {
    name,
    slug: `incheiere-${STAMP}-${Math.random().toString(36).slice(2, 7)}`,
    description: 'Șablon creat de suita de încheiere',
    phases: phaseNames.map((phaseName, p) => ({
      id: `p${p}`, name: phaseName, project_status_id: statusId,
      activities: [{ id: `p${p}a0`, name: `${phaseName} — activitate`, document_requirements: [
        { id: `p${p}a0d0`, name: `${phaseName} — document`, requirement_type: 'obligatoriu', attachments: [] },
      ] }],
    })),
  }
}

/** Arborele în forma trimisă de editor, cu o fază în plus. */
function editorTree(template: Json, extraPhase: string) {
  const phases = template.phases.map((phase: Json) => ({
    id: phase.id, name: phase.name, project_status_id: phase.project_status_id,
    activities: phase.activities.map((activity: Json) => ({
      id: activity.id, name: activity.name, default_consultant_id: activity.default_consultant_id,
      document_requirements: activity.document_requirements.map((doc: Json) => ({
        id: doc.id, name: doc.name, description: doc.description, is_outgoing: doc.is_outgoing,
        requirement_type: doc.requirement_type, attachments: doc.attachments,
      })),
    })),
  }))
  phases.push({ id: `nou-${randomUUID()}`, name: extraPhase, project_status_id: statusId, activities: [] })
  return { name: template.name, description: template.description, phases }
}

/** Un context nou per rol: Supabase rotește tokenul de refresh, deci nu se refolosește. */
async function login(browser: Browser, email: string, password: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await page.goto('/login')
  await page.fill('input[type=email]', email)
  await page.fill('input[type=password]', password)
  await page.click('button[type=submit]')
  await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 30_000 })
  return { context, page }
}

// ─── Pregătire și curățenie ──────────────────────────────────────────────────

test.beforeAll(async () => {
  expect(service, 'Clientul service E2E lipsește').toBeTruthy()

  const { data: adminProfile } = await service.from('profiles').select('id, email, role').eq('email', ADMIN_LOGIN.email).single()
  if (adminProfile?.role !== 'admin') throw new Error('E2E_ADMIN_EMAIL trebuie să fie un cont de admin')
  admin = { id: adminProfile.id, email: adminProfile.email, label: 'admin', token: await signIn(ADMIN_LOGIN.email, ADMIN_LOGIN.password) }

  const { data: clientProfile } = await service.from('profiles').select('id, email, role').eq('email', CONFIG.clientEmail).single()
  const { data: status } = await service.from('project_statuses').select('id').order('id').limit(1).single()
  if (clientProfile?.role !== 'client' || !status) throw new Error('Baza E2E nu are clientul sau statusurile așteptate')
  clientId = clientProfile.id
  statusId = status.id
  client = { id: clientId, email: clientProfile.email, label: 'client', token: await signIn(CONFIG.clientEmail, CONFIG.clientPassword) }

  senior = await makeConsultant('senior', 'senior')
  junior = await makeConsultant('junior', 'junior')
  outsider = await makeConsultant('nemembru', 'senior')
})

test.afterAll(async () => {
  if (!service) return
  const leftovers: string[] = []
  for (const id of created.projects) {
    const { error } = await service.from('projects').delete().eq('id', id)
    if (error) leftovers.push(`proiect ${id}: ${error.message}`)
  }
  for (const id of created.templates) {
    const { error } = await service.from('project_templates').delete().eq('id', id)
    if (error) leftovers.push(`șablon ${id}: ${error.message}`)
  }
  await service.from('files').delete().like('storage_path', `${FILE_PREFIX}/%`)
  // Conturile fixe rămân pentru rularea următoare, dar fără drepturi de senior.
  for (const id of testAccounts) {
    await service.from('profiles').update({ consultant_level: 'junior', is_active: false }).eq('id', id)
  }
  if (leftovers.length) console.log(`Curățenie cu resturi:\n${leftovers.join('\n')}`)
})

// ═══ PROIECTUL ═══════════════════════════════════════════════════════════════

test('Proiectul: se încheie și se redeschide doar de admin și de seniorul membru', async () => {
  const projectId = await createProject('proiect')
  const close = `/api/projects/${projectId}/close`
  const reopen = `/api/projects/${projectId}/reopen`

  await refusedFor('POST', close, 'încheie proiectul')
  const closed = await call(admin, 'POST', close)
  expectStatus(closed, 200, 'adminul încheie proiectul')
  expect.soft(closed.json.project?.lifecycle_status).toBe('completed')
  expect.soft(closed.json.project?.closed_at).toBeTruthy()
  expect.soft(closed.json.project?.closed_by).toBe(admin.id)

  const twice = await call(admin, 'POST', close)
  expectStatus(twice, 409, 'a doua încheiere')
  expect.soft(twice.json.message).toBe('Proiectul e deja încheiat.')

  // Clientul vede că e încheiat și când, nu și de cine.
  const asClient = await call(client, 'GET', `/api/projects/${projectId}`)
  expectStatus(asClient, 200, 'clientul deschide proiectul încheiat')
  expect.soft(asClient.json.project?.closed_at).toBeTruthy()
  expect.soft('closed_by' in (asClient.json.project ?? {}), 'closed_by la client').toBe(false)
  expect.soft('closer' in (asClient.json.project ?? {}), 'closer la client').toBe(false)
  const listed = ((await must(client, 'GET', '/api/projects')).projects as Json[]).find(p => p.id === projectId)
  expect.soft(listed?.closed_at).toBeTruthy()
  expect.soft('closed_by' in (listed ?? {}), 'closed_by în lista clientului').toBe(false)

  // Echipa vede și numele.
  const asSenior = await must(senior, 'GET', `/api/projects/${projectId}`)
  expect.soft(asSenior.project?.closer?.id).toBe(admin.id)
  expect.soft(asSenior.permissions?.close_project).toBe(true)
  expect.soft(asSenior.permissions?.complete_items).toBe(true)
  const asJunior = await must(junior, 'GET', `/api/projects/${projectId}`)
  expect.soft(asJunior.permissions?.close_project).toBe(false)
  expect.soft(asJunior.permissions?.complete_items).toBe(false)

  // PATCH-ul nu e un al doilea drum spre încheiere.
  const patched = await call(admin, 'PATCH', `/api/projects/${projectId}`, { lifecycle_status: 'active' })
  expectStatus(patched, 400, 'PATCH cu lifecycle_status')
  expect.soft(patched.json.message).toMatch(/Mai multe acțiuni/)

  await refusedFor('POST', reopen, 'redeschide proiectul')
  const reopened = await call(admin, 'POST', reopen)
  expectStatus(reopened, 200, 'adminul redeschide proiectul')
  expect.soft(reopened.json.project?.lifecycle_status).toBe('active')
  expect.soft(reopened.json.project?.closed_at).toBeNull()
  expect.soft(reopened.json.project?.closed_by).toBeNull()
  expectStatus(await call(admin, 'POST', reopen), 409, 'redeschiderea unui proiect activ')

  expectStatus(await call(senior, 'POST', close), 200, 'seniorul membru încheie proiectul')
  expectStatus(await call(senior, 'POST', reopen), 200, 'seniorul membru îl redeschide')

  // Două încheieri simultane: una reușește, cealaltă primește 409, un singur rând de audit.
  const before = (await auditRows(projectId, ['close'])).length
  const statuses = (await Promise.all([call(admin, 'POST', close), call(admin, 'POST', close)])).map(r => r.status).sort()
  expect.soft(statuses).toEqual([200, 409])
  expect.soft((await auditRows(projectId, ['close'])).length).toBe(before + 1)

  const audit = await auditRows(projectId, ['close', 'reopen'])
  expect.soft(audit.map(row => `${row.action_type}:${row.user_id === admin.id ? 'admin' : row.user_id === senior.id ? 'senior' : '?'}`))
    .toEqual(['close:admin', 'reopen:admin', 'close:senior', 'reopen:senior', 'close:admin'])
  expect.soft(audit.every(row => row.entity_type === 'project')).toBe(true)
})

// ═══ FAZE ȘI ACTIVITĂȚI ══════════════════════════════════════════════════════

test('Fazele și activitățile: doar adminul și seniorul membru le finalizează (D1); redeschise, ajung în lucru (D17)', async () => {
  const projectId = await createProject('faze')
  const phaseId = await addPhase(projectId, 'Contractare')
  const activityId = await addActivity(projectId, phaseId, 'Verificare eligibilitate')

  const activityBase = `/api/projects/${projectId}/phases/${phaseId}/activities/${activityId}`
  // Activitatea întâi: o fază se finalizează doar cu activitățile ei finalizate.
  for (const [kind, base] of [
    ['activity', activityBase],
    ['phase', `/api/projects/${projectId}/phases/${phaseId}`],
  ] as const) {
    const table = kind === 'phase' ? 'project_phases' : 'project_activities'
    const id = kind === 'phase' ? phaseId : activityId
    if (kind === 'phase') await must(admin, 'POST', `${activityBase}/complete`)

    await refusedFor('POST', `${base}/complete`, `finalizează ${kind}`)
    const done = await call(admin, 'POST', `${base}/complete`)
    expectStatus(done, 200, `adminul finalizează ${kind}`)
    expect.soft(done.json[kind]?.status).toBe('completed')
    expect.soft(done.json[kind]?.completed_at).toBeTruthy()
    expect.soft(done.json[kind]?.completed_by).toBe(admin.id)
    expectStatus(await call(admin, 'POST', `${base}/complete`), 409, `a doua finalizare (${kind})`)

    await refusedFor('POST', `${base}/reopen`, `redeschide ${kind}`)
    const back = await call(admin, 'POST', `${base}/reopen`)
    expectStatus(back, 200, `adminul readuce ${kind} în lucru`)
    expect.soft(back.json[kind]?.status).toBe('in_progress')
    expect.soft(back.json[kind]?.completed_at).toBeNull()
    expect.soft(back.json[kind]?.completed_by).toBeNull()
    expectStatus(await call(admin, 'POST', `${base}/reopen`), 409, `redeschiderea unui element în lucru (${kind})`)

    expectStatus(await call(senior, 'POST', `${base}/complete`), 200, `seniorul finalizează ${kind}`)
    expectStatus(await call(senior, 'POST', `${base}/reopen`), 200, `seniorul readuce ${kind} în lucru`)

    // Starea nu se mai schimbă prin PATCH, nici de admin.
    const patched = await call(admin, 'PATCH', base, { status: 'completed' })
    expectStatus(patched, 400, `PATCH ${kind} cu status`)
    expect.soft(patched.json.message).toMatch(/Marchează ca finalizată/)
    const { data: row } = await service.from(table).select('status').eq('id', id).single()
    expect.soft(row?.status).toBe('in_progress')

    const audit = await auditRows(id, ['complete', 'reopen'])
    expect.soft(audit.map(r => `${r.action_type}:${r.user_id === admin.id ? 'admin' : 'senior'}`))
      .toEqual(['complete:admin', 'reopen:admin', 'complete:senior', 'reopen:senior'])
    expect.soft(audit.every(r => r.entity_type === (kind === 'phase' ? 'project_phase' : 'project_activity'))).toBe(true)
  }

  // Regula din 7 octombrie 2026: tot ce e dedesubt trebuie să fie gata, iar
  // mesajul spune ce anume mai e deschis.
  const ruleActivity = await addActivity(projectId, phaseId, 'Cu cerere deschisă')
  const openRequest = await addRequest(projectId, ruleActivity, 'Cerere încă deschisă')
  const ruleBase = `/api/projects/${projectId}/phases/${phaseId}/activities/${ruleActivity}`
  const blockedActivity = await call(admin, 'POST', `${ruleBase}/complete`)
  expectStatus(blockedActivity, 409, 'finalizarea unei activități cu o cerere deschisă')
  expect.soft(blockedActivity.json.message).toMatch(/„Cerere încă deschisă” nu e încă aprobată sau închisă/)
  const blockedPhase = await call(admin, 'POST', `/api/projects/${projectId}/phases/${phaseId}/complete`)
  expectStatus(blockedPhase, 409, 'finalizarea unei faze cu o activitate nefinalizată')
  expect.soft(blockedPhase.json.message).toMatch(/„Cu cerere deschisă” nu e încă finalizată/)
  await must(admin, 'POST', `/api/document-requests/${openRequest}/close`)
  expectStatus(await call(admin, 'POST', `${ruleBase}/complete`), 200, 'finalizarea activității după închiderea cererii')

  // Nici la creare: un element nou pornește „pending".
  expectStatus(await call(admin, 'POST', `/api/projects/${projectId}/phases`, { name: 'Gata de la început', status: 'completed' }), 400, 'POST fază cu status')
  expectStatus(await call(admin, 'POST', `/api/projects/${projectId}/phases/${phaseId}/activities`, { name: 'Gata', status: 'completed' }), 400, 'POST activitate cu status')
  // Juniorul poate în continuare să adauge conținut (rândul p-continut), aici
  // într-o fază separată, ca să nu blocheze finalizarea celei de mai jos.
  const juniorPhase = await addPhase(projectId, 'Implementare')
  expectStatus(await call(junior, 'POST', `/api/projects/${projectId}/phases/${juniorPhase}/activities`, { name: 'Activitate de junior' }), 201, 'juniorul adaugă o activitate')

  // Faza altui proiect nu se atinge prin URL-ul acestuia.
  const otherProject = await createProject('alt proiect')
  expectStatus(await call(admin, 'POST', `/api/projects/${otherProject}/phases/${phaseId}/complete`), 404, 'fază din alt proiect')

  // Clientul vede starea, nu și cine a marcat.
  await must(admin, 'POST', `/api/projects/${projectId}/phases/${phaseId}/complete`)
  await publishEverything(projectId)
  const phases = (await must(client, 'GET', `/api/projects/${projectId}/phases`)).phases as Json[]
  const phase = phases.find(p => p.id === phaseId)
  expect.soft(phase?.status).toBe('completed')
  expect.soft('completed_by' in (phase ?? {}), 'completed_by la client').toBe(false)
  expect.soft((phase?.activities ?? []).every((a: Json) => !('completed_by' in a)), 'completed_by pe activități, la client').toBe(true)
})

// ═══ CERERI ══════════════════════════════════════════════════════════════════

test('Cererile: se închid din „De încărcat", „Respins" și „Aprobat", și revin exact la starea dinainte', async () => {
  const projectId = await createProject('cereri')
  const phaseId = await addPhase(projectId, 'Depunere')
  const activityId = await addActivity(projectId, phaseId, 'Dosarul de finanțare')

  // De încărcat → închisă → De încărcat
  const pending = await addRequest(projectId, activityId, 'Certificat fiscal')
  await refusedFor('POST', `/api/document-requests/${pending}/close`, 'închide cererea')
  const closed = await call(admin, 'POST', `/api/document-requests/${pending}/close`)
  expectStatus(closed, 200, 'adminul închide cererea')
  let row = await requestRow(pending)
  expect.soft([row.status, row.status_before_close, row.closed_by, !!row.closed_at]).toEqual(['closed', 'pending', admin.id, true])
  expectStatus(await call(admin, 'POST', `/api/document-requests/${pending}/close`), 409, 'a doua închidere')
  await refusedFor('POST', `/api/document-requests/${pending}/reopen`, 'redeschide cererea')
  expectStatus(await call(admin, 'POST', `/api/document-requests/${pending}/reopen`), 200, 'adminul redeschide cererea')
  row = await requestRow(pending)
  expect.soft([row.status, row.status_before_close, row.closed_by, row.closed_at]).toEqual(['pending', null, null, null])
  expectStatus(await call(admin, 'POST', `/api/document-requests/${pending}/reopen`), 409, 'redeschiderea unei cereri deschise')
  expectStatus(await call(senior, 'POST', `/api/document-requests/${pending}/close`), 200, 'seniorul închide cererea')
  expectStatus(await call(senior, 'POST', `/api/document-requests/${pending}/reopen`), 200, 'seniorul redeschide cererea')
  expect.soft((await auditRows(pending, ['close', 'reopen'])).map(r => r.action_type)).toEqual(['close', 'reopen', 'close', 'reopen'])

  // În verificare: nu se închide (D3). Juniorul încă respinge (rândul p-aproba).
  const review = await addRequest(projectId, activityId, 'Bilanț 2025')
  await putInReview(review)
  const reviewClose = await call(admin, 'POST', `/api/document-requests/${review}/close`)
  expectStatus(reviewClose, 409, 'închiderea unei cereri în verificare')
  expect.soft(reviewClose.json.message).toBe('Verifică întâi documentele încărcate.')
  expectStatus(await call(junior, 'POST', `/api/document-requests/${review}/review`, { action: 'rejected', notes: 'Lipsește ștampila.' }), 200, 'juniorul respinge documentul')

  // Respins → închisă → Respins
  expectStatus(await call(admin, 'POST', `/api/document-requests/${review}/close`), 200, 'închiderea unei cereri respinse')
  expect.soft((await requestRow(review)).status_before_close).toBe('rejected')
  // Aceeași decizie repetată pe o cerere închisă: 409, nu succesul tăcut al căii idempotente.
  expectStatus(await call(junior, 'POST', `/api/document-requests/${review}/review`, { action: 'rejected', notes: 'Din nou.' }), 409, 'verificarea unei cereri închise')
  expectStatus(await call(admin, 'POST', `/api/document-requests/${review}/reopen`), 200, 'redeschiderea cererii respinse')
  expect.soft((await requestRow(review)).status).toBe('rejected')

  // Aprobată: se închide și ea (decizia din 7 octombrie 2026), rămâne „Aprobat”
  // în interfață, dar nu mai primește fișiere; redeschisă, revine la „Aprobat”.
  const approved = await addRequest(projectId, activityId, 'Extras de cont')
  await putInReview(approved)
  expectStatus(await call(junior, 'POST', `/api/document-requests/${approved}/review`, { action: 'approved' }), 200, 'juniorul aprobă documentul')
  expectStatus(await call(admin, 'POST', `/api/document-requests/${approved}/close`), 200, 'închiderea unei cereri aprobate')
  expect.soft((await requestRow(approved)).status_before_close).toBe('approved')
  // Publicată, ca refuzul să vină din închidere, nu din vizibilitate (404).
  await publishEverything(projectId)
  expectStatus(await call(client, 'POST', `/api/document-requests/${approved}/uploads/init`, { files: [{ name: 'nou.pdf', size: 9, type: 'application/pdf' }] }), 409, 'încărcarea într-o cerere aprobată și închisă')
  expectStatus(await call(admin, 'POST', `/api/document-requests/${approved}/reopen`), 200, 'redeschiderea cererii aprobate')
  expect.soft((await requestRow(approved)).status).toBe('approved')

  // Documentul trimis clientului nu se închide niciodată (D12).
  const outgoing = randomUUID()
  const { error: outgoingError } = await service.from('document_requirements').insert({
    id: outgoing, project_id: projectId, activity_id: activityId, name: 'Model de declarație',
    requirement_type: 'optional', is_outgoing: true, status: 'pending', visibility: 'draft',
  })
  if (outgoingError) throw new Error(`Document trimis: ${outgoingError.message}`)
  expectStatus(await call(admin, 'POST', `/api/document-requests/${outgoing}/close`), 400, 'închiderea unui document trimis clientului')

  // Ștearsă: nu se mai închide.
  const removed = await addRequest(projectId, activityId, 'Cerere ștearsă')
  await must(admin, 'DELETE', `/api/document-requests/${removed}`)
  expectStatus(await call(admin, 'POST', `/api/document-requests/${removed}/close`), 409, 'închiderea unei cereri șterse')
})

test('O cerere închisă nu se modifică (D13) și nu primește fișiere', async () => {
  const projectId = await createProject('cerere închisă')
  const phaseId = await addPhase(projectId, 'Implementare')
  const activityId = await addActivity(projectId, phaseId, 'Raportare')
  const requestId = await addRequest(projectId, activityId, 'Raport intermediar')
  const neighbour = await addRequest(projectId, activityId, 'Raport final')
  await publishEverything(projectId)

  // Clientul rezervă o încărcare, apoi consultantul închide cererea.
  const reserved = await call(client, 'POST', `/api/document-requests/${requestId}/uploads/init`, {
    files: [{ name: 'raport.pdf', size: 12, type: 'application/pdf' }],
  })
  expectStatus(reserved, 200, 'clientul rezervă o încărcare')
  await must(admin, 'POST', `/api/document-requests/${requestId}/close`)

  const completed = await call(client, 'POST', `/api/document-requests/${requestId}/uploads/complete`, {
    batchId: reserved.json.batchId, fileIds: (reserved.json.uploads ?? []).map((u: Json) => u.fileId),
  })
  expectStatus(completed, 409, 'finalizarea încărcării după închidere')
  expect.soft(completed.json.message).toBe('Cererea a fost închisă între timp. Nu se mai pot încărca fișiere.')
  const initClosed = await call(client, 'POST', `/api/document-requests/${requestId}/uploads/init`, {
    files: [{ name: 'altul.pdf', size: 12, type: 'application/pdf' }],
  })
  expectStatus(initClosed, 409, 'o rezervare nouă într-o cerere închisă')

  // Și direct în bază: triggerul refuză, iar tranzacția nu lasă nimic în `files`.
  const { error: rpcError } = await service.rpc('complete_reserved_document_upload_batch', {
    p_upload_batch_id: reserved.json.batchId,
    p_actor_id: clientId,
    p_selected_file_ids: (reserved.json.uploads ?? []).map((u: Json) => u.fileId),
    p_ip_address: null,
  })
  expect.soft(rpcError?.message).toBe('Document request is closed')
  const { count } = await service.from('files').select('id', { count: 'exact', head: true }).eq('requirement_id', requestId)
  expect.soft(count).toBe(0)
  expect.soft((await requestRow(requestId)).status).toBe('closed')

  // Verificare, reminder și orice modificare: refuzate.
  expectStatus(await call(admin, 'POST', `/api/document-requests/${requestId}/review`, { action: 'approved' }), 409, 'verificarea unei cereri închise')
  expectStatus(await call(admin, 'POST', `/api/document-requests/${requestId}/reminder`), 409, 'reminder manual pe o cerere închisă')
  for (const [what, body] of [
    ['numele', { name: 'Alt nume' }],
    ['termenul', { deadline_at: '2031-01-01T00:00:00.000Z' }],
    ['publicarea', { visibility: 'published' }],
  ] as const) {
    const res = await call(admin, 'PATCH', `/api/document-requests/${requestId}`, body)
    expectStatus(res, 409, `PATCH ${what} pe o cerere închisă`)
    expect.soft(res.json.message).toBe('Cererea e închisă. Redeschide-o ca s-o modifici.')
  }
  expect.soft((await requestRow(requestId)).name).toBe('Raport intermediar')

  // Reordonarea rămâne permisă.
  expectStatus(await call(admin, 'POST', `/api/projects/${projectId}/document-requests/reorder`, {
    orders: [{ id: neighbour, order_index: 1 }, { id: requestId, order_index: 2 }],
  }), 200, 'reordonarea cu o cerere închisă')

  // Redeschisă, se modifică din nou.
  await must(admin, 'POST', `/api/document-requests/${requestId}/reopen`)
  expectStatus(await call(admin, 'PATCH', `/api/document-requests/${requestId}`, { name: 'Raport intermediar (corectat)' }), 200, 'PATCH după redeschidere')

  // Ștergerea unei cereri închise rămâne permisă (decizie din 5 octombrie 2026).
  await must(admin, 'POST', `/api/document-requests/${requestId}/close`)
  expectStatus(await call(admin, 'DELETE', `/api/document-requests/${requestId}`), 200, 'ștergerea unei cereri închise')
})

// ═══ LISTE „DE FĂCUT" ȘI „ANUNȚĂ CLIENTUL" ═══════════════════════════════════

test('Un proiect încheiat iese din listele „de făcut" (D5); o cerere închisă nu e o noutate de anunțat', async () => {
  const projectId = await createProject('liste')
  const phaseId = await addPhase(projectId, 'Pregătire')
  const activityId = await addActivity(projectId, phaseId, 'Documente de identificare')
  const requestId = await addRequest(projectId, activityId, 'Carte de identitate')
  await publishEverything(projectId)

  const ids = async (who: Person) => ((await must(who, 'GET', '/api/my-document-requests')).requests as Json[]).map(r => r.id)
  expect.soft(await ids(client), 'clientul o are de încărcat').toContain(requestId)
  expect.soft(await ids(admin), 'adminul o vede de rezolvat').toContain(requestId)
  expect.soft(await ids(senior), 'seniorul membru o vede de rezolvat').toContain(requestId)

  await must(admin, 'POST', `/api/projects/${projectId}/close`)
  expect.soft(await ids(client), 'proiect încheiat: nimic de încărcat').not.toContain(requestId)
  expect.soft(await ids(admin), 'proiect încheiat: nimic de rezolvat (admin)').not.toContain(requestId)
  expect.soft(await ids(senior), 'proiect încheiat: nimic de rezolvat (senior)').not.toContain(requestId)

  await must(admin, 'POST', `/api/projects/${projectId}/reopen`)
  expect.soft(await ids(client), 'redeschis: cererea revine').toContain(requestId)

  // Faza și activitatea sunt deja anunțate; singura noutate e cererea, închisă.
  const notifiedAt = new Date().toISOString()
  await service.from('project_phases').update({ client_notified_at: notifiedAt }).eq('id', phaseId)
  await service.from('project_activities').update({ client_notified_at: notifiedAt }).eq('id', activityId)
  await must(admin, 'POST', `/api/document-requests/${requestId}/close`)
  const notify = await call(admin, 'POST', `/api/projects/${projectId}/notify-client`)
  expectStatus(notify, 400, '„Anunță clientul" fără nicio noutate în afara cererii închise')
  const { data: stillUnnotified } = await service.from('document_requirements').select('client_notified_at').eq('id', requestId).single()
  expect.soft(stillUnnotified?.client_notified_at).toBeNull()
})

// ═══ PROPAGAREA DIN ȘABLON ═══════════════════════════════════════════════════

test('Propagarea sare proiectele încheiate (D8) și cererile închise (D13), iar restaurarea golește închiderea', async () => {
  const template = (await must(admin, 'POST', '/api/admin/templates', templateTree(`Încheiere ${STAMP} — șablon`, ['Pregătire', 'Depunere']))).template as Json
  created.templates.add(template.id)
  await must(admin, 'PATCH', `/api/admin/templates/${template.id}`, { status: 'published' })

  const active = await createProject('propagare, activ')
  const ended = await createProject('propagare, încheiat')
  await must(admin, 'POST', `/api/projects/${active}/import-template`, { template_id: template.id })
  await must(admin, 'POST', `/api/projects/${ended}/import-template`, { template_id: template.id })

  const { data: docs } = await service.from('document_requirements')
    .select('id, name, activity_id').eq('project_id', active).order('name')
  const [submitDoc, prepDoc] = [docs!.find(d => d.name.startsWith('Depunere'))!, docs!.find(d => d.name.startsWith('Pregătire'))!]

  // Cererea din „Pregătire", închisă și mutată în altă activitate: propagarea
  // ar vrea s-o mute înapoi, dar o cerere închisă nu se modifică.
  await must(admin, 'POST', `/api/document-requests/${prepDoc.id}/close`)
  await service.from('document_requirements').update({ activity_id: submitDoc.activity_id }).eq('id', prepDoc.id)
  // Cererea din „Depunere", închisă și apoi ștearsă: propagarea o restaurează.
  await must(admin, 'POST', `/api/document-requests/${submitDoc.id}/close`)
  await must(admin, 'DELETE', `/api/document-requests/${submitDoc.id}`)

  await must(admin, 'POST', `/api/projects/${ended}/close`)
  const current = (await must(admin, 'GET', `/api/admin/templates/${template.id}`)).template as Json
  await must(admin, 'PUT', `/api/admin/templates/${template.id}/tree`, editorTree(current, `Fază propagată ${STAMP}`))

  const preview = await must(admin, 'POST', `/api/admin/templates/${template.id}/propagation/preview`, {})
  const blocked = (preview.ineligible as Json[]).find(p => p.project_id === ended)
  expect.soft(blocked, 'proiectul încheiat apare blocat').toBeTruthy()
  expect.soft((blocked?.blocked_reasons ?? []).join(' ')).toMatch(/încheiat/)
  const eligible = (preview.eligible as Json[]).find(p => p.project_id === active)
  expect.soft(eligible?.totals?.phases, 'faza nouă, în proiectul activ').toBe(1)

  const applied = await must(admin, 'POST', `/api/admin/templates/${template.id}/propagation/apply`, { project_ids: [active, ended] })
  const results = new Map((applied.results as Json[]).map(r => [r.project_id, r]))
  expect.soft(results.get(active)?.status).toBe('applied')
  expect.soft((results.get(active)?.warnings ?? []).some((w: Json) => w.type === 'closed_request'), 'avertisment „cerere închisă"').toBe(true)
  expect.soft(results.get(active)?.totals?.skipped).toBeGreaterThanOrEqual(1)
  expect.soft(results.get(ended)?.status).toBe('skipped')
  expect.soft(results.get(ended)?.reason).toMatch(/încheiat/)

  const phaseCount = async (projectId: string) =>
    (await service.from('project_phases').select('id', { count: 'exact', head: true }).eq('project_id', projectId)).count
  expect.soft(await phaseCount(active), 'faza nouă a ajuns în proiectul activ').toBe(3)
  expect.soft(await phaseCount(ended), 'proiectul încheiat a rămas neatins').toBe(2)

  const closedStill = await requestRow(prepDoc.id)
  expect.soft([closedStill.status, closedStill.activity_id]).toEqual(['closed', submitDoc.activity_id])
  const restored = await requestRow(submitDoc.id)
  expect.soft([restored.status, restored.deleted_at, restored.closed_at, restored.closed_by, restored.status_before_close])
    .toEqual(['pending', null, null, null, null])
})

// ═══ INTERFAȚA ═══════════════════════════════════════════════════════════════

test('Interfața: meniul „⋯” încheie și redeschide proiectul; badge, remindere, calendar, Home, tablou', async ({ browser }) => {
  const projectId = await createProject('interfață')
  const title = `Încheiere ${STAMP} — interfață`
  const phaseId = await addPhase(projectId, 'Pregătire')
  const activityId = await addActivity(projectId, phaseId, 'Documente de bază')
  const requestName = `Certificat ${STAMP}`
  const requestId = await addRequest(projectId, activityId, requestName)
  await publishEverything(projectId)
  // Un termen deja trecut: redeschiderea trebuie să-l anunțe.
  await service.from('document_requirements').update({ deadline_at: new Date(Date.now() - 3 * 86_400_000).toISOString() }).eq('id', requestId)

  const asAdmin = await login(browser, ADMIN_LOGIN.email, ADMIN_LOGIN.password)
  const page = asAdmin.page
  try {
    await page.goto(`/projects/${projectId}`)
    const menu = page.getByRole('button', { name: 'Mai multe acțiuni' })
    await expect(menu).toBeVisible({ timeout: 30_000 })
    const calendarTab = page.getByRole('button', { name: /^Calendar/ })
    await expect.soft(calendarTab, 'insigna tabului numără termenul depășit').toContainText('termene depășite')

    // Încheierea, cu confirmare.
    await menu.click()
    await page.getByRole('menuitem', { name: 'Încheie proiectul' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Închei proiectul')
    await expect.soft(dialog).toContainText('Reminderele automate se opresc')
    await dialog.getByRole('button', { name: 'Încheie proiectul' }).click()
    await expect(page.getByText('Proiectul a fost încheiat.')).toBeVisible()

    const badge = page.getByText(/^Încheiat pe \d{1,2} \S+ \d{4} · de .+/)
    await expect.soft(badge, 'badge-ul cu data și autorul, pentru echipă').toBeVisible()
    const bell = page.getByRole('button', { name: 'Oprește reminderele automate' })
    await expect.soft(bell, 'comutatorul de remindere e oprit').toBeDisabled()
    await expect.soft(bell).toHaveAttribute('title', 'Proiectul e încheiat; reminderele automate sunt oprite.')
    await expect.soft(calendarTab, 'insigna tabului e 0 pe proiect încheiat').not.toContainText('termene depășite')

    // Redeschiderea spune câte termene sunt deja depășite.
    await menu.click()
    await expect.soft(page.getByRole('menuitem', { name: 'Încheie proiectul' })).toHaveCount(0)
    await page.getByRole('menuitem', { name: 'Redeschide proiectul' }).click()
    await expect.soft(dialog).toContainText('Un termen e deja depășit')
    await dialog.getByRole('button', { name: 'Redeschide proiectul' }).click()
    await expect(page.getByText('Proiectul a fost redeschis.')).toBeVisible()
    await expect.soft(page.getByText(/^Încheiat pe/)).toHaveCount(0)
    await expect.soft(bell).toBeEnabled()

    // Încheiat din nou, pentru restul verificărilor.
    await must(admin, 'POST', `/api/projects/${projectId}/close`)

    // Calendarul general ascunde proiectul încheiat până la comutator.
    await page.goto('/calendar?cv=list')
    const ended = page.getByRole('button', { name: /Și proiectele încheiate/ })
    await expect(ended).toBeVisible({ timeout: 30_000 })
    await expect.soft(page.getByText(requestName), 'calendarul general: ascuns implicit').toHaveCount(0)
    await ended.click()
    await expect.soft(page.getByText(requestName).first(), 'calendarul general: vizibil cu comutatorul').toBeVisible()
    await expect.soft(page).toHaveURL(/ce=1/)

    // Home: semnul „Încheiat” pe card.
    await page.goto('/')
    const card = page.locator('a', { hasText: title }).first()
    await expect(card).toBeVisible({ timeout: 30_000 })
    await expect.soft(card.getByText('Încheiat', { exact: true }), 'Home: semnul pe card').toBeVisible()
    await expect.soft(card.getByText('La zi', { exact: true }), 'Home: un proiect încheiat nu e „la zi”').toHaveCount(0)

    // Tabloul de bord: ascuns implicit; cu proiectele încheiate, semnul și linkul spre calendar.
    await page.goto('/admin/proiecte?incheiate=1')
    const row = page.locator('tr', { hasText: title }).first()
    await expect(row).toBeVisible({ timeout: 30_000 })
    await expect.soft(row.getByText('Încheiat', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: `Arată termenele — ${title}` }).click()
    const calendarLink = page.getByRole('link', { name: 'Vezi în calendar' }).first()
    await expect.soft(calendarLink).toHaveAttribute('href', /ce=1/)
  } finally {
    await asAdmin.context.close()
  }

  // Juniorul nu vede meniul; seniorul îl vede.
  const asJunior = await login(browser, junior.email, PASSWORD)
  try {
    await asJunior.page.goto(`/projects/${projectId}`)
    await expect(asJunior.page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 })
    await expect.soft(asJunior.page.getByRole('button', { name: 'Mai multe acțiuni' }), 'juniorul nu are meniul').toHaveCount(0)
    await expect.soft(asJunior.page.getByText(/^Încheiat pe/), 'juniorul vede badge-ul').toBeVisible()
  } finally {
    await asJunior.context.close()
  }
  const asSenior = await login(browser, senior.email, PASSWORD)
  try {
    await asSenior.page.goto(`/projects/${projectId}`)
    await expect.soft(asSenior.page.getByRole('button', { name: 'Mai multe acțiuni' }), 'seniorul membru are meniul').toBeVisible({ timeout: 30_000 })
  } finally {
    await asSenior.context.close()
  }

  // Clientul: data, fără autor.
  const asClient = await login(browser, CONFIG.clientEmail, CONFIG.clientPassword)
  try {
    await asClient.page.goto(`/projects/${projectId}`)
    const clientBadge = asClient.page.getByText(/^Încheiat pe/)
    await expect(clientBadge).toBeVisible({ timeout: 30_000 })
    await expect.soft(clientBadge, 'clientul nu vede cine a încheiat').not.toContainText('· de')
    await expect.soft(asClient.page.getByRole('button', { name: 'Mai multe acțiuni' })).toHaveCount(0)
  } finally {
    await asClient.context.close()
  }
})

test('Interfața: faze, activități și cereri se finalizează din meniu și din fișă (D1, D2, D13, D14)', async ({ browser }) => {
  const projectId = await createProject('interfață faze')
  const phaseName = `Faza ${STAMP}`
  const activityName = `Activitatea ${STAMP}`
  const requestName = `Cererea ${STAMP}`
  const phaseId = await addPhase(projectId, phaseName)
  const activityId = await addActivity(projectId, phaseId, activityName)
  await addRequest(projectId, activityId, requestName)
  await publishEverything(projectId)
  const deepLink = `/projects/${projectId}?phase=${phaseId}&activity=${activityId}`

  const asAdmin = await login(browser, ADMIN_LOGIN.email, ADMIN_LOGIN.password)
  const page = asAdmin.page
  try {
    await page.goto(deepLink)
    // Panoul lateral are și el meniuri cu aceleași nume: căutăm în secțiunea fazei.
    const phaseSection = page.locator(`#phase-${phaseId}`)
    const phaseMenu = phaseSection.getByRole('button', { name: `Acțiuni pentru faza ${phaseName}` })
    await expect(phaseMenu).toBeVisible({ timeout: 30_000 })
    await expect.soft(phaseSection.getByText('0 din 1 activitate finalizată')).toBeVisible()

    // Faza: confirmarea spune că cererea rămâne deschisă (D2).
    await phaseMenu.click()
    await page.getByRole('menuitem', { name: 'Marchează faza ca finalizată' }).click()
    const confirmPhase = page.getByRole('dialog', { name: /Marchezi faza/ })
    await expect.soft(confirmPhase).toContainText('O activitate din ea nu e finalizată')
    await expect.soft(confirmPhase).toContainText('O cerere de documente e încă deschisă')
    await confirmPhase.getByRole('button', { name: 'Marchează ca finalizată' }).click()
    await expect(page.getByText('Faza a fost marcată ca finalizată.')).toBeVisible()
    await expect.soft(phaseSection.getByText('Finalizată', { exact: true }).first(), 'semnul pe faza finalizată').toBeVisible()
    await expect.soft(page.getByText(`${phaseName} (finalizată)`), 'panoul lateral marchează faza').toHaveCount(1)

    // Activitatea: semnul și contorul de cereri.
    await page.locator(`#activity-${activityId}`).getByRole('button', { name: `Acțiuni pentru activitatea ${activityName}` }).click()
    await page.getByRole('menuitem', { name: 'Marchează activitatea ca finalizată' }).click()
    await page.getByRole('dialog', { name: /Marchezi activitatea/ }).getByRole('button', { name: 'Marchează ca finalizată' }).click()
    await expect(page.getByText('Activitatea a fost marcată ca finalizată.')).toBeVisible()
    await expect.soft(page.locator(`#activity-${activityId}`).getByText('Finalizată', { exact: true })).toBeVisible()
    await expect.soft(page.locator(`#activity-${activityId}`).getByText('0 din 1 cerere finalizată')).toBeVisible()

    // Cererea: „Închide cererea" din fișă (D14), apoi fișa devine doar de citit (D13).
    await page.getByText(requestName, { exact: true }).first().click()
    const sheet = page.getByRole('dialog').filter({ hasText: requestName }).first()
    await sheet.getByRole('button', { name: 'Închide cererea' }).click()
    await page.getByRole('dialog', { name: /Închizi cererea/ }).getByRole('button', { name: 'Închide cererea' }).click()
    await expect(page.getByText('Cererea a fost închisă.')).toBeVisible()
    await expect.soft(sheet.getByText('Închisă', { exact: true })).toBeVisible()
    await expect.soft(sheet.getByRole('button', { name: 'Redeschide cererea' })).toBeVisible()
    await expect.soft(sheet.getByRole('button', { name: 'Atribuie' }), 'fișa închisă nu se modifică').toHaveCount(0)
    await page.keyboard.press('Escape')
    // Închisă, cererea e finalizată și se ascunde implicit (etapa 7); rândul ei se vede cu comutatorul.
    await expect.soft(page.locator(`#activity-${activityId}`).getByText('Singura cerere e finalizată.')).toBeVisible()
    await page.getByLabel('Arată și ce e finalizat').check()
    const requestRow = page.locator('[id^="request-"]').filter({ hasText: requestName })
    await expect.soft(requestRow.getByRole('button', { name: 'Modifică cererea' }), 'iconița „Modifică" dispare').toHaveCount(0)
    await expect.soft(requestRow.getByRole('button', { name: 'Șterge din proiect' }), 'ștergerea rămâne').toHaveCount(1)
    await expect.soft(page.locator(`#activity-${activityId}`).getByText('1 din 1 cerere finalizată')).toBeVisible()
  } finally {
    await asAdmin.context.close()
  }

  // Juniorul vede meniul fazei, dar fără finalizare (D1).
  const asJunior = await login(browser, junior.email, PASSWORD)
  try {
    await asJunior.page.goto(deepLink)
    const juniorMenu = asJunior.page.locator(`#phase-${phaseId}`).getByRole('button', { name: `Acțiuni pentru faza ${phaseName}` })
    await expect(juniorMenu).toBeVisible({ timeout: 30_000 })
    await juniorMenu.click()
    await expect.soft(asJunior.page.getByRole('menuitem', { name: 'Redenumește' })).toBeVisible()
    await expect.soft(asJunior.page.getByRole('menuitem', { name: /Readu faza în lucru|Marchează faza/ }), 'juniorul nu finalizează').toHaveCount(0)
    await asJunior.page.keyboard.press('Escape')
    await asJunior.page.getByLabel('Arată și ce e finalizat').check()
    await asJunior.page.getByText(requestName, { exact: true }).first().click()
    const sheet = asJunior.page.getByRole('dialog').filter({ hasText: requestName }).first()
    await expect(sheet).toBeVisible()
    await expect.soft(sheet.getByRole('button', { name: 'Redeschide cererea' }), 'juniorul nu redeschide').toHaveCount(0)
  } finally {
    await asJunior.context.close()
  }

  // Clientul: eticheta „Închisă" și explicația, fără zona de încărcare.
  const asClient = await login(browser, CONFIG.clientEmail, CONFIG.clientPassword)
  try {
    await asClient.page.goto(deepLink)
    // Și la client, ce e finalizat se ascunde implicit (D9).
    await asClient.page.getByLabel('Arată și ce e finalizat').check({ timeout: 30_000 })
    await expect(asClient.page.getByText('Consultantul a închis cererea; nu mai e nevoie să încarci nimic aici.').first()).toBeVisible({ timeout: 30_000 })
    const clientRow = asClient.page.locator('[id^="request-"]').filter({ hasText: requestName })
    await expect.soft(clientRow.getByText('Închisă', { exact: true })).toBeVisible()
    await expect.soft(clientRow.getByText('Încarcă fișiere'), 'fără zonă de încărcare').toHaveCount(0)
  } finally {
    await asClient.context.close()
  }
})

test('Interfața: ce e finalizat se ascunde, se arată la cerere și nu strică ordinea (A9, D9, D11)', async ({ browser }) => {
  const projectId = await createProject('ascundere')
  const phaseId = await addPhase(projectId, `Faza A ${STAMP}`)
  const doneActivity = `Activitate gata ${STAMP}`
  const openActivity = `Activitate în lucru ${STAMP}`
  const a1 = await addActivity(projectId, phaseId, doneActivity)
  const a2 = await addActivity(projectId, phaseId, openActivity)
  const r1 = await addRequest(projectId, a1, `Aprobată ${STAMP}`)
  const r2 = await addRequest(projectId, a2, `Deschisă 1 ${STAMP}`)
  const r3 = await addRequest(projectId, a2, `Închisă ${STAMP}`)
  const r4 = await addRequest(projectId, a2, `Aprobată 2 ${STAMP}`)
  const r5 = await addRequest(projectId, a2, `Deschisă 2 ${STAMP}`)
  for (const [i, id] of [r2, r3, r4, r5].entries()) {
    await service.from('document_requirements').update({ order_index: i + 1 }).eq('id', id)
  }
  await service.from('document_requirements').update({ status: 'approved' }).in('id', [r1, r4])
  await must(admin, 'POST', `/api/document-requests/${r3}/close`)
  await must(admin, 'POST', `/api/projects/${projectId}/phases/${phaseId}/activities/${a1}/complete`)
  await publishEverything(projectId)
  const browse = `/projects/${projectId}?phase=${phaseId}&activity=${a2}`

  const asAdmin = await login(browser, ADMIN_LOGIN.email, ADMIN_LOGIN.password)
  const page = asAdmin.page
  try {
    await page.goto(browse)
    const phase = page.locator(`#phase-${phaseId}`)
    const toggle = page.getByLabel('Arată și ce e finalizat')
    await expect(toggle).toBeVisible({ timeout: 30_000 })
    await expect.soft(toggle, 'implicit oprit').not.toBeChecked()
    // a1 (finalizată, cu cererea aprobată) se ascunde întreagă; din a2, cererile închisă și aprobată.
    await expect.soft(phase.getByText(doneActivity, { exact: true }), 'activitatea finalizată e ascunsă').toHaveCount(0)
    await expect.soft(phase.getByText('1 activitate finalizată ascunsă')).toBeVisible()
    await expect.soft(page.locator(`#activity-${a2}`).getByText('2 cereri finalizate ascunse')).toBeVisible()
    await expect.soft(page.locator(`#request-${r3}`)).toHaveCount(0)

    // Reordonarea printre cele vizibile: r5 trece înaintea lui r2, cele ascunse rămân pe loc.
    const reorder = page.waitForResponse(res => res.url().endsWith('/document-requests/reorder') && res.request().method() === 'POST')
    await page.locator(`#request-${r5}`).hover()
    await page.locator(`#request-${r5} [title="Trage pentru a reordona"]`).dragTo(page.locator(`#request-${r2}`))
    expect((await reorder).status()).toBe(200)
    const { data: ordered } = await service.from('document_requirements')
      .select('id, order_index').in('id', [r2, r3, r4, r5]).order('order_index')
    expect.soft((ordered ?? []).map(row => row.id), 'ordinea completă, cu cele ascunse pe loc').toEqual([r5, r3, r4, r2])

    // Comutatorul arată tot și își ține minte alegerea, pentru toate proiectele (D11).
    await toggle.check()
    await expect.soft(phase.getByText(doneActivity, { exact: true })).toBeVisible()
    await expect.soft(page.locator(`#request-${r3}`)).toBeVisible()
    await page.reload()
    await expect.soft(page.getByLabel('Arată și ce e finalizat'), 'alegerea rămâne după reîncărcare').toBeChecked({ timeout: 30_000 })
    await page.getByLabel('Arată și ce e finalizat').uncheck()

    // Deep-link spre o cerere aprobată, ascunsă: ținta și părinții ei se dezvăluie.
    await page.goto(`/projects/${projectId}?phase=${phaseId}&activity=${a1}&document=${r1}`)
    await expect(page.getByRole('dialog').filter({ hasText: `Aprobată ${STAMP}` }).first()).toBeVisible({ timeout: 30_000 })
    await page.keyboard.press('Escape')
    await expect.soft(page.locator(`#request-${r1}`), 'deep-link: cererea apare').toBeVisible()
    await expect.soft(page.locator(`#activity-${a1}`), 'deep-link: activitatea ei apare').toBeVisible()

    // Căutarea spre activitatea finalizată o dezvăluie și o arată ca finalizată.
    await page.goto(browse)
    await expect(page.locator(`#activity-${a2}`)).toBeVisible({ timeout: 30_000 })
    await expect.soft(page.locator(`#activity-${a1}`)).toHaveCount(0)
    await page.getByRole('button', { name: 'Caută în proiect' }).click()
    await page.getByPlaceholder('Caută faze, activități, cereri de documente...').fill(doneActivity)
    const result = page.getByRole('button', { name: new RegExp(doneActivity) }).first()
    await expect.soft(result).toContainText('Finalizată')
    await result.click()
    await expect.soft(page.locator(`#activity-${a1}`), 'căutarea dezvăluie activitatea').toBeVisible()
  } finally {
    await asAdmin.context.close()
  }

  // Clientul vede aceeași regulă, cu rândul celor ascunse (D9).
  const asClient = await login(browser, CONFIG.clientEmail, CONFIG.clientPassword)
  try {
    await asClient.page.goto(browse)
    await expect(asClient.page.locator(`#activity-${a2}`).getByText('2 cereri finalizate ascunse')).toBeVisible({ timeout: 30_000 })
    await asClient.page.locator(`#activity-${a2}`).getByRole('button', { name: /^Arată: 2 cereri finalizate ascunse/ }).click()
    await expect.soft(asClient.page.locator(`#request-${r3}`)).toBeVisible()
    await expect.soft(asClient.page.locator(`#request-${r3}`).getByText('Închisă', { exact: true })).toBeVisible()
  } finally {
    await asClient.context.close()
  }
})
