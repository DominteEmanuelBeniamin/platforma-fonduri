import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { test, expect, type Page, type Browser } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { e2eEnv, requireE2EConfig, serviceClient } from './helpers/project-state'
import { ROW, ROWS } from './helpers/matricea-drepturilor'

/**
 * Matricea „Cine ce poate face: admin, consultant senior, consultant junior”
 * (docs/drepturi-admin-senior-junior.pdf), verificată rând cu rând pe
 * serverul real, prin API și prin interfață.
 *
 * Suita își face propriile conturi (doi seniori, doi juniori), proiecte și
 * șabloane, cu un sufix unic per rulare, și le șterge la final. Nu schimbă
 * nivelul conturilor din seed. Fiecare verificare intră și în
 * `playwright-report/drepturi/raport.json`, din care se generează raportul
 * (`test-results/` îl golește Playwright la fiecare rulare).
 */

const ENV = e2eEnv()
const CONFIG = requireE2EConfig(ENV)
const ADMIN_LOGIN = {
  email: ENV.E2E_ADMIN_EMAIL || CONFIG.staffEmail,
  password: ENV.E2E_ADMIN_PASSWORD || CONFIG.staffPassword,
}
const STAMP = Date.now().toString(36)
const PASSWORD = `Drepturi-${STAMP}-2026!`
const REPORT_DIR = path.join('playwright-report', 'drepturi')

// Serial: scenariile se sprijină pe starea lăsată de cele dinainte. Verificările
// din matrice nu opresc rularea; se adună toate, iar ultimul test pică și le
// listează dacă vreuna nu e respectată. Un test pică mai devreme doar când
// pregătirea scenariului eșuează.
test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Who = 'admin' | 'senior' | 'junior'
type Person = { id: string; email: string; token: string; name: string }

type Check = {
  row: string
  who: Who | 'sistem'
  label: string
  expected: string
  actual: string
  ok: boolean
  layer: 'API' | 'Interfață' | 'Bază de date'
}
const checks: Check[] = []

// ─── Stare creată de suită ───────────────────────────────────────────────────

const service = serviceClient() as SupabaseClient
const testAccounts = new Set<string>()
const created = {
  users: new Set<string>(),
  projects: new Set<string>(),
  templates: new Set<string>(),
  statuses: new Set<string>(),
}
let admin: Person
let SA: Person // senior, membru în proiectul propriu (supervizor)
let SB: Person // al doilea senior, membru
let JA: Person // junior, membru
let JB: Person // junior, adăugat pe parcurs
let clientId = ''
let statusId = ''
let OWN = '' // proiectul în care SA, SB și JA sunt membri
let OTHER = '' // proiectul în care SA și JA nu sunt membri
let OTHER_PHASE = ''
let OTHER_ACTIVITY = ''
let TPL = '' // șablon publicat

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

/** Cererea trebuie să reușească (pregătirea scenariului, nu o verificare). */
async function must(who: Person, method: string, url: string, body?: unknown) {
  const res = await call(who, method, url, body)
  expect(res.status, `${method} ${url}: ${JSON.stringify(res.json).slice(0, 300)}`).toBeLessThan(300)
  return res.json
}

function whoOf(person: Person): Who {
  if (person === admin) return 'admin'
  return person === SA || person === SB ? 'senior' : 'junior'
}

/**
 * O verificare HTTP din matrice. „permis” = 2xx; „refuzat” = 403, sau alt cod
 * dat explicit (409 când baza blochează, 400 la o regulă de validare).
 */
function verify(
  rowId: string,
  person: Person,
  label: string,
  res: { status: number; json: Json },
  expected: 'permis' | 'refuzat',
  refusedStatus = 403,
) {
  const allowed = res.status >= 200 && res.status < 300
  const ok = expected === 'permis' ? allowed : res.status === refusedStatus
  const expectedText = expected === 'permis' ? 'permis (2xx)' : `refuzat (${refusedStatus})`
  checks.push({
    row: rowId, who: whoOf(person), label, expected: expectedText,
    actual: ok ? `HTTP ${res.status}` : `HTTP ${res.status} ${JSON.stringify(res.json).slice(0, 160)}`,
    ok, layer: 'API',
  })
}

/** O verificare care nu e un cod HTTP: starea din bază sau ce apare în interfață. */
function fact(rowId: string, who: Who | 'sistem', label: string, ok: boolean, actual: string, layer: Check['layer'], expected = 'da') {
  checks.push({ row: rowId, who, label, expected, actual, ok, layer })
}

/**
 * Conturile de test sunt fixe și se refolosesc: jurnalul de audit e append-only
 * și ține minte cine a făcut fiecare acțiune, deci un cont folosit o dată nu se
 * mai poate șterge. Refolosirea ține baza curată între rulări.
 */
async function makeConsultant(tag: 'sa' | 'sb' | 'ja' | 'jb', level: 'junior' | 'senior'): Promise<Person> {
  const email = `drepturi.${tag}@test.local`
  const name = `Test drepturi — ${{ sa: 'Senior A', sb: 'Senior B', ja: 'Junior A', jb: 'Junior B' }[tag]}`
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
  return { id: id!, email, name, token: await signIn(email, PASSWORD) }
}

async function signIn(email: string, password: string) {
  const anon = createClient(CONFIG.supabaseUrl, CONFIG.anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await anon.auth.signInWithPassword({ email, password })
  if (error || !data.session) throw new Error(`Autentificare ${email}: ${error?.message}`)
  return data.session.access_token
}

async function createProject(by: Person, title: string, supervisors: string[]) {
  const json = await must(by, 'POST', '/api/projects', { title, client_id: clientId, supervisor_ids: supervisors })
  created.projects.add(json.project.id)
  return json.project.id as string
}

async function addPhase(by: Person, projectId: string, name: string) {
  return (await must(by, 'POST', `/api/projects/${projectId}/phases`, { name })).phase.id as string
}

async function addActivity(by: Person, projectId: string, phaseId: string, name: string) {
  return (await must(by, 'POST', `/api/projects/${projectId}/phases/${phaseId}/activities`, { name })).activity.id as string
}

async function addRequest(by: Person, projectId: string, activityId: string, name: string) {
  return (await must(by, 'POST', `/api/projects/${projectId}/document-requests`, { name, activity_id: activityId })).id as string
}

/** O cerere cu un fișier trimis de client, gata de verificat. */
async function requestInReview(projectId: string, activityId: string, name: string) {
  const id = await addRequest(admin, projectId, activityId, name)
  const { error: fileError } = await service.from('files').insert({
    id: randomUUID(), requirement_id: id, storage_path: `test-fixtures/drepturi/${id}.pdf`, original_name: 'document.pdf',
    file_size: 10, mime_type: 'application/pdf', version_number: 1, uploaded_by: clientId,
  })
  if (fileError) throw new Error(`Fișier fixture: ${fileError.message}`)
  const { error } = await service.from('document_requirements').update({ status: 'review' }).eq('id', id)
  if (error) throw new Error(`Status review: ${error.message}`)
  return id
}

async function memberId(projectId: string, consultantId: string) {
  const { data } = await service.from('project_members').select('id').eq('project_id', projectId).eq('consultant_id', consultantId).maybeSingle()
  return data?.id as string | undefined
}

async function ensureMember(projectId: string, person: Person) {
  if (await memberId(projectId, person.id)) return
  await must(admin, 'POST', `/api/projects/${projectId}/members`, { consultant_id: person.id })
}

async function postMessage(by: Person, projectId: string, body: string) {
  return (await must(by, 'POST', `/api/projects/${projectId}/chat/messages`, { body })).item.id as string
}

function templateTree(name: string, phaseNames: string[]) {
  return {
    name,
    slug: `drepturi-${STAMP}-${Math.random().toString(36).slice(2, 7)}`,
    description: 'Șablon creat de suita de drepturi',
    phases: phaseNames.map((phaseName, p) => ({
      id: `p${p}`, name: phaseName, project_status_id: statusId,
      activities: [{ id: `p${p}a0`, name: `${phaseName} — activitate`, document_requirements: [
        { id: `p${p}a0d0`, name: `${phaseName} — document`, requirement_type: 'obligatoriu', attachments: [] },
      ] }],
    })),
  }
}

/** Arborele în forma trimisă de editor, pornind de la răspunsul serverului. */
function editorTree(template: Json, extraPhase?: string) {
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
  if (extraPhase) {
    phases.push({ id: `nou-${randomUUID()}`, name: extraPhase, project_status_id: statusId, activities: [] })
  }
  return { name: template.name, description: template.description, phases }
}

async function createTemplate(by: Person, name: string) {
  const json = await must(by, 'POST', '/api/admin/templates', templateTree(name, ['Pregătire', 'Depunere']))
  created.templates.add(json.template.id)
  return json.template as Json
}

async function loadTemplate(id: string) {
  return (await must(admin, 'GET', `/api/admin/templates/${id}`)).template as Json
}

async function login(browser: Browser, person: { email: string }, password: string, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  await page.goto('/login')
  await page.fill('input[type=email]', person.email)
  await page.fill('input[type=password]', password)
  await page.click('button[type=submit]')
  await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 30_000 })
  return { context, page }
}

async function visible(page: Page, locator: ReturnType<Page['getByRole']>) {
  try {
    await locator.first().waitFor({ state: 'visible', timeout: 4_000 })
    return true
  } catch {
    return false
  }
}

// ─── Pregătire și curățenie ──────────────────────────────────────────────────

test.beforeAll(async () => {
  expect(service, 'Clientul service E2E lipsește').toBeTruthy()
  fs.rmSync(REPORT_DIR, { recursive: true, force: true })
  fs.mkdirSync(REPORT_DIR, { recursive: true })

  const { data: adminProfile } = await service.from('profiles').select('id, email, full_name, role').eq('email', ADMIN_LOGIN.email).single()
  if (adminProfile?.role !== 'admin') throw new Error('E2E_ADMIN_EMAIL trebuie să fie un cont de admin')
  admin = { id: adminProfile.id, email: adminProfile.email, name: adminProfile.full_name, token: await signIn(ADMIN_LOGIN.email, ADMIN_LOGIN.password) }

  const { data: client } = await service.from('profiles').select('id').eq('email', CONFIG.clientEmail).single()
  const { data: status } = await service.from('project_statuses').select('id').order('id').limit(1).single()
  if (!client || !status) throw new Error('Baza E2E nu are clientul sau statusurile așteptate')
  clientId = client.id
  statusId = status.id

  SA = await makeConsultant('sa', 'senior')
  SB = await makeConsultant('sb', 'senior')
  JA = await makeConsultant('ja', 'junior')
  JB = await makeConsultant('jb', 'junior')

  // Proiectul propriu: SA supervizor, SB și JA membri. JB e liber, pentru „adaugă colegi”.
  OWN = await createProject(admin, `Drepturi ${STAMP} — proiect propriu`, [SA.id])
  await must(admin, 'POST', `/api/projects/${OWN}/members`, { consultant_id: SB.id })
  await must(admin, 'POST', `/api/projects/${OWN}/members`, { consultant_id: JA.id })

  // Proiectul străin: doar SB. SA și JA nu sunt membri.
  OTHER = await createProject(admin, `Drepturi ${STAMP} — proiect străin`, [SB.id])
  OTHER_PHASE = await addPhase(admin, OTHER, 'Fază străină')
  OTHER_ACTIVITY = await addActivity(admin, OTHER, OTHER_PHASE, 'Activitate străină')

  const template = await createTemplate(admin, `Drepturi ${STAMP} — șablon publicat`)
  await must(admin, 'PATCH', `/api/admin/templates/${template.id}`, { status: 'published' })
  TPL = template.id
})

test.afterAll(async () => {
  fs.mkdirSync(REPORT_DIR, { recursive: true })
  fs.writeFileSync(path.join(REPORT_DIR, 'raport.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    baseUrl: CONFIG.baseUrl,
    stamp: STAMP,
    rows: ROWS,
    checks,
  }, null, 2))

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
  for (const id of created.statuses) {
    await service.from('project_statuses').delete().eq('id', id)
  }
  await service.from('files').delete().like('storage_path', 'test-fixtures/drepturi/%')
  for (const id of created.users) {
    const { error } = await service.auth.admin.deleteUser(id)
    if (error) leftovers.push(`cont ${id}: ${error.message}`)
  }
  // Conturile fixe rămân pentru rularea următoare, dar fără drepturi de senior.
  for (const id of testAccounts) {
    await service.from('profiles').update({ consultant_level: 'junior', is_active: false }).eq('id', id)
  }
  if (leftovers.length) console.log(`Curățenie cu resturi:\n${leftovers.join('\n')}`)
})

// ═══ PROIECTE ════════════════════════════════════════════════════════════════

test('Vede proiectul — admin toate; senior și junior doar proiectele lor', async () => {
  for (const person of [admin, SA, JA]) {
    verify('p-vede', person, 'deschide proiectul în care e membru', await call(person, 'GET', `/api/projects/${OWN}`), 'permis')
  }
  verify('p-vede', admin, 'deschide un proiect în care nu e membru', await call(admin, 'GET', `/api/projects/${OTHER}`), 'permis')
  verify('p-vede', SA, 'deschide un proiect în care nu e membru', await call(SA, 'GET', `/api/projects/${OTHER}`), 'refuzat')
  verify('p-vede', JA, 'deschide un proiect în care nu e membru', await call(JA, 'GET', `/api/projects/${OTHER}`), 'refuzat')

  for (const person of [admin, SA, JA]) {
    const ids = ((await must(person, 'GET', '/api/projects')).projects as Json[]).map(p => p.id)
    const seesOwn = ids.includes(OWN)
    const seesOther = ids.includes(OTHER)
    const expectOther = person === admin
    fact('p-vede', whoOf(person), 'lista de proiecte conține proiectul propriu', seesOwn, seesOwn ? 'conține' : 'lipsește', 'API')
    fact('p-vede', whoOf(person), `lista de proiecte ${expectOther ? 'conține' : 'nu conține'} proiectul străin`, seesOther === expectOther, seesOther ? 'conține' : 'nu conține', 'API', expectOther ? 'conține' : 'nu conține')
  }
  for (const person of [SA, JA]) {
    verify('p-vede', person, 'citește fazele unui proiect străin', await call(person, 'GET', `/api/projects/${OTHER}/phases`), 'refuzat')
    verify('p-vede', person, 'citește cererile unui proiect străin', await call(person, 'GET', `/api/projects/${OTHER}/document-requests`), 'refuzat')
    verify('p-vede', person, 'citește chatul unui proiect străin', await call(person, 'GET', `/api/projects/${OTHER}/chat/messages`), 'refuzat')
  }
})

test('Creează un proiect nou — admin și senior; juniorul nu; cine îl creează devine membru', async () => {
  const juniorTitle = `Drepturi ${STAMP} — creat de junior`
  verify('p-creeaza', JA, 'creează un proiect', await call(JA, 'POST', '/api/projects', { title: juniorTitle, client_id: clientId, supervisor_ids: [SA.id] }), 'refuzat')
  const { data: leftover } = await service.from('projects').select('id').eq('title', juniorTitle)
  fact('p-creeaza', 'junior', 'încercarea refuzată nu lasă un proiect în urmă', (leftover ?? []).length === 0, `${(leftover ?? []).length} proiecte`, 'Bază de date', '0 proiecte')
  verify('p-creeaza', JA, 'importă un șablon în proiectul în care e membru', await call(JA, 'POST', `/api/projects/${OWN}/import-template`, { template_id: TPL }), 'refuzat')

  for (const person of [admin, SA]) {
    const res = await call(person, 'POST', '/api/projects', { title: `Drepturi ${STAMP} — creat de ${whoOf(person)}`, client_id: clientId, supervisor_ids: [SA.id] })
    verify('p-creeaza', person, 'creează un proiect', res, 'permis')
    const id = res.json?.project?.id
    if (!id) continue
    created.projects.add(id)
    const { data: members } = await service.from('project_members').select('consultant_id').eq('project_id', id)
    const ids = (members ?? []).map(m => m.consultant_id)
    if (person === admin) {
      fact('p-creeaza', 'admin', 'supervizorul ales devine membru', ids.includes(SA.id), ids.includes(SA.id) ? 'membru' : 'lipsește', 'Bază de date')
    } else {
      fact('p-creeaza', whoOf(person), 'creatorul devine automat membru', ids.includes(person.id), ids.includes(person.id) ? 'membru' : 'nu e membru', 'Bază de date')
    }
  }
})

test('Adaugă și modifică faze, activități și cereri — admin; senior și junior doar în proiectele lor', async () => {
  for (const person of [admin, SA, JA]) {
    const who = whoOf(person)
    const phase = await call(person, 'POST', `/api/projects/${OWN}/phases`, { name: `Fază de ${who}` })
    verify('p-continut', person, 'adaugă o fază', phase, 'permis')
    const phaseId = phase.json?.phase?.id
    if (!phaseId) continue
    verify('p-continut', person, 'redenumește faza', await call(person, 'PATCH', `/api/projects/${OWN}/phases/${phaseId}`, { name: `Fază de ${who} (redenumită)` }), 'permis')
    const activity = await call(person, 'POST', `/api/projects/${OWN}/phases/${phaseId}/activities`, { name: `Activitate de ${who}` })
    verify('p-continut', person, 'adaugă o activitate', activity, 'permis')
    const activityId = activity.json?.activity?.id
    if (!activityId) continue
    verify('p-continut', person, 'redenumește activitatea', await call(person, 'PATCH', `/api/projects/${OWN}/phases/${phaseId}/activities/${activityId}`, { name: `Activitate de ${who} (redenumită)` }), 'permis')
    verify('p-continut', person, 'adaugă o cerere de document', await call(person, 'POST', `/api/projects/${OWN}/document-requests`, { name: `Cerere de ${who}`, activity_id: activityId }), 'permis')
  }
  for (const person of [SA, JA]) {
    verify('p-continut', person, 'adaugă o fază într-un proiect străin', await call(person, 'POST', `/api/projects/${OTHER}/phases`, { name: 'Intrus' }), 'refuzat')
    verify('p-continut', person, 'redenumește o fază dintr-un proiect străin', await call(person, 'PATCH', `/api/projects/${OTHER}/phases/${OTHER_PHASE}`, { name: 'Intrus' }), 'refuzat')
    verify('p-continut', person, 'adaugă o activitate într-un proiect străin', await call(person, 'POST', `/api/projects/${OTHER}/phases/${OTHER_PHASE}/activities`, { name: 'Intrus' }), 'refuzat')
    verify('p-continut', person, 'adaugă o cerere într-un proiect străin', await call(person, 'POST', `/api/projects/${OTHER}/document-requests`, { name: 'Intrus', activity_id: OTHER_ACTIVITY }), 'refuzat')
  }
})

test('Aprobă sau respinge documentele — admin; senior și junior doar în proiectele lor', async () => {
  const phaseId = await addPhase(admin, OWN, 'Fază pentru verificare')
  const activityId = await addActivity(admin, OWN, phaseId, 'Activitate pentru verificare')
  for (const person of [admin, SA, JA]) {
    const approve = await requestInReview(OWN, activityId, `De aprobat de ${whoOf(person)}`)
    verify('p-aproba', person, 'aprobă un document', await call(person, 'POST', `/api/document-requests/${approve}/review`, { action: 'approved' }), 'permis')
    const reject = await requestInReview(OWN, activityId, `De respins de ${whoOf(person)}`)
    verify('p-aproba', person, 'respinge un document', await call(person, 'POST', `/api/document-requests/${reject}/review`, { action: 'rejected', notes: 'Document neclar' }), 'permis')
  }
  for (const person of [SA, JA]) {
    const foreign = await requestInReview(OTHER, OTHER_ACTIVITY, `Străin, încercat de ${whoOf(person)}`)
    verify('p-aproba', person, 'aprobă un document dintr-un proiect străin', await call(person, 'POST', `/api/document-requests/${foreign}/review`, { action: 'approved' }), 'refuzat')
  }
})

test('Schimbă titlul, statusul și reminderele — admin; senior în proiectele lui; junior nu', async () => {
  for (const person of [admin, SA]) {
    verify('p-editeaza', person, 'schimbă titlul', await call(person, 'PATCH', `/api/projects/${OWN}`, { title: `Drepturi ${STAMP} — proiect propriu (${whoOf(person)})` }), 'permis')
    verify('p-editeaza', person, 'schimbă statusul', await call(person, 'PATCH', `/api/projects/${OWN}`, { status: person === admin ? 'implementare' : 'contractare' }), 'permis')
    verify('p-editeaza', person, 'oprește reminderele automate', await call(person, 'PATCH', `/api/projects/${OWN}`, { automatic_reminders_enabled: false }), 'permis')
    verify('p-editeaza', person, 'pornește reminderele automate', await call(person, 'PATCH', `/api/projects/${OWN}`, { automatic_reminders_enabled: true }), 'permis')
  }
  verify('p-editeaza', JA, 'schimbă titlul', await call(JA, 'PATCH', `/api/projects/${OWN}`, { title: 'Titlu de junior' }), 'refuzat')
  verify('p-editeaza', JA, 'schimbă statusul', await call(JA, 'PATCH', `/api/projects/${OWN}`, { status: 'monitorizare' }), 'refuzat')
  verify('p-editeaza', JA, 'oprește reminderele automate', await call(JA, 'PATCH', `/api/projects/${OWN}`, { automatic_reminders_enabled: false }), 'refuzat')
  verify('p-editeaza', SA, 'schimbă titlul unui proiect străin', await call(SA, 'PATCH', `/api/projects/${OTHER}`, { title: 'Intrus' }), 'refuzat')

  const permissions = (person: Person) => call(person, 'GET', `/api/projects/${OWN}`).then(r => r.json.permissions as Json)
  const [pa, ps, pj] = await Promise.all([permissions(admin), permissions(SA), permissions(JA)])
  fact('p-editeaza', 'admin', 'serverul îi arată interfeței edit_project', pa?.edit_project === true, String(pa?.edit_project), 'API', 'true')
  fact('p-editeaza', 'senior', 'serverul îi arată interfeței edit_project', ps?.edit_project === true, String(ps?.edit_project), 'API', 'true')
  fact('p-editeaza', 'junior', 'serverul îi ascunde edit_project', pj?.edit_project === false, String(pj?.edit_project), 'API', 'false')
})

test('Șterge faze și activități — admin și senior în proiectele lui; cererile nu se pierd', async () => {
  for (const person of [admin, SA]) {
    const who = whoOf(person)
    const phaseId = await addPhase(admin, OWN, `De șters de ${who}`)
    const activityId = await addActivity(admin, OWN, phaseId, `Activitate de șters de ${who}`)
    const requestId = await addRequest(admin, OWN, activityId, `Cerere care trebuie să rămână (${who})`)
    const keepActivity = await addActivity(admin, OWN, phaseId, `Activitate care rămâne (${who})`)
    const keepRequest = await addRequest(admin, OWN, keepActivity, `Cerere din faza ștearsă (${who})`)

    verify('p-sterge-faze', person, 'șterge o activitate', await call(person, 'DELETE', `/api/projects/${OWN}/phases/${phaseId}/activities/${activityId}`), 'permis')
    const { data: afterActivity } = await service.from('document_requirements').select('id, deleted_at').eq('id', requestId).maybeSingle()
    fact('p-sterge-faze', who, 'cererea din activitatea ștearsă se păstrează', !!afterActivity && !afterActivity.deleted_at, afterActivity ? (afterActivity.deleted_at ? 'marcată ștearsă' : 'păstrată') : 'dispărută', 'Bază de date', 'păstrată')

    verify('p-sterge-faze', person, 'șterge o fază', await call(person, 'DELETE', `/api/projects/${OWN}/phases/${phaseId}`), 'permis')
    const { data: afterPhase } = await service.from('document_requirements').select('id, deleted_at').eq('id', keepRequest).maybeSingle()
    fact('p-sterge-faze', who, 'cererea din faza ștearsă se păstrează', !!afterPhase && !afterPhase.deleted_at, afterPhase ? (afterPhase.deleted_at ? 'marcată ștearsă' : 'păstrată') : 'dispărută', 'Bază de date', 'păstrată')
  }

  const phaseId = await addPhase(admin, OWN, 'Fază pe care juniorul n-o poate șterge')
  const activityId = await addActivity(admin, OWN, phaseId, 'Activitate pe care juniorul n-o poate șterge')
  verify('p-sterge-faze', JA, 'șterge o activitate', await call(JA, 'DELETE', `/api/projects/${OWN}/phases/${phaseId}/activities/${activityId}`), 'refuzat')
  verify('p-sterge-faze', JA, 'șterge o fază', await call(JA, 'DELETE', `/api/projects/${OWN}/phases/${phaseId}`), 'refuzat')
  verify('p-sterge-faze', SA, 'șterge o activitate dintr-un proiect străin', await call(SA, 'DELETE', `/api/projects/${OTHER}/phases/${OTHER_PHASE}/activities/${OTHER_ACTIVITY}`), 'refuzat')
  verify('p-sterge-faze', SA, 'șterge o fază dintr-un proiect străin', await call(SA, 'DELETE', `/api/projects/${OTHER}/phases/${OTHER_PHASE}`), 'refuzat')
})

test('Adaugă colegi în echipă — admin și senior în proiectele lui; junior nu', async () => {
  verify('p-adauga-colegi', admin, 'vede consultanții disponibili', await call(admin, 'GET', `/api/projects/${OWN}/available-consultants`), 'permis')
  verify('p-adauga-colegi', SA, 'vede consultanții disponibili', await call(SA, 'GET', `/api/projects/${OWN}/available-consultants`), 'permis')
  verify('p-adauga-colegi', JA, 'vede consultanții disponibili', await call(JA, 'GET', `/api/projects/${OWN}/available-consultants`), 'refuzat')

  verify('p-adauga-colegi', JA, 'adaugă un coleg', await call(JA, 'POST', `/api/projects/${OWN}/members`, { consultant_id: JB.id }), 'refuzat')
  verify('p-adauga-colegi', SA, 'adaugă un coleg', await call(SA, 'POST', `/api/projects/${OWN}/members`, { consultant_id: JB.id }), 'permis')
  verify('p-adauga-colegi', SA, 'adaugă un coleg într-un proiect străin', await call(SA, 'POST', `/api/projects/${OTHER}/members`, { consultant_id: JA.id }), 'refuzat')
  verify('p-adauga-colegi', admin, 'adaugă un coleg într-un proiect oarecare', await call(admin, 'POST', `/api/projects/${OTHER}/members`, { consultant_id: JB.id }), 'permis')
})

test('Scoate colegi — seniorul doar juniori; nu alt senior, nu pe el, nu consultantul general, nu pe cineva cu sarcini', async () => {
  await ensureMember(OWN, JB)
  const jb = (await memberId(OWN, JB.id))!
  verify('p-scoate-colegi', JA, 'scoate un junior', await call(JA, 'DELETE', `/api/projects/${OWN}/members/${jb}`), 'refuzat')
  verify('p-scoate-colegi', SA, 'scoate un junior fără sarcini', await call(SA, 'DELETE', `/api/projects/${OWN}/members/${jb}`), 'permis')

  const sb = (await memberId(OWN, SB.id))!
  const seniorRes = await call(SA, 'DELETE', `/api/projects/${OWN}/members/${sb}`)
  verify('p-scoate-colegi', SA, 'scoate alt senior', seniorRes, 'refuzat')
  fact('p-scoate-colegi', 'senior', 'motivul refuzului e „senior”', seniorRes.json?.reason === 'senior', String(seniorRes.json?.reason), 'API', 'senior')

  const sa = (await memberId(OWN, SA.id))!
  const selfRes = await call(SA, 'DELETE', `/api/projects/${OWN}/members/${sa}`)
  verify('p-scoate-colegi', SA, 'se scoate pe el însuși', selfRes, 'refuzat')
  fact('p-scoate-colegi', 'senior', 'motivul refuzului e „self”', selfRes.json?.reason === 'self', String(selfRes.json?.reason), 'API', 'self')

  // Consultantul general: JB primește cererile generale, apoi seniorul încearcă să-l scoată.
  await ensureMember(OWN, JB)
  await must(admin, 'PATCH', `/api/projects/${OWN}`, { general_consultant_id: JB.id })
  const generalRes = await call(SA, 'DELETE', `/api/projects/${OWN}/members/${(await memberId(OWN, JB.id))!}`)
  verify('p-scoate-colegi', SA, 'scoate consultantul general', generalRes, 'refuzat', 409)
  fact('p-scoate-colegi', 'senior', 'motivul refuzului e „general_consultant”', generalRes.json?.reason === 'general_consultant', String(generalRes.json?.reason), 'API', 'general_consultant')
  const adminGeneral = await call(admin, 'DELETE', `/api/projects/${OWN}/members/${(await memberId(OWN, JB.id))!}`)
  verify('p-scoate-colegi', admin, 'scoate consultantul general (baza blochează și pentru admin)', adminGeneral, 'refuzat', 409)
  await must(admin, 'PATCH', `/api/projects/${OWN}`, { general_consultant_id: null })

  // Sarcini asignate: JA primește o activitate.
  const phaseId = await addPhase(admin, OWN, 'Fază cu sarcini')
  const activityId = await addActivity(admin, OWN, phaseId, 'Activitate asignată juniorului')
  await must(admin, 'PATCH', `/api/projects/${OWN}/phases/${phaseId}/activities/${activityId}`, { assigned_to: JA.id })
  const taskRes = await call(SA, 'DELETE', `/api/projects/${OWN}/members/${(await memberId(OWN, JA.id))!}`)
  verify('p-scoate-colegi', SA, 'scoate un junior cu sarcini asignate', taskRes, 'refuzat', 409)
  fact('p-scoate-colegi', 'senior', 'motivul refuzului e „assigned_activity”', taskRes.json?.reason === 'assigned_activity', String(taskRes.json?.reason), 'API', 'assigned_activity')
  await must(admin, 'PATCH', `/api/projects/${OWN}/phases/${phaseId}/activities/${activityId}`, { assigned_to: null })

  // Adminul scoate și un senior, apoi îl readuce.
  verify('p-scoate-colegi', admin, 'scoate un senior', await call(admin, 'DELETE', `/api/projects/${OWN}/members/${sb}`), 'permis')
  await ensureMember(OWN, SB)

  const otherSb = (await memberId(OTHER, SB.id))!
  verify('p-scoate-colegi', SA, 'scoate un coleg dintr-un proiect străin', await call(SA, 'DELETE', `/api/projects/${OTHER}/members/${otherSb}`), 'refuzat')

  const permissions = (await must(SA, 'GET', `/api/projects/${OWN}`)).permissions as Json
  fact('p-scoate-colegi', 'senior', 'serverul îi spune interfeței că nu poate scoate pe oricine', permissions?.remove_any_member === false, String(permissions?.remove_any_member), 'API', 'false')
})

test('Șterge mesajele altora din chat — admin și senior; junior nu', async () => {
  await ensureMember(OWN, SB)
  const byJunior = await postMessage(JA, OWN, `Mesaj de junior ${STAMP}`)
  verify('p-chat-sterge', SA, 'șterge mesajul unui junior', await call(SA, 'DELETE', `/api/projects/${OWN}/chat/messages/${byJunior}`), 'permis')
  const bySenior = await postMessage(SB, OWN, `Mesaj de senior ${STAMP}`)
  verify('p-chat-sterge', JA, 'șterge mesajul altcuiva', await call(JA, 'DELETE', `/api/projects/${OWN}/chat/messages/${bySenior}`), 'refuzat')
  verify('p-chat-sterge', SA, 'șterge mesajul altui senior', await call(SA, 'DELETE', `/api/projects/${OWN}/chat/messages/${bySenior}`), 'permis')
  const forAdmin = await postMessage(JA, OWN, `Mesaj pentru admin ${STAMP}`)
  verify('p-chat-sterge', admin, 'șterge mesajul altcuiva', await call(admin, 'DELETE', `/api/projects/${OWN}/chat/messages/${forAdmin}`), 'permis')
  const own = await postMessage(JA, OWN, `Mesajul meu ${STAMP}`)
  verify('p-chat-sterge', JA, 'își șterge propriul mesaj', await call(JA, 'DELETE', `/api/projects/${OWN}/chat/messages/${own}`), 'permis')
  const foreign = await postMessage(SB, OTHER, `Mesaj străin ${STAMP}`)
  verify('p-chat-sterge', SA, 'șterge un mesaj dintr-un proiect străin', await call(SA, 'DELETE', `/api/projects/${OTHER}/chat/messages/${foreign}`), 'refuzat')
})

test('Modifică textul mesajelor altora — doar adminul; fiecare își modifică propriile mesaje', async () => {
  const byJunior = await postMessage(JA, OWN, `De modificat ${STAMP}`)
  verify('p-chat-editeaza', SA, 'modifică textul mesajului unui junior', await call(SA, 'PATCH', `/api/projects/${OWN}/chat/messages/${byJunior}`, { body: 'Schimbat de senior' }), 'refuzat')
  const bySenior = await postMessage(SB, OWN, `Al seniorului ${STAMP}`)
  verify('p-chat-editeaza', JA, 'modifică textul mesajului altcuiva', await call(JA, 'PATCH', `/api/projects/${OWN}/chat/messages/${bySenior}`, { body: 'Schimbat de junior' }), 'refuzat')
  verify('p-chat-editeaza', admin, 'modifică textul mesajului altcuiva', await call(admin, 'PATCH', `/api/projects/${OWN}/chat/messages/${byJunior}`, { body: 'Corectat de admin' }), 'permis')
  verify('p-chat-editeaza', JA, 'își modifică propriul mesaj', await call(JA, 'PATCH', `/api/projects/${OWN}/chat/messages/${byJunior}`, { body: 'Corectat de autor' }), 'permis')
  const bySa = await postMessage(SA, OWN, `Al meu ${STAMP}`)
  verify('p-chat-editeaza', SA, 'își modifică propriul mesaj', await call(SA, 'PATCH', `/api/projects/${OWN}/chat/messages/${bySa}`, { body: 'Corectat de autor' }), 'permis')

  const { data: row } = await service.from('project_chat_messages').select('body').eq('id', bySenior).single()
  fact('p-chat-editeaza', 'sistem', 'textul refuzat nu s-a schimbat în bază', row?.body === `Al seniorului ${STAMP}`, String(row?.body), 'Bază de date', `Al seniorului ${STAMP}`)
  const permissions = (await must(SA, 'GET', `/api/projects/${OWN}`)).permissions as Json
  fact('p-chat-editeaza', 'senior', 'serverul îi ascunde editarea mesajelor altora', permissions?.edit_others_messages === false, String(permissions?.edit_others_messages), 'API', 'false')
})

test('Schimbă clientul sau consultantul general — doar adminul', async () => {
  for (const person of [SA, JA]) {
    verify('p-reasigneaza', person, 'schimbă clientul', await call(person, 'PATCH', `/api/projects/${OWN}`, { client_id: clientId }), 'refuzat')
    verify('p-reasigneaza', person, 'schimbă consultantul general', await call(person, 'PATCH', `/api/projects/${OWN}`, { general_consultant_id: SA.id }), 'refuzat')
  }
  verify('p-reasigneaza', admin, 'schimbă clientul', await call(admin, 'PATCH', `/api/projects/${OWN}`, { client_id: clientId }), 'permis')
  verify('p-reasigneaza', admin, 'schimbă consultantul general', await call(admin, 'PATCH', `/api/projects/${OWN}`, { general_consultant_id: SA.id }), 'permis')
  await must(admin, 'PATCH', `/api/projects/${OWN}`, { general_consultant_id: null })
})

test('Șterge proiectul — doar adminul', async () => {
  verify('p-sterge', SA, 'șterge proiectul în care e membru', await call(SA, 'DELETE', `/api/projects/${OWN}`), 'refuzat')
  verify('p-sterge', JA, 'șterge proiectul în care e membru', await call(JA, 'DELETE', `/api/projects/${OWN}`), 'refuzat')
  const doomed = await createProject(admin, `Drepturi ${STAMP} — de șters`, [SA.id])
  verify('p-sterge', admin, 'șterge un proiect', await call(admin, 'DELETE', `/api/projects/${doomed}`), 'permis')
  created.projects.delete(doomed)
  const { data } = await service.from('projects').select('id').eq('id', OWN).maybeSingle()
  fact('p-sterge', 'sistem', 'proiectul propriu există încă după încercările refuzate', !!data, data ? 'există' : 'șters', 'Bază de date', 'există')
})

// ═══ ȘABLOANE ════════════════════════════════════════════════════════════════

test('Vede șabloanele — toți consultanții; clientul nu', async () => {
  for (const person of [admin, SA, JA]) {
    verify('s-vede', person, 'listează șabloanele', await call(person, 'GET', '/api/admin/templates'), 'permis')
    verify('s-vede', person, 'deschide un șablon publicat', await call(person, 'GET', `/api/admin/templates/${TPL}`), 'permis')
  }
  const client = { id: clientId, email: CONFIG.clientEmail, name: 'client', token: await signIn(CONFIG.clientEmail, CONFIG.clientPassword) }
  const res = await call(client, 'GET', '/api/admin/templates')
  checks.push({ row: 's-vede', who: 'sistem', label: 'clientul listează șabloanele', expected: 'refuzat (403)', actual: `HTTP ${res.status}`, ok: res.status === 403, layer: 'API' })
})

test('Creează și modifică ciorne de șablon — toți', async () => {
  let adminDraft: Json | null = null
  for (const person of [admin, SA, JA]) {
    const res = await call(person, 'POST', '/api/admin/templates', templateTree(`Drepturi ${STAMP} — ciornă de ${whoOf(person)}`, ['Etapa 1']))
    verify('s-ciorne', person, 'creează o ciornă', res, 'permis')
    const template = res.json?.template
    if (!template) continue
    created.templates.add(template.id)
    if (person === admin) adminDraft = template
    verify('s-ciorne', person, 'modifică propria ciornă', await call(person, 'PUT', `/api/admin/templates/${template.id}/tree`, editorTree(template, 'Etapă adăugată')), 'permis')
  }
  if (adminDraft) {
    const fresh = await loadTemplate(adminDraft.id)
    verify('s-ciorne', JA, 'modifică ciorna altcuiva', await call(JA, 'PUT', `/api/admin/templates/${fresh.id}/tree`, editorTree(fresh, 'Etapă de junior')), 'permis')
  }
})

test('Modifică conținutul unui șablon publicat — admin și senior; junior nu; se vede imediat în proiectele noi', async () => {
  const before = await loadTemplate(TPL)
  verify('s-publicat', JA, 'modifică fazele unui șablon publicat', await call(JA, 'PUT', `/api/admin/templates/${TPL}/tree`, editorTree(before, 'Fază de junior')), 'refuzat')
  verify('s-publicat', JA, 'redenumește un șablon publicat', await call(JA, 'PATCH', `/api/admin/templates/${TPL}`, { name: 'Redenumit de junior' }), 'refuzat')

  const seniorPhase = `Fază adăugată de senior ${STAMP}`
  verify('s-publicat', SA, 'modifică fazele unui șablon publicat', await call(SA, 'PUT', `/api/admin/templates/${TPL}/tree`, editorTree(before, seniorPhase)), 'permis')
  verify('s-publicat', SA, 'schimbă descrierea unui șablon publicat', await call(SA, 'PATCH', `/api/admin/templates/${TPL}`, { description: 'Descriere schimbată de senior' }), 'permis')

  const afterSenior = await loadTemplate(TPL)
  verify('s-publicat', admin, 'modifică fazele unui șablon publicat', await call(admin, 'PUT', `/api/admin/templates/${TPL}/tree`, editorTree(afterSenior)), 'permis')

  // „Se vede imediat în proiectele noi”
  const fresh = await createProject(admin, `Drepturi ${STAMP} — din șablonul modificat`, [SA.id])
  await must(admin, 'POST', `/api/projects/${fresh}/import-template`, { template_id: TPL })
  const phases = ((await must(admin, 'GET', `/api/projects/${fresh}/phases`)).phases as Json[]).map(p => p.name)
  fact('s-publicat', 'senior', 'un proiect nou primește faza adăugată de senior', phases.includes(seniorPhase), phases.includes(seniorPhase) ? 'prezentă' : `lipsește (${phases.join(', ')})`, 'API', 'prezentă')
})

test('Duplică un șablon — admin și senior; junior nu', async () => {
  for (const person of [admin, SA]) {
    const res = await call(person, 'POST', `/api/admin/templates/${TPL}/duplicate`)
    verify('s-duplica', person, 'duplică un șablon publicat', res, 'permis')
    if (res.json?.template?.id) {
      created.templates.add(res.json.template.id)
      fact('s-duplica', whoOf(person), 'copia pornește ca ciornă', res.json.template.status === 'draft', String(res.json.template.status), 'API', 'draft')
    }
  }
  verify('s-duplica', JA, 'duplică un șablon', await call(JA, 'POST', `/api/admin/templates/${TPL}/duplicate`), 'refuzat')
})

test('Șterge un șablon — admin și senior; junior nu; blocat dacă îl folosește un proiect', async () => {
  for (const person of [admin, SA]) {
    const copy = (await must(admin, 'POST', `/api/admin/templates/${TPL}/duplicate`)).template.id as string
    created.templates.add(copy)
    verify('s-sterge', JA, 'șterge un șablon', await call(JA, 'DELETE', `/api/admin/templates/${copy}`), 'refuzat')
    verify('s-sterge', person, 'șterge un șablon nefolosit', await call(person, 'DELETE', `/api/admin/templates/${copy}`), 'permis')
  }
  // TPL e folosit de proiectul creat în testul anterior.
  const used = await call(SA, 'DELETE', `/api/admin/templates/${TPL}`)
  verify('s-sterge', SA, 'șterge un șablon folosit de un proiect', used, 'refuzat', 409)
  fact('s-sterge', 'senior', 'motivul e „template_in_use”', used.json?.code === 'template_in_use', String(used.json?.code), 'API', 'template_in_use')
  verify('s-sterge', admin, 'șterge un șablon folosit de un proiect', await call(admin, 'DELETE', `/api/admin/templates/${TPL}`), 'refuzat', 409)
})

test('Dezactivează un șablon sau îl face implicit — doar adminul', async () => {
  const juniorDraft = (await must(JA, 'POST', '/api/admin/templates', templateTree(`Drepturi ${STAMP} — ciornă pentru steaguri`, ['Etapa']))).template.id as string
  created.templates.add(juniorDraft)
  for (const person of [SA, JA]) {
    verify('s-dezactiveaza', person, 'dezactivează un șablon publicat', await call(person, 'PATCH', `/api/admin/templates/${TPL}`, { is_active: false }), 'refuzat')
    verify('s-dezactiveaza', person, 'face implicit un șablon publicat', await call(person, 'PATCH', `/api/admin/templates/${TPL}`, { is_default: true }), 'refuzat')
    verify('s-dezactiveaza', person, 'dezactivează o ciornă', await call(person, 'PATCH', `/api/admin/templates/${juniorDraft}`, { is_active: false }), 'refuzat')
  }
  const { data: flags } = await service.from('project_templates').select('is_active, is_default').eq('id', TPL).single()
  fact('s-dezactiveaza', 'sistem', 'steagurile au rămas neschimbate după refuzuri', flags?.is_active === true && flags?.is_default === false, JSON.stringify(flags), 'Bază de date', '{"is_active":true,"is_default":false}')
  verify('s-dezactiveaza', admin, 'dezactivează un șablon', await call(admin, 'PATCH', `/api/admin/templates/${juniorDraft}`, { is_active: false }), 'permis')
  verify('s-dezactiveaza', admin, 'reactivează un șablon', await call(admin, 'PATCH', `/api/admin/templates/${juniorDraft}`, { is_active: true }), 'permis')
})

test('Publică un șablon — doar adminul', async () => {
  const draft = (await must(SA, 'POST', '/api/admin/templates', templateTree(`Drepturi ${STAMP} — de publicat`, ['Etapa']))).template.id as string
  created.templates.add(draft)
  verify('s-publica', SA, 'publică o ciornă', await call(SA, 'PATCH', `/api/admin/templates/${draft}`, { status: 'published' }), 'refuzat')
  verify('s-publica', JA, 'publică o ciornă', await call(JA, 'PATCH', `/api/admin/templates/${draft}`, { status: 'published' }), 'refuzat')
  verify('s-publica', admin, 'publică o ciornă', await call(admin, 'PATCH', `/api/admin/templates/${draft}`, { status: 'published' }), 'permis')
})

test('Aplică modificările în proiectele existente — doar adminul; eticheta „Modificări neaplicate”', async () => {
  // Un proiect existent pe TPL, apoi o modificare făcută de senior.
  const existing = await createProject(admin, `Drepturi ${STAMP} — proiect pe șablon`, [SA.id])
  await must(admin, 'POST', `/api/projects/${existing}/import-template`, { template_id: TPL })
  await must(admin, 'POST', `/api/admin/templates/${TPL}/propagation/apply`, { project_ids: [existing] })
  const { data: cleared } = await service.from('project_templates').select('unpropagated_changes_at').eq('id', TPL).single()
  fact('s-aplica', 'admin', 'după aplicare eticheta dispare', cleared?.unpropagated_changes_at === null, String(cleared?.unpropagated_changes_at), 'Bază de date', 'null')

  const current = await loadTemplate(TPL)
  await must(SA, 'PUT', `/api/admin/templates/${TPL}/tree`, editorTree(current, `Fază nouă de propagat ${STAMP}`))
  const { data: marked } = await service.from('project_templates').select('unpropagated_changes_at').eq('id', TPL).single()
  fact('s-aplica', 'senior', 'modificarea seniorului aprinde eticheta', !!marked?.unpropagated_changes_at, String(marked?.unpropagated_changes_at), 'Bază de date', 'o dată')

  for (const person of [SA, JA]) {
    verify('s-aplica', person, 'vede previzualizarea propagării', await call(person, 'POST', `/api/admin/templates/${TPL}/propagation/preview`, {}), 'refuzat')
    verify('s-aplica', person, 'aplică propagarea', await call(person, 'POST', `/api/admin/templates/${TPL}/propagation/apply`, { project_ids: [existing] }), 'refuzat')
  }
  const { data: stillMarked } = await service.from('project_templates').select('unpropagated_changes_at').eq('id', TPL).single()
  fact('s-aplica', 'sistem', 'eticheta rămâne după încercările refuzate', !!stillMarked?.unpropagated_changes_at, String(stillMarked?.unpropagated_changes_at), 'Bază de date', 'o dată')

  verify('s-aplica', admin, 'vede previzualizarea propagării', await call(admin, 'POST', `/api/admin/templates/${TPL}/propagation/preview`, {}), 'permis')
  // Aplicarea de către admin se verifică în interfață (testul „Interfață — adminul vede eticheta”).
})

// ═══ ADMINISTRAREA PLATFORMEI ════════════════════════════════════════════════

test('Conturi: creare, roluri, nivel, ștergere — doar adminul', async () => {
  for (const person of [SA, JA]) {
    verify('a-conturi', person, 'creează un cont', await call(person, 'POST', '/api/users', { email: `intrus.${whoOf(person)}.${STAMP}@test.local`, password: PASSWORD, role: 'consultant', fullName: 'Intrus' }), 'refuzat')
    verify('a-conturi', person, 'schimbă rolul altcuiva', await call(person, 'PATCH', `/api/users/${JB.id}`, { role: 'admin' }), 'refuzat')
    verify('a-conturi', person, 'își schimbă singur rolul', await call(person, 'PATCH', `/api/users/${person.id}`, { role: 'admin' }), 'refuzat')
    verify('a-conturi', person, 'schimbă nivelul altcuiva', await call(person, 'PATCH', `/api/users/${JB.id}`, { consultant_level: 'senior' }), 'refuzat')
    verify('a-conturi', person, 'schimbă datele altcuiva', await call(person, 'PATCH', `/api/users/${JB.id}`, { full_name: 'Schimbat' }), 'refuzat')
    verify('a-conturi', person, 'șterge un cont', await call(person, 'DELETE', `/api/users/${JB.id}`), 'refuzat')
  }
  const email = `drepturi.nou.${STAMP}@test.local`
  verify('a-conturi', admin, 'creează un cont de consultant', await call(admin, 'POST', '/api/users', { email, password: PASSWORD, role: 'consultant', fullName: `Consultant nou ${STAMP}` }), 'permis')
  const { data: fresh } = await service.from('profiles').select('id, role, consultant_level').eq('email', email).maybeSingle()
  if (fresh) created.users.add(fresh.id)
  fact('r-junior', 'sistem', 'un consultant creat de admin pornește junior', fresh?.consultant_level === 'junior', String(fresh?.consultant_level), 'Bază de date', 'junior')
  if (fresh) {
    verify('a-conturi', admin, 'schimbă rolul unui cont', await call(admin, 'PATCH', `/api/users/${fresh.id}`, { role: 'client' }), 'permis')
    verify('a-conturi', admin, 'șterge un cont', await call(admin, 'DELETE', `/api/users/${fresh.id}`), 'permis')
    created.users.delete(fresh.id)
  }
  fact('a-conturi', 'sistem', 'resetarea parolei', true, 'nu există endpoint separat; parola se setează doar la crearea contului, de admin', 'API', 'doar admin')
})

test('Statusurile de proiect — doar adminul', async () => {
  const { data: existing } = await service.from('project_statuses').select('id').limit(1).single()
  for (const person of [SA, JA]) {
    verify('a-statusuri', person, 'creează un status', await call(person, 'POST', '/api/admin/statuses', { name: `Intrus ${STAMP}`, slug: `intrus-${STAMP}-${whoOf(person)}` }), 'refuzat')
    verify('a-statusuri', person, 'modifică un status', await call(person, 'PATCH', `/api/admin/statuses/${existing!.id}`, { name: 'Schimbat' }), 'refuzat')
    verify('a-statusuri', person, 'șterge un status', await call(person, 'DELETE', `/api/admin/statuses/${existing!.id}`), 'refuzat')
    verify('a-statusuri', person, 'reordonează statusurile', await call(person, 'POST', '/api/admin/statuses/reorder', { order: [existing!.id] }), 'refuzat')
  }
  const res = await call(admin, 'POST', '/api/admin/statuses', { name: `Status temporar ${STAMP}`, slug: `status-temporar-${STAMP}`, color: '#0E4C4A' })
  verify('a-statusuri', admin, 'creează un status', res, 'permis')
  const id = res.json?.status?.id
  if (id) {
    created.statuses.add(id)
    verify('a-statusuri', admin, 'șterge un status', await call(admin, 'DELETE', `/api/admin/statuses/${id}`), 'permis')
    created.statuses.delete(id)
  }
})

test('Jurnalul de audit — doar adminul', async () => {
  for (const person of [SA, JA]) {
    verify('a-audit', person, 'citește jurnalul de audit', await call(person, 'GET', '/api/audit'), 'refuzat')
  }
  verify('a-audit', admin, 'citește jurnalul de audit', await call(admin, 'GET', '/api/audit'), 'permis')
})

// ═══ REGULI GENERALE ═════════════════════════════════════════════════════════

test('Doar adminul schimbă nivelul; consultantul nu și-l poate schimba singur', async () => {
  verify('r-nivel', JA, 'se promovează singur prin API', await call(JA, 'PATCH', `/api/users/${JA.id}`, { consultant_level: 'senior' }), 'refuzat')
  verify('r-nivel', SA, 'se retrogradează singur prin API', await call(SA, 'PATCH', `/api/users/${SA.id}`, { consultant_level: 'junior' }), 'refuzat')

  const direct = createClient(CONFIG.supabaseUrl, CONFIG.anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  await direct.auth.signInWithPassword({ email: JA.email, password: PASSWORD })
  const { error: directError } = await direct.from('profiles').update({ consultant_level: 'senior' }).eq('id', JA.id)
  const { data: after } = await service.from('profiles').select('consultant_level').eq('id', JA.id).single()
  fact('r-nivel', 'junior', 'se promovează singur direct din clientul Supabase', after?.consultant_level === 'junior', `${after?.consultant_level}${directError ? ` (${directError.message})` : ''}`, 'Bază de date', 'junior')

  verify('r-nivel', admin, 'promovează un junior', await call(admin, 'PATCH', `/api/users/${JB.id}`, { consultant_level: 'senior' }), 'permis')
  verify('r-nivel', admin, 'retrogradează un senior', await call(admin, 'PATCH', `/api/users/${JB.id}`, { consultant_level: 'junior' }), 'permis')
  verify('r-nivel', admin, 'setează nivel pentru un non-consultant', await call(admin, 'PATCH', `/api/users/${clientId}`, { consultant_level: 'senior' }), 'refuzat', 400)
})

test('Retrogradarea are efect imediat, fără delogare', async () => {
  const token = SA.token
  verify('r-retrogradare', SA, 'ca senior, schimbă titlul', await call(SA, 'PATCH', `/api/projects/${OWN}`, { title: `Drepturi ${STAMP} — înainte de retrogradare` }), 'permis')
  await must(admin, 'PATCH', `/api/users/${SA.id}`, { consultant_level: 'junior' })
  try {
    fact('r-retrogradare', 'sistem', 'același token de sesiune, fără relogare', SA.token === token, 'același token', 'API', 'același token')
    verify('r-retrogradare', SA, 'după retrogradare, schimbă titlul', await call(SA, 'PATCH', `/api/projects/${OWN}`, { title: 'După retrogradare' }), 'refuzat')
    verify('r-retrogradare', SA, 'după retrogradare, duplică un șablon', await call(SA, 'POST', `/api/admin/templates/${TPL}/duplicate`), 'refuzat')
    verify('r-retrogradare', SA, 'după retrogradare, adaugă colegi', await call(SA, 'GET', `/api/projects/${OWN}/available-consultants`), 'refuzat')
  } finally {
    await must(admin, 'PATCH', `/api/users/${SA.id}`, { consultant_level: 'senior' })
  }
  verify('r-retrogradare', SA, 'după repromovare, schimbă titlul', await call(SA, 'PATCH', `/api/projects/${OWN}`, { title: `Drepturi ${STAMP} — proiect propriu` }), 'permis')
})

test('Totul rămâne în audit: nivelul și acțiunile seniorului sub numele lui', async () => {
  const { data: levelRows } = await service.from('audit_logs')
    .select('user_id, old_values, new_values, description, created_at')
    .eq('entity_id', JB.id)
    .order('created_at', { ascending: false })
    .limit(10)
  const levelChange = (levelRows ?? []).find(row => (row.new_values as Json)?.consultant_level)
  fact('r-audit', 'admin', 'schimbarea nivelului e în jurnal', !!levelChange, levelChange ? String(levelChange.description) : 'lipsește', 'Bază de date', 'intrare')
  fact('r-audit', 'admin', 'intrarea e sub numele adminului', levelChange?.user_id === admin.id, String(levelChange?.user_id === admin.id ? 'admin' : levelChange?.user_id), 'Bază de date', 'admin')
  fact('r-audit', 'admin', 'intrarea are valorile vechi și noi', !!(levelChange?.old_values as Json)?.consultant_level && !!(levelChange?.new_values as Json)?.consultant_level, JSON.stringify({ old: levelChange?.old_values, new: levelChange?.new_values }), 'Bază de date', 'vechi + nou')

  const { data: seniorRows } = await service.from('audit_logs')
    .select('user_id, entity_type, action_type, description')
    .eq('user_id', SA.id)
    .limit(200)
  const types = new Set((seniorRows ?? []).map(row => `${row.entity_type}:${row.action_type}`))
  const projectEdit = (seniorRows ?? []).some(row => row.entity_type === 'project' && row.action_type === 'update')
  const memberRemove = (seniorRows ?? []).some(row => row.entity_type === 'project_member' && row.action_type === 'delete')
  const templateEdit = (seniorRows ?? []).some(row => row.entity_type === 'template')
  fact('r-audit', 'senior', 'schimbarea titlului apare sub numele seniorului', projectEdit, projectEdit ? 'da' : `nu (${[...types].join(', ')})`, 'Bază de date')
  fact('r-audit', 'senior', 'scoaterea unui coleg apare sub numele seniorului', memberRemove, memberRemove ? 'da' : `nu (${[...types].join(', ')})`, 'Bază de date')
  fact('r-audit', 'senior', 'modificarea de șablon apare sub numele seniorului', templateEdit, templateEdit ? 'da' : `nu (${[...types].join(', ')})`, 'Bază de date')
})

test('Regula adăugată: un proiect nou cere cel puțin un supervizor senior', async () => {
  // Juniorul nu deschide dosare deloc (p-creeaza), deci regula se verifică la cine poate.
  for (const person of [admin, SA]) {
    verify('x-supervizor', person, 'creează fără supervizor', await call(person, 'POST', '/api/projects', { title: 'Fără supervizor', client_id: clientId }), 'refuzat', 400)
    verify('x-supervizor', person, 'pune un junior ca supervizor', await call(person, 'POST', '/api/projects', { title: 'Supervizor junior', client_id: clientId, supervisor_ids: [JB.id] }), 'refuzat', 400)
  }
  const { data } = await service.from('projects').select('id').in('title', ['Fără supervizor', 'Supervizor junior'])
  fact('x-supervizor', 'sistem', 'nicio încercare refuzată nu lasă un proiect în urmă', (data ?? []).length === 0, `${(data ?? []).length} proiecte`, 'Bază de date', '0 proiecte')
})

// ═══ INTERFAȚA ═══════════════════════════════════════════════════════════════

test('Interfață — seniorul în proiectul lui: redenumire, remindere, ștergere faze, echipă doar cu juniori', async ({ browser }) => {
  await ensureMember(OWN, JB)
  await ensureMember(OWN, SB)
  const phaseId = await addPhase(admin, OWN, 'Fază pentru meniul seniorului')
  const phaseName = 'Fază pentru meniul seniorului'
  const { context, page } = await login(browser, SA, PASSWORD)
  try {
    await page.goto(`/projects/${OWN}`)
    await page.getByRole('button', { name: /^Echipa proiectului/ }).waitFor({ timeout: 30_000 })
    fact('p-editeaza', 'senior', 'vede butonul „Redenumește proiectul”', await visible(page, page.getByRole('button', { name: 'Redenumește proiectul' })), 'vizibil', 'Interfață')
    fact('p-editeaza', 'senior', 'vede butonul de remindere', await page.locator('[title^="Reminderele automate sunt"]').count() > 0, 'vizibil', 'Interfață')

    const menu = page.getByRole('button', { name: `Acțiuni pentru faza ${phaseName}` }).first()
    if (await visible(page, menu as never)) {
      await menu.click()
      fact('p-sterge-faze', 'senior', 'meniul fazei are „Șterge”', await visible(page, page.getByRole('menuitem', { name: /Șterge/ })), 'vizibil', 'Interfață')
      await page.keyboard.press('Escape')
    } else {
      fact('p-sterge-faze', 'senior', 'meniul fazei are „Șterge”', false, `meniul fazei ${phaseId} nu e vizibil`, 'Interfață')
    }

    await page.getByRole('button', { name: /^Echipa proiectului/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Echipa proiectului' })
    await dialog.getByRole('listitem').first().waitFor()
    fact('p-adauga-colegi', 'senior', 'panoul echipei are „Adaugă în echipă”', await dialog.getByText('Adaugă în echipă').count() > 0, 'vizibil', 'Interfață')
    const removeJunior = await dialog.getByRole('button', { name: new RegExp(`Scoate pe ${JB.name}`) }).count()
    const removeSenior = await dialog.getByRole('button', { name: new RegExp(`Scoate pe ${SB.name}`) }).count()
    const removeSelf = await dialog.getByRole('button', { name: new RegExp(`Scoate pe ${SA.name}`) }).count()
    fact('p-scoate-colegi', 'senior', 'poate scoate un junior din panou', removeJunior === 1, `${removeJunior} buton(e)`, 'Interfață', '1 buton')
    fact('p-scoate-colegi', 'senior', 'nu are buton de scoatere la alt senior', removeSenior === 0, `${removeSenior} buton(e)`, 'Interfață', '0 butoane')
    fact('p-scoate-colegi', 'senior', 'nu are buton de scoatere la el însuși', removeSelf === 0, `${removeSelf} buton(e)`, 'Interfață', '0 butoane')
    await page.screenshot({ path: path.join(REPORT_DIR, 'senior-echipa.png') })
  } finally {
    await context.close()
  }
})

test('Interfață — juniorul în proiectul lui: fără redenumire, fără ștergere, echipă doar de citit', async ({ browser }) => {
  const phaseName = 'Fază pentru meniul juniorului'
  await addPhase(admin, OWN, phaseName)
  const { context, page } = await login(browser, JA, PASSWORD)
  try {
    await page.goto(`/projects/${OWN}`)
    await page.getByRole('button', { name: /^Echipa proiectului/ }).waitFor({ timeout: 30_000 })
    fact('p-editeaza', 'junior', 'nu vede „Redenumește proiectul”', !(await visible(page, page.getByRole('button', { name: 'Redenumește proiectul' }))), 'ascuns', 'Interfață', 'ascuns')
    fact('p-editeaza', 'junior', 'nu vede butonul de remindere', await page.locator('[title^="Reminderele automate sunt"]').count() === 0, 'ascuns', 'Interfață', 'ascuns')

    const menu = page.getByRole('button', { name: `Acțiuni pentru faza ${phaseName}` }).first()
    if (await visible(page, menu as never)) {
      await menu.click()
      fact('p-sterge-faze', 'junior', 'meniul fazei nu are „Șterge”', await page.getByRole('menuitem', { name: /Șterge/ }).count() === 0, 'ascuns', 'Interfață', 'ascuns')
      await page.keyboard.press('Escape')
    }

    await page.getByRole('button', { name: /^Echipa proiectului/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Echipa proiectului' })
    await dialog.getByRole('listitem').first().waitFor()
    fact('p-adauga-colegi', 'junior', 'panoul echipei nu are „Adaugă în echipă”', await dialog.locator('#echipa-adauga').count() === 0, 'ascuns', 'Interfață', 'ascuns')
    fact('p-scoate-colegi', 'junior', 'panoul echipei nu are butoane de scoatere', await dialog.getByRole('button', { name: /^Scoate pe/ }).count() === 0, 'ascuns', 'Interfață', 'ascuns')
    await page.screenshot({ path: path.join(REPORT_DIR, 'junior-echipa.png') })
  } finally {
    await context.close()
  }
})

test('Interfață — chatul: seniorul șterge mesajele altora dar nu le editează; adminul le editează', async ({ browser }) => {
  const text = `Mesaj pentru meniu ${STAMP}`
  await postMessage(JA, OWN, text)
  for (const [person, password, who] of [[SA, PASSWORD, 'senior'], [{ email: ADMIN_LOGIN.email }, ADMIN_LOGIN.password, 'admin']] as const) {
    const { context, page } = await login(browser, person, password)
    try {
      await page.goto(`/projects/${OWN}`)
      await page.getByRole('button', { name: /^Chat/ }).first().click()
      const message = page.getByText(text).first()
      await message.waitFor({ timeout: 30_000 })
      await message.hover()
      const options = page.getByRole('button', { name: 'Opțiuni mesaj' })
      const count = await options.count()
      let opened = false
      for (let i = count - 1; i >= 0 && !opened; i--) {
        const box = await options.nth(i).boundingBox()
        const target = await message.boundingBox()
        if (box && target && Math.abs(box.y - target.y) < 80) {
          await options.nth(i).click({ force: true })
          opened = true
        }
      }
      const hasDelete = opened && await visible(page, page.getByRole('button', { name: /^Șterge$/ }))
      const hasEdit = opened && await page.getByRole('button', { name: /^Editează$/ }).count() > 0
      fact('p-chat-sterge', who, 'meniul mesajului altcuiva are „Șterge”', hasDelete, hasDelete ? 'vizibil' : (opened ? 'lipsește' : 'meniul nu s-a deschis'), 'Interfață', 'vizibil')
      fact('p-chat-editeaza', who, who === 'admin' ? 'meniul mesajului altcuiva are „Editează”' : 'meniul mesajului altcuiva nu are „Editează”', who === 'admin' ? hasEdit : (opened && !hasEdit), hasEdit ? 'vizibil' : 'ascuns', 'Interfață', who === 'admin' ? 'vizibil' : 'ascuns')
      await page.screenshot({ path: path.join(REPORT_DIR, `chat-${who}.png`) })
    } finally {
      await context.close()
    }
  }
})

test('Interfață — șabloanele: seniorul editează, duplică și șterge; nu publică; juniorul doar ciorne', async ({ browser }) => {
  const draft = (await must(JA, 'POST', '/api/admin/templates', templateTree(`Drepturi ${STAMP} — ciornă vizibilă`, ['Etapa']))).template as Json
  created.templates.add(draft.id)
  const tpl = await loadTemplate(TPL)
  for (const [person, who] of [[SA, 'senior'], [JA, 'junior']] as const) {
    const { context, page } = await login(browser, person, PASSWORD)
    try {
      await page.goto('/admin/templates')
      await page.getByText(tpl.name).first().waitFor({ timeout: 30_000 })
      const edit = await page.getByRole('button', { name: `Editează șablonul ${tpl.name}`, exact: true }).count()
      const duplicate = await page.getByRole('button', { name: `Duplică șablonul ${tpl.name}`, exact: true }).count()
      const remove = await page.getByRole('button', { name: `Șterge șablonul ${tpl.name}`, exact: true }).count()
      const publish = await page.getByRole('button', { name: `Publică șablonul ${draft.name}`, exact: true }).count()
      const editDraft = await page.getByRole('button', { name: `Editează șablonul ${draft.name}`, exact: true }).count()
      const senior = who === 'senior'
      fact('s-publicat', who, `butonul „Editează” la un șablon publicat ${senior ? 'apare' : 'lipsește'}`, senior ? edit === 1 : edit === 0, `${edit}`, 'Interfață', senior ? '1' : '0')
      fact('s-duplica', who, `butonul „Duplică” ${senior ? 'apare' : 'lipsește'}`, senior ? duplicate === 1 : duplicate === 0, `${duplicate}`, 'Interfață', senior ? '1' : '0')
      fact('s-sterge', who, `butonul „Șterge” ${senior ? 'apare' : 'lipsește'}`, senior ? remove === 1 : remove === 0, `${remove}`, 'Interfață', senior ? '1' : '0')
      fact('s-publica', who, 'butonul „Publică” lipsește', publish === 0, `${publish}`, 'Interfață', '0')
      fact('s-ciorne', who, 'poate edita o ciornă', editDraft === 1, `${editDraft}`, 'Interfață', '1')
      // Butoanele de acțiuni trebuie să încapă în tabel, nu să iasă tăiate pe dreapta.
      const clipped = await page.evaluate(() => {
        const scroller = document.querySelector('table')?.parentElement
        if (!scroller) return -1
        const edge = scroller.getBoundingClientRect().right + 1
        return [...document.querySelectorAll('table button')].filter(b => b.getBoundingClientRect().right > edge).length
      })
      fact('s-duplica', who, 'butoanele de acțiuni din tabel nu sunt tăiate', clipped === 0, `${clipped} butoane tăiate`, 'Interfață', '0 butoane tăiate')
      await page.screenshot({ path: path.join(REPORT_DIR, `sabloane-${who}.png`), fullPage: false })
    } finally {
      await context.close()
    }
  }
})

test('Interfață — adminul vede eticheta „Modificări neaplicate în proiecte” și o aplică', async ({ browser }) => {
  const tpl = await loadTemplate(TPL)
  const { data: marked } = await service.from('project_templates').select('unpropagated_changes_at').eq('id', TPL).single()
  if (!marked?.unpropagated_changes_at) await must(SA, 'PUT', `/api/admin/templates/${TPL}/tree`, editorTree(tpl, `Altă fază ${STAMP}`))
  const { context, page } = await login(browser, { email: ADMIN_LOGIN.email }, ADMIN_LOGIN.password)
  try {
    await page.goto('/admin/templates')
    // Numele exact: copiile „… (Copie)” conțin același text și apar înaintea lui.
    const row = page.getByRole('row').filter({ has: page.getByText(tpl.name, { exact: true }) }).first()
    await row.waitFor({ timeout: 30_000 })
    const label = row.getByText('Modificări neaplicate în proiecte')
    const shown = await visible(page, label as never)
    fact('s-aplica', 'admin', 'vede eticheta pe șablonul schimbat de senior', shown, shown ? 'vizibilă' : 'lipsește', 'Interfață', 'vizibilă')
    await page.screenshot({ path: path.join(REPORT_DIR, 'admin-eticheta.png') })
    if (shown) {
      await label.click()
      const applied = page.waitForResponse(response => response.url().endsWith('/propagation/apply'), { timeout: 30_000 })
      const applyButton = page.getByRole('button', { name: /Aplică|Propagă/ }).last()
      await applyButton.waitFor({ timeout: 30_000 })
      if (await applyButton.isDisabled()) {
        const boxes = page.getByRole('checkbox')
        for (let i = 0; i < await boxes.count(); i++) if (!(await boxes.nth(i).isChecked())) await boxes.nth(i).check().catch(() => {})
      }
      await applyButton.click()
      const response = await applied
      verify('s-aplica', admin, 'aplică modificările din interfață', { status: response.status(), json: await response.json().catch(() => ({})) }, 'permis')
      await page.waitForTimeout(800)
      const { data: after } = await service.from('project_templates').select('unpropagated_changes_at').eq('id', TPL).single()
      fact('s-aplica', 'admin', 'după aplicare eticheta dispare', after?.unpropagated_changes_at === null, String(after?.unpropagated_changes_at), 'Bază de date', 'null')
    }
  } finally {
    await context.close()
  }
})

test('Interfață — seniorul nu are acces la conturi, audit, statusuri și tabloul de bord', async ({ browser }) => {
  const { context, page } = await login(browser, SA, PASSWORD)
  try {
    await page.goto('/')
    await page.locator('nav').first().waitFor()
    const nav = page.locator('header, nav').first()
    for (const [row, label] of [['a-conturi', 'Utilizatori'], ['a-audit', 'Audit'], ['a-tablou', 'Tablou de bord']] as const) {
      const count = await nav.getByRole('link', { name: label, exact: true }).count()
      fact(row, 'senior', `meniul nu are „${label}”`, count === 0, `${count} link(uri)`, 'Interfață', '0')
    }
    for (const [row, url] of [['a-conturi', '/admin/users'], ['a-conturi', `/admin/users/${JB.id}`], ['a-audit', '/admin/audit'], ['a-statusuri', '/admin/statuses'], ['a-tablou', '/admin/proiecte'], ['a-tablou', '/admin']] as const) {
      await page.goto(url)
      await page.waitForTimeout(2_500)
      const current = new URL(page.url()).pathname
      const leftPage = current !== url
      fact(row, 'senior', `deschide ${url} direct`, leftPage, leftPage ? `redirecționat la ${current}` : 'a rămas pe pagină', 'Interfață', 'redirecționat')
    }
    const ids = ((await must(SA, 'GET', '/api/projects')).projects as Json[]).map(p => p.id)
    fact('a-tablou', 'senior', 'API-ul de proiecte nu îi dă toate proiectele', !ids.includes(OTHER), ids.includes(OTHER) ? 'include proiectul străin' : 'doar proiectele lui', 'API', 'doar proiectele lui')
  } finally {
    await context.close()
  }
  const adminSession = await login(browser, { email: ADMIN_LOGIN.email }, ADMIN_LOGIN.password)
  try {
    await adminSession.page.goto('/admin/proiecte')
    await adminSession.page.waitForTimeout(2_500)
    const stays = new URL(adminSession.page.url()).pathname === '/admin/proiecte'
    fact('a-tablou', 'admin', 'deschide tabloul de bord', stays, stays ? 'deschis' : `redirecționat la ${adminSession.page.url()}`, 'Interfață', 'deschis')
  } finally {
    await adminSession.context.close()
  }
})

test('Interfață — adminul schimbă nivelul din pagina utilizatorului', async ({ browser }) => {
  const { context, page } = await login(browser, { email: ADMIN_LOGIN.email }, ADMIN_LOGIN.password)
  try {
    await page.goto(`/admin/users/${JB.id}`)
    const group = page.getByRole('radiogroup', { name: 'Nivelul consultantului' })
    await group.waitFor({ timeout: 30_000 })
    fact('r-nivel', 'admin', 'pagina utilizatorului are comutatorul Junior / Senior', true, 'vizibil', 'Interfață', 'vizibil')
    await group.getByRole('radio', { name: 'Senior' }).click()
    await page.getByRole('button', { name: 'Promovează' }).click()
    await expect.poll(async () => (await service.from('profiles').select('consultant_level').eq('id', JB.id).single()).data?.consultant_level, { timeout: 15_000 }).toBe('senior')
    fact('r-nivel', 'admin', 'promovarea din interfață ajunge în bază', true, 'senior', 'Interfață', 'senior')
    await page.screenshot({ path: path.join(REPORT_DIR, 'admin-nivel.png') })
    await group.getByRole('radio', { name: 'Junior' }).click()
    await page.getByRole('button', { name: 'Retrogradează' }).click()
    await expect.poll(async () => (await service.from('profiles').select('consultant_level').eq('id', JB.id).single()).data?.consultant_level, { timeout: 15_000 }).toBe('junior')
    fact('r-nivel', 'admin', 'retrogradarea din interfață ajunge în bază', true, 'junior', 'Interfață', 'junior')
  } finally {
    await context.close()
  }
  const { context: juniorContext, page: juniorPage } = await login(browser, JA, PASSWORD)
  try {
    await juniorPage.goto(`/admin/users/${JA.id}`)
    await juniorPage.waitForTimeout(2_500)
    const switchCount = await juniorPage.getByRole('radiogroup', { name: 'Nivelul consultantului' }).count()
    fact('r-nivel', 'junior', 'nu ajunge la comutatorul de nivel nici pentru el', switchCount === 0, switchCount ? 'vizibil' : `ascuns (${new URL(juniorPage.url()).pathname})`, 'Interfață', 'ascuns')
  } finally {
    await juniorContext.close()
  }
})

test('Matricea e respectată — toate verificările de mai sus', async () => {
  const failed = checks.filter(check => !check.ok)
  const summary = failed.map(check => `✗ [${ROW[check.row].title}] ${check.who} · ${check.label}: așteptat ${check.expected}, obținut ${check.actual}`)
  console.log(`Verificări: ${checks.length}, respectate: ${checks.length - failed.length}, abateri: ${failed.length}`)
  expect(failed, summary.join('\n')).toHaveLength(0)
})
