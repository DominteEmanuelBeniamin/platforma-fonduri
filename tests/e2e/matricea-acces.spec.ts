import { randomUUID } from 'node:crypto'
import { test, expect, type Browser, type Locator, type Page } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { e2eEnv, requireE2EConfig, serviceClient } from './helpers/project-state'
import { createDovezi, type Strat } from './helpers/dovezi'

/**
 * „Matricea drepturilor de acces” (documentul intern
 * docs/matricea-drepturilor-de-acces.pdf, ținut în afara repo-ului):
 * starea drepturilor dinaintea nivelurilor de consultant, pe admin, consultant
 * și client. Fiecare rând se verifică acum pe admin, senior, junior și client,
 * iar dovada spune cum a ajuns rândul față de PDF: neschimbat, schimbat
 * intenționat (#104, decizia din 1 octombrie 2026) sau reparat între timp.
 *
 * Defectele pe care PDF-ul le notase deja și care există încă sunt marcate
 * `cunoscut`: apar în raport, dar nu pică suita.
 *
 * Folosește un al doilea client (implicit client.brutaria@test.local din
 * `npm run seed:local`) pentru „clientul își vede doar proiectele lui”.
 */

const ENV = e2eEnv()
const CONFIG = requireE2EConfig(ENV)
const ADMIN_LOGIN = { email: ENV.E2E_ADMIN_EMAIL || CONFIG.staffEmail, password: ENV.E2E_ADMIN_PASSWORD || CONFIG.staffPassword }
const CLIENT2_LOGIN = { email: ENV.E2E_CLIENT2_EMAIL || 'client.brutaria@test.local', password: ENV.E2E_CLIENT2_PASSWORD || 'Parola123!' }
const STAMP = Date.now().toString(36)
const PASSWORD = `Matrice-${STAMP}-2026!`
const BUCKET = 'project-files'

test.describe.configure({ mode: 'serial' })
test.setTimeout(240_000)
// Un selector greșit pică în 20 s, nu la expirarea testului.
test.use({ actionTimeout: 20_000, navigationTimeout: 45_000 })

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Person = { id: string; email: string; name: string; password: string; token: string; who: string }
type Res = { status: number; json: Json }

const dovezi = createDovezi('matricea-acces')
const service = serviceClient() as SupabaseClient
const created = { projects: new Set<string>(), templates: new Set<string>(), statuses: new Set<string>(), users: new Set<string>(), storage: new Set<string>() }
const accounts = new Set<string>()
let admin: Person, client: Person, client2: Person | null, SA: Person, SB: Person, JA: Person, JO: Person
let statusId = ''
let OWN = '', FOREIGN = '', USED = ''
let PHASE = '', ACTIVITY = '', FOREIGN_ACTIVITY = ''
let DRAFT_T = '', PUB_T = ''

// ─── Rândul curent din PDF ───────────────────────────────────────────────────

let SECTIUNE = ''
let RAND = { titlu: '', fataDePdf: '' }

function sectiune(titlu: string) {
  SECTIUNE = titlu
}

/** Rândul din PDF verificat de punctele următoare și ce s-a întâmplat cu el. */
function rand(titlu: string, fataDePdf: string) {
  RAND = { titlu, fataDePdf }
}

function noteaza(cine: string, punct: string, asteptat: string, obtinut: string, ok: boolean, strat: Strat, extra: { capturi?: string[]; cunoscut?: boolean } = {}) {
  return dovezi.noteaza({ zona: SECTIUNE, rand: RAND.titlu, fataDePdf: RAND.fataDePdf, cine, punct, asteptat, obtinut, ok, strat, ...extra })
}

/** Un răspuns HTTP: `permis` = 2xx, altfel statusul exact. */
function verifica(person: Person | { who: string }, punct: string, res: Res, expected: 'permis' | number, extra: { cunoscut?: boolean } = {}) {
  const allowed = res.status >= 200 && res.status < 300
  const ok = expected === 'permis' ? allowed : res.status === expected
  const message = res.json?.message ?? res.json?.error
  return noteaza(person.who, punct, expected === 'permis' ? 'permis (2xx)' : `refuzat (HTTP ${expected})`,
    `HTTP ${res.status}${message && !allowed ? ` — ${String(message).slice(0, 140)}` : ''}`, ok, 'API', extra)
}

// ─── Ajutoare ────────────────────────────────────────────────────────────────

/** Așteaptă cu adevărat elementul: `isVisible` nu așteaptă, oricare ar fi `timeout`. */
async function seen(locator: Locator, timeout = 15_000) {
  return locator.first().waitFor({ state: 'visible', timeout }).then(() => true, () => false)
}

async function signIn(email: string, password: string) {
  const anon = createClient(CONFIG.supabaseUrl, CONFIG.anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await anon.auth.signInWithPassword({ email, password })
  if (error || !data.session) throw new Error(`Autentificare ${email}: ${error?.message}`)
  return data.session.access_token
}

async function fixedConsultant(tag: string, level: 'junior' | 'senior', label: string, who: string): Promise<Person> {
  const email = `matrice.${tag}@test.local`
  const name = `Matrice — ${label}`
  const { data } = await service.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
  let id = data?.user?.id
  if (!id) {
    const { data: existing } = await service.from('profiles').select('id').eq('email', email).single()
    id = existing!.id as string
    await service.auth.admin.updateUserById(id, { password: PASSWORD })
  }
  accounts.add(id)
  await service.from('profiles').upsert({ id, email, role: 'consultant', consultant_level: level, full_name: name })
  await must(admin, 'POST', '/api/users/' + id + '/reactivate')
  return { id, email, name, password: PASSWORD, token: await signIn(email, PASSWORD), who }
}

async function existing(email: string, password: string, who: string): Promise<Person> {
  const { data } = await service.from('profiles').select('id, email, full_name').eq('email', email).single()
  return { id: data!.id, email: data!.email, name: data!.full_name, password, token: await signIn(email, password), who }
}

// API-created fixture passwords may be returned or delivered to the local mail mock.
async function fixturePassword(creation: Json): Promise<string> {
  expect(created.users.has(creation.userId)).toBe(true)
  if (typeof creation.temporaryPassword === 'string') return creation.temporaryPassword
  expect(creation.emailSent).toBe(true)
  const reset = await service.auth.admin.updateUserById(creation.userId, { password: PASSWORD })
  expect(reset.error).toBeNull()
  return PASSWORD
}

async function call(who: Person, method: string, url: string, body?: unknown, token = who.token): Promise<Res> {
  const res = await fetch(`${CONFIG.baseUrl}${url}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Json }
}

async function must(who: Person, method: string, url: string, body?: unknown) {
  const res = await call(who, method, url, body)
  if (res.status >= 300) throw new Error(`${method} ${url} → ${res.status} ${JSON.stringify(res.json).slice(0, 300)}`)
  return res.json
}

async function project(title: string, clientId: string, supervisors: string[]) {
  const json = await must(admin, 'POST', '/api/projects', { title, client_id: clientId, supervisor_ids: supervisors })
  created.projects.add(json.project.id)
  return json.project.id as string
}

async function request(by: Person, projectId: string, name: string, activityId?: string) {
  const json = await must(by, 'POST', `/api/projects/${projectId}/document-requests`, { name, ...(activityId ? { activity_id: activityId } : {}) })
  return json.id as string
}

async function template(by: Person, name: string, phases: string[] = ['Pregătire']) {
  const json = await must(by, 'POST', '/api/admin/templates', {
    name, slug: `matrice-${STAMP}-${randomUUID().slice(0, 6)}`, description: 'Șablon al matricei de acces',
    phases: phases.map((phaseName, index) => ({ id: `p${index}`, name: phaseName, project_status_id: statusId, activities: [] })),
  })
  created.templates.add(json.template.id)
  return json.template.id as string
}

async function uploadFixture(requirementId: string, version: number) {
  const storagePath = `test-fixtures/matrice/${STAMP}/${requirementId}-v${version}.pdf`
  const { error: uploadError } = await service.storage.from(BUCKET).upload(storagePath, Buffer.from(`%PDF-1.4\n% versiunea ${version}\n`), { contentType: 'application/pdf', upsert: true })
  if (uploadError) throw new Error(`Upload fixture: ${uploadError.message}`)
  created.storage.add(storagePath)
  const id = randomUUID()
  const { error } = await service.from('files').insert({
    id, requirement_id: requirementId, storage_path: storagePath, original_name: `document-v${version}.pdf`,
    file_size: 20, mime_type: 'application/pdf', version_number: version, uploaded_by: client.id,
  })
  if (error) throw new Error(`Fișier fixture: ${error.message}`)
  return id
}

async function login(browser: Browser, person: { email: string; password: string }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await page.goto('/login')
  await page.fill('input[type=email]', person.email)
  await page.fill('input[type=password]', person.password)
  await page.click('button[type=submit]')
  await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 30_000 })
  return { context, page }
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
}

// ─── Pregătire și curățenie ──────────────────────────────────────────────────

test.beforeAll(async () => {
  dovezi.reset()
  admin = await existing(ADMIN_LOGIN.email, ADMIN_LOGIN.password, 'admin')
  client = await existing(CONFIG.clientEmail, CONFIG.clientPassword, 'client')
  client2 = await existing(CLIENT2_LOGIN.email, CLIENT2_LOGIN.password, 'alt client').catch(() => null)
  statusId = (await service.from('project_statuses').select('id').order('id').limit(1).single()).data!.id

  SA = await fixedConsultant('sa', 'senior', 'Senior în echipă', 'senior')
  SB = await fixedConsultant('sb', 'senior', 'Senior al proiectului străin', 'senior (alt proiect)')
  JA = await fixedConsultant('ja', 'junior', 'Junior în echipă', 'junior')
  JO = await fixedConsultant('jo', 'junior', 'Junior din afara echipei', 'junior din afară')

  OWN = await project(`Matrice ${STAMP} — proiect propriu`, client.id, [SA.id])
  await must(admin, 'POST', `/api/projects/${OWN}/members`, { consultant_id: JA.id })
  PHASE = (await must(admin, 'POST', `/api/projects/${OWN}/phases`, { name: 'Faza matricei' })).phase.id
  ACTIVITY = (await must(admin, 'POST', `/api/projects/${OWN}/phases/${PHASE}/activities`, { name: 'Activitatea matricei' })).activity.id

  FOREIGN = await project(`Matrice ${STAMP} — proiect străin`, client2?.id ?? client.id, [SB.id])
  const foreignPhase = (await must(admin, 'POST', `/api/projects/${FOREIGN}/phases`, { name: 'Faza străină' })).phase.id
  FOREIGN_ACTIVITY = (await must(admin, 'POST', `/api/projects/${FOREIGN}/phases/${foreignPhase}/activities`, { name: 'Activitate străină' })).activity.id

  DRAFT_T = await template(admin, `Matrice ${STAMP} — ciornă`)
  PUB_T = await template(admin, `Matrice ${STAMP} — publicat`)
  await must(admin, 'PATCH', `/api/admin/templates/${PUB_T}`, { status: 'published' })
  USED = await project(`Matrice ${STAMP} — proiect din șablon`, client.id, [SA.id])
  await must(admin, 'POST', `/api/projects/${USED}/import-template`, { template_id: PUB_T })
})

test.afterAll(async () => {
  dovezi.scrie({ baseUrl: CONFIG.baseUrl, stamp: STAMP, pdf: 'docs/matricea-drepturilor-de-acces.pdf' })
  if (!service) return
  for (const id of created.projects) await service.from('projects').delete().eq('id', id)
  for (const id of created.templates) await service.from('project_templates').delete().eq('id', id)
  for (const id of created.statuses) await service.from('project_statuses').delete().eq('id', id)
  if (created.storage.size) await service.storage.from(BUCKET).remove([...created.storage])
  await service.from('files').delete().like('storage_path', `test-fixtures/matrice/${STAMP}/%`)
  for (const id of created.users) {
    const response = await call(admin, 'DELETE', `/api/users/${id}`)
    if (response.status === 409) await must(admin, 'POST', `/api/users/${id}/deactivate`)
    else if (response.status !== 200 && response.status !== 404) throw new Error(`Cleanup cont fixture: HTTP ${response.status}`)
  }
  for (const id of accounts) {
    await service.from('profiles').update({ consultant_level: 'junior' }).eq('id', id)
    await must(admin, 'POST', `/api/users/${id}/deactivate`)
  }
})

// ─── A. Șabloane și statusuri ────────────────────────────────────────────────

test('A. Șabloane și statusuri de proiect', async () => {
  sectiune('A. Șabloane și statusuri de proiect')

  rand('Vizualizare șabloane (draft + publicate)', 'neschimbat: consultanții, de ambele niveluri')
  for (const person of [admin, SA, JA]) {
    const res = await call(person, 'GET', '/api/admin/templates')
    verifica(person, 'listează șabloanele', res, 200)
    const names = (res.json.templates ?? []).map((t: Json) => t.id)
    noteaza(person.who, 'lista conține și ciorna adminului', 'conține', names.includes(DRAFT_T) ? 'conține' : 'lipsește', names.includes(DRAFT_T), 'API')
  }
  verifica(client, 'listează șabloanele', await call(client, 'GET', '/api/admin/templates'), 403)

  rand('Creare șablon nou (draft)', 'neschimbat')
  for (const person of [admin, SA, JA]) {
    const res = await call(person, 'POST', '/api/admin/templates', { name: `Matrice ${STAMP} — ciornă de ${person.who}`, slug: `matrice-${STAMP}-${person.who}-${randomUUID().slice(0, 4)}` })
    if (res.json?.template?.id) created.templates.add(res.json.template.id)
    verifica(person, 'creează o ciornă', res, 'permis')
  }
  verifica(client, 'creează o ciornă', await call(client, 'POST', '/api/admin/templates', { name: 'Ciornă de client', slug: `matrice-${STAMP}-client` }), 403)

  rand('Editare șablon draft', 'neschimbat')
  for (const person of [admin, SA, JA]) {
    verifica(person, 'modifică descrierea unei ciorne', await call(person, 'PATCH', `/api/admin/templates/${DRAFT_T}`, { description: `Descriere de ${person.who}` }), 'permis')
  }
  verifica(client, 'modifică descrierea unei ciorne', await call(client, 'PATCH', `/api/admin/templates/${DRAFT_T}`, { description: 'Descriere de client' }), 403)

  rand('Editare șablon publicat', 'schimbat prin #104: și seniorul')
  verifica(admin, 'modifică un șablon publicat', await call(admin, 'PATCH', `/api/admin/templates/${PUB_T}`, { description: 'Descriere de admin' }), 'permis')
  verifica(SA, 'modifică un șablon publicat', await call(SA, 'PATCH', `/api/admin/templates/${PUB_T}`, { description: 'Descriere de senior' }), 'permis')
  verifica(JA, 'modifică un șablon publicat', await call(JA, 'PATCH', `/api/admin/templates/${PUB_T}`, { description: 'Descriere de junior' }), 403)
  verifica(client, 'modifică un șablon publicat', await call(client, 'PATCH', `/api/admin/templates/${PUB_T}`, { description: 'Descriere de client' }), 403)

  rand('Publicare șablon', 'neschimbat: doar adminul; un șablon publicat nu revine la ciornă')
  const toPublish = await template(admin, `Matrice ${STAMP} — de publicat`)
  for (const person of [SA, JA, client]) {
    verifica(person, 'publică o ciornă', await call(person, 'PATCH', `/api/admin/templates/${toPublish}`, { status: 'published' }), 403)
  }
  verifica(admin, 'publică o ciornă', await call(admin, 'PATCH', `/api/admin/templates/${toPublish}`, { status: 'published' }), 'permis')
  verifica(admin, 'readuce un șablon publicat la ciornă', await call(admin, 'PATCH', `/api/admin/templates/${PUB_T}`, { status: 'draft' }), 400)

  rand('Ștergere șablon', 'schimbat prin #104: și seniorul; blocată dacă îl folosește un proiect')
  for (const [person, expected] of [[JA, 403], [client, 403], [SA, 'permis'], [admin, 'permis']] as const) {
    const victim = await template(admin, `Matrice ${STAMP} — de șters de ${person.who}`)
    verifica(person, 'șterge un șablon nefolosit', await call(person, 'DELETE', `/api/admin/templates/${victim}`), expected)
  }
  verifica(admin, 'șterge un șablon folosit de un proiect', await call(admin, 'DELETE', `/api/admin/templates/${PUB_T}`), 409)

  rand('Duplicare șablon', 'schimbat prin #104: și seniorul')
  for (const [person, expected] of [[admin, 'permis'], [SA, 'permis'], [JA, 403], [client, 403]] as const) {
    const res = await call(person, 'POST', `/api/admin/templates/${PUB_T}/duplicate`)
    const copy = res.json?.template?.id ?? res.json?.id
    if (copy) created.templates.add(copy)
    verifica(person, 'duplică un șablon publicat', res, expected)
  }

  rand('Editare propagare în proiecte (preview + aplicare)', 'neschimbat: doar adminul')
  for (const person of [SA, JA, client]) {
    verifica(person, 'cere preview-ul propagării', await call(person, 'POST', `/api/admin/templates/${PUB_T}/propagation/preview`, {}), 403)
    verifica(person, 'aplică propagarea', await call(person, 'POST', `/api/admin/templates/${PUB_T}/propagation/apply`, { project_ids: [USED] }), 403)
  }
  verifica(admin, 'cere preview-ul propagării', await call(admin, 'POST', `/api/admin/templates/${PUB_T}/propagation/preview`, {}), 'permis')
  verifica(admin, 'aplică propagarea', await call(admin, 'POST', `/api/admin/templates/${PUB_T}/propagation/apply`, { project_ids: [USED] }), 'permis')

  rand('Creare/editare/ștergere fază, activitate, cerință în șablon', 'schimbat prin #104: seniorul și pe publicate; juniorul doar pe ciorne')
  const phaseFor = async (person: Person, templateId: string) => call(person, 'POST', '/api/admin/templates/phases', { template_id: templateId, name: `Fază ${person.who} ${randomUUID().slice(0, 4)}`, project_status_id: statusId })
  for (const person of [admin, SA, JA]) verifica(person, 'adaugă o fază într-o ciornă', await phaseFor(person, DRAFT_T), 'permis')
  verifica(client, 'adaugă o fază într-o ciornă', await phaseFor(client, DRAFT_T), 403)
  verifica(admin, 'adaugă o fază într-un șablon publicat', await phaseFor(admin, PUB_T), 'permis')
  verifica(SA, 'adaugă o fază într-un șablon publicat', await phaseFor(SA, PUB_T), 'permis')
  verifica(JA, 'adaugă o fază într-un șablon publicat', await phaseFor(JA, PUB_T), 403)
  const juniorPhase = (await phaseFor(JA, DRAFT_T)).json?.phase?.id
  verifica(JA, 'șterge faza pusă de el într-o ciornă', await call(JA, 'DELETE', `/api/admin/templates/phases/${juniorPhase}`), 'permis')
  const { data: softDeleted } = await service.from('template_phases').select('is_active').eq('id', juniorPhase).maybeSingle()
  noteaza('sistem', 'ștergerea din șablon e soft-delete', 'rândul rămâne, inactiv', softDeleted ? `rândul rămâne, is_active=${softDeleted.is_active}` : 'rândul a dispărut', softDeleted?.is_active === false, 'Bază de date')

  rand('Creare/editare/ștergere status de proiect (/admin/statuses)', 'neschimbat: scrierea doar la admin; excepția din PDF (citirea unui singur status, fără nicio verificare) există încă')
  for (const person of [SA, JA, client]) {
    verifica(person, 'creează un status', await call(person, 'POST', '/api/admin/statuses', { name: `Status ${person.who}`, slug: `matrice-${STAMP}-${randomUUID().slice(0, 4)}` }), 403)
  }
  const createdStatus = await call(admin, 'POST', '/api/admin/statuses', { name: `Matrice ${STAMP}`, slug: `matrice-${STAMP}` })
  const tempStatus = createdStatus.json?.status?.id ?? createdStatus.json?.id
  if (tempStatus) created.statuses.add(tempStatus)
  verifica(admin, 'creează un status', createdStatus, 'permis')
  verifica(SA, 'redenumește un status', await call(SA, 'PATCH', `/api/admin/statuses/${tempStatus}`, { name: 'Schimbat de senior' }), 403)
  verifica(admin, 'redenumește un status', await call(admin, 'PATCH', `/api/admin/statuses/${tempStatus}`, { name: `Matrice ${STAMP} (redenumit)` }), 'permis')
  // Lista e deschisă oricui e logat, deci și un singur status; PDF-ul notase însă că
  // ruta nu are nicio verificare: merge și fără cont.
  for (const person of [SA, JA, client]) {
    verifica(person, 'citește un singur status', await call(person, 'GET', `/api/admin/statuses/${tempStatus}`), 200)
  }
  verifica({ who: 'fără cont' }, 'citește un singur status fără să fie autentificat', await call(admin, 'GET', `/api/admin/statuses/${tempStatus}`, undefined, ''), 401, { cunoscut: true })
  verifica(JA, 'șterge un status', await call(JA, 'DELETE', `/api/admin/statuses/${tempStatus}`), 403)
  verifica(admin, 'șterge un status', await call(admin, 'DELETE', `/api/admin/statuses/${tempStatus}`), 'permis')

  rand('Vizualizare listă statusuri', 'neschimbat: orice utilizator logat, inclusiv clientul')
  for (const person of [admin, SA, JA, client]) verifica(person, 'listează statusurile', await call(person, 'GET', '/api/admin/statuses'), 200)
})

// ─── B. Conturi, audit, clienți ──────────────────────────────────────────────

test('B. Conturi, audit, clienți', async () => {
  sectiune('B. Conturi, audit, clienți')

  rand('Creare cont', 'neschimbat: doar adminul; rolul e validat acum de bază, dar contul de autentificare rămâne orfan')
  for (const person of [SA, JA, client]) {
    verifica(person, 'creează un cont', await call(person, 'POST', '/api/users', { email: `matrice.${STAMP}.${person.who.replace(/\W/g, '')}@test.local`, password: PASSWORD, role: 'consultant', fullName: 'Nu trebuie să existe' }), 403)
  }
  const badEmail = `matrice.${STAMP}.rol-invalid@test.local`
  verifica(admin, 'creează un cont cu rolul „superadmin”', await call(admin, 'POST', '/api/users', { email: badEmail, password: PASSWORD, role: 'superadmin', fullName: 'Rol invalid' }), 400)
  const { data: authUsers } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 })
  const orphan = authUsers?.users.find(user => user.email === badEmail)
  if (orphan) created.users.add(orphan.id)
  noteaza('admin', 'după refuzul rolului invalid nu rămâne niciun cont de autentificare', 'niciun cont', orphan ? 'cont de autentificare orfan, fără profil (emailul nu mai poate fi refolosit)' : 'niciun cont', !orphan, 'Bază de date', { cunoscut: true })

  rand('Listare utilizatori', 'neschimbat: adminul pe toți, consultantul doar consultanți, clientul nimic')
  const all = await call(admin, 'GET', '/api/users')
  verifica(admin, 'listează utilizatorii', all, 200)
  noteaza('admin', 'lista adminului conține și clienți', 'conține clienți', (all.json.users ?? []).some((u: Json) => u.role === 'client') ? 'conține clienți' : 'fără clienți', (all.json.users ?? []).some((u: Json) => u.role === 'client'), 'API')
  for (const person of [SA, JA]) {
    const res = await call(person, 'GET', '/api/users')
    verifica(person, 'listează utilizatorii', res, 200)
    const users = (res.json.users ?? []) as Json[]
    const onlyConsultants = users.every(u => u.role === 'consultant')
    const limited = users.every(u => !('telefon' in u) && !('cif' in u) && !('adresa_firma' in u))
    noteaza(person.who, 'doar consultanți, fără telefon, CIF sau adresă', 'da', `${onlyConsultants ? 'doar consultanți' : 'și alte roluri'}, ${limited ? 'câmpuri limitate' : 'câmpuri complete'}`, onlyConsultants && limited, 'API')
  }
  verifica(client, 'listează utilizatorii', await call(client, 'GET', '/api/users'), 403)

  rand('Editare profil propriu', 'neschimbat: oricine, pentru el însuși (nume, telefon, CIF)')
  for (const person of [SA, JA, client]) {
    verifica(person, 'își schimbă telefonul', await call(person, 'PATCH', `/api/users/${person.id}`, { telefon: '0700000000' }), 200)
  }

  rand('Editare profil altcuiva', 'neschimbat: doar adminul; emailul nu se schimbă')
  verifica(SA, 'schimbă numele juniorului', await call(SA, 'PATCH', `/api/users/${JA.id}`, { full_name: 'Schimbat de senior' }), 403)
  verifica(JA, 'schimbă numele seniorului', await call(JA, 'PATCH', `/api/users/${SA.id}`, { full_name: 'Schimbat de junior' }), 403)
  verifica(client, 'schimbă numele juniorului', await call(client, 'PATCH', `/api/users/${JA.id}`, { full_name: 'Schimbat de client' }), 403)
  verifica(admin, 'schimbă numele juniorului', await call(admin, 'PATCH', `/api/users/${JA.id}`, { full_name: JA.name }), 200)
  verifica(admin, 'schimbă emailul juniorului', await call(admin, 'PATCH', `/api/users/${JA.id}`, { email: `alt.${JA.email}` }), 400)
  verifica(JA, 'își schimbă propriul email', await call(JA, 'PATCH', `/api/users/${JA.id}`, { email: `alt.${JA.email}` }), 400)

  rand('Schimbare rol', 'neschimbat pentru consultant și client; PDF: „nici adminul pe el însuși”')
  verifica(JA, 'își schimbă singur rolul în admin', await call(JA, 'PATCH', `/api/users/${JA.id}`, { role: 'admin' }), 403)
  verifica(client, 'își schimbă singur rolul în admin', await call(client, 'PATCH', `/api/users/${client.id}`, { role: 'admin' }), 403)
  const tempAdminEmail = `matrice.${STAMP}.admin-temporar@test.local`
  const tempAdminCreation = await must(admin, 'POST', '/api/users', { email: tempAdminEmail, password: PASSWORD, role: 'admin', fullName: 'Admin temporar' })
  created.users.add(tempAdminCreation.userId)
  const tempAdmin = await existing(tempAdminEmail, await fixturePassword(tempAdminCreation), 'admin temporar')
  created.users.add(tempAdmin.id)
  verifica(tempAdmin, 'adminul își schimbă singur rolul în consultant (PDF: nu poate)', await call(tempAdmin, 'PATCH', `/api/users/${tempAdmin.id}`, { role: 'consultant' }), 403, { cunoscut: true })

  rand('Lifecycle cont', 'reparat prin #105: adminul dezactivează fără pierdere de date; șterge numai conturi fără relații')
  for (const person of [SA, JA, client]) {
    verifica(person, 'șterge un cont', await call(person, 'DELETE', `/api/users/${JO.id}`), 403)
    verifica(person, 'dezactivează un cont', await call(person, 'POST', `/api/users/${JO.id}/deactivate`), 403)
    verifica(person, 'reactivează un cont', await call(person, 'POST', `/api/users/${JO.id}/reactivate`), 403)
    verifica(person, 'citește impactul unui cont', await call(person, 'GET', `/api/users/${JO.id}/lifecycle-impact`), 403)
  }
  const tempEmail = `matrice.${STAMP}.consultant-temporar@test.local`
  const tempCreation = await must(admin, 'POST', '/api/users', { email: tempEmail, password: PASSWORD, role: 'consultant', fullName: 'Consultant temporar' })
  created.users.add(tempCreation.userId)
  const temp = await existing(tempEmail, await fixturePassword(tempCreation), 'consultant temporar')
  created.users.add(temp.id)
  await must(admin, 'POST', `/api/projects/${OWN}/members`, { consultant_id: temp.id })
  const tempRequest = await request(temp, OWN, 'Cerere pusă de consultantul temporar', ACTIVITY)
  await must(temp, 'POST', '/api/auth/audit', { action: 'login' })
  const blockedConsultant = await call(admin, 'DELETE', `/api/users/${temp.id}`)
  verifica(admin, 'șterge contul consultantului care a lucrat', blockedConsultant, 409)
  expect(blockedConsultant.json.code).toBe('USER_HAS_RELATED_DATA')
  expect(blockedConsultant.json.details.blockers.length).toBeGreaterThan(0)
  const { data: stillThere } = await service.from('profiles').select('id').eq('id', temp.id).maybeSingle()
  noteaza('sistem', 'refuzul păstrează contul consultantului', 'există', stillThere ? 'există' : 'lipsește', !!stillThere, 'Bază de date')
  const { data: survivedRequest } = await service.from('document_requirements').select('id').eq('id', tempRequest).maybeSingle()
  noteaza('sistem', 'refuzul păstrează cererea de document', 'rămâne în proiect', survivedRequest ? 'rămâne' : 'lipsește', !!survivedRequest, 'Bază de date')
  const { data: tempMembership } = await service.from('project_members').select('id').eq('project_id', OWN).eq('consultant_id', temp.id).maybeSingle()
  noteaza('sistem', 'refuzul păstrează membership-ul', 'rămâne', tempMembership ? 'rămâne' : 'lipsește', !!tempMembership, 'Bază de date')
  verifica(admin, 'dezactivează consultantul cu date', await call(admin, 'POST', `/api/users/${temp.id}/deactivate`), 200)
  verifica(temp, 'JWT-ul dezactivat nu mai accesează platforma', await call(temp, 'GET', '/api/me'), 401)
  const { data: retainedRequest } = await service.from('document_requirements').select('id').eq('id', tempRequest).maybeSingle()
  expect(retainedRequest?.id).toBe(tempRequest)
  verifica(admin, 'reactivează consultantul', await call(admin, 'POST', `/api/users/${temp.id}/reactivate`), 200)
  verifica(temp, 'JWT-ul vechi rămâne revocat după reactivare', await call(temp, 'GET', '/api/me'), 401)
  const newTempToken = await signIn(temp.email, temp.password)
  verifica(temp, 'autentificarea nouă folosește aceeași parolă', await call(temp, 'GET', '/api/me', undefined, newTempToken), 200)

  const tempClientEmail = `matrice.${STAMP}.client-temporar@test.local`
  const tempClientCreation = await must(admin, 'POST', '/api/users', { email: tempClientEmail, password: PASSWORD, role: 'client', fullName: 'Client temporar', numeFirma: 'Firmă temporară SRL' })
  created.users.add(tempClientCreation.userId)
  const tempClient = await existing(tempClientEmail, await fixturePassword(tempClientCreation), 'client temporar')
  created.users.add(tempClient.id)
  await must(tempClient, 'POST', '/api/auth/audit', { action: 'login' })
  const tempClientProject = await project(`Matrice ${STAMP} — proiectul clientului temporar`, tempClient.id, [SA.id])
  verifica(admin, 'ștergerea clientului cu proiect este refuzată', await call(admin, 'DELETE', `/api/users/${tempClient.id}`), 409)
  const { data: clientStill } = await service.from('profiles').select('id').eq('id', tempClient.id).maybeSingle()
  const { data: projectStill } = await service.from('projects').select('id').eq('id', tempClientProject).maybeSingle()
  noteaza('sistem', 'refuzul păstrează clientul și proiectul', 'ambele păstrate', `cont ${clientStill ? 'existent' : 'lipsă'} / proiect ${projectStill ? 'existent' : 'lipsă'}`, !!clientStill && !!projectStill, 'Bază de date')
  verifica(admin, 'dezactivarea clientului păstrează proiectele', await call(admin, 'POST', `/api/users/${tempClient.id}/deactivate`), 200)
  expect((await service.from('projects').select('id').eq('id', tempClientProject).single()).data?.id).toBe(tempClientProject)

  const selfEmail = `matrice.${STAMP}.admin-propriu@test.local`
  const selfAdminCreation = await must(admin, 'POST', '/api/users', { email: selfEmail, password: PASSWORD, role: 'admin', fullName: 'Admin care testează contul propriu' })
  created.users.add(selfAdminCreation.userId)
  const selfAdmin = await existing(selfEmail, await fixturePassword(selfAdminCreation), 'admin temporar')
  created.users.add(selfAdmin.id)
  for (const action of ['delete', 'deactivate']) {
    const response = await call(selfAdmin, action === 'delete' ? 'DELETE' : 'POST', `/api/users/${selfAdmin.id}${action === 'delete' ? '' : '/deactivate'}`)
    verifica(selfAdmin, `${action} cont propriu este refuzat`, response, 409)
    expect(response.json.code).toBe('SELF_ACCOUNT_ACTION')
  }
  const { data: selfAudit } = await service.from('audit_logs').select('id').eq('entity_id', selfAdmin.id).eq('action_type', 'delete')
  noteaza('sistem', 'refuzul nu inventează audit de ștergere', 'zero intrări', `${(selfAudit ?? []).length} intrări`, (selfAudit ?? []).length === 0, 'Bază de date')

  const emptyEmail = `matrice.${STAMP}.cont-gol@test.local`
  const emptyCreated = await must(admin, 'POST', '/api/users', { email: emptyEmail, password: PASSWORD, role: 'consultant', fullName: 'Cont gol' })
  const emptyId = emptyCreated.user?.id ?? emptyCreated.profile?.id ?? (await service.from('profiles').select('id').eq('email', emptyEmail).single()).data?.id
  expect(emptyId).toBeTruthy()
  created.users.add(emptyId)
  verifica(admin, 'șterge definitiv contul fără relații', await call(admin, 'DELETE', `/api/users/${emptyId}`), 200)
  expect((await service.from('profiles').select('id').eq('id', emptyId).maybeSingle()).data).toBeNull()
  const { data: deletionAudit } = await service.from('audit_logs').select('old_values').eq('entity_id', emptyId).eq('action_type', 'delete')
  expect(deletionAudit).toHaveLength(1)
  expect(deletionAudit?.[0].old_values.email).toBe(emptyEmail)
  rand('Jurnal de audit — vizualizare/statistici', 'neschimbat: doar adminul')
  verifica(admin, 'citește jurnalul', await call(admin, 'GET', '/api/audit'), 200)
  for (const person of [SA, JA, client]) verifica(person, 'citește jurnalul', await call(person, 'GET', '/api/audit'), 403)

  rand('Înregistrare login/logout propriu', 'neschimbat: oricine, doar pentru el')
  for (const person of [admin, SA, JA, client]) {
    verifica(person, 'înregistrează propriul login', await call(person, 'POST', '/api/auth/audit', { action: 'login' }), 'permis')
  }
  verifica(JA, 'înregistrează o acțiune necunoscută', await call(JA, 'POST', '/api/auth/audit', { action: 'sterge-tot' }), 400)

  rand('Listare clienți', 'neschimbat: admin și consultant; clientul nu')
  for (const person of [admin, SA, JA]) verifica(person, 'listează clienții', await call(person, 'GET', '/api/clients'), 200)
  verifica(client, 'listează clienții', await call(client, 'GET', '/api/clients'), 403)

  rand('Vizualizare profil propriu (/api/me)', 'neschimbat')
  for (const person of [admin, SA, JA, client]) {
    const res = await call(person, 'GET', '/api/me')
    noteaza(person.who, 'citește /api/me', 'propriul profil', res.json?.profile?.id === person.id ? 'propriul profil' : `HTTP ${res.status}, alt profil`, res.status === 200 && res.json?.profile?.id === person.id, 'API')
  }
})

// ─── C. Proiecte, echipă, faze, activități, cereri ───────────────────────────

test('C. Proiecte, echipă, faze, activități, cereri de documente', async () => {
  sectiune('C. Proiecte, echipă, faze, activități, cereri de documente')

  rand('Vizualizare listă proiecte', 'neschimbat')
  const listOf = async (person: Person) => ((await call(person, 'GET', '/api/projects')).json.projects ?? []).map((p: Json) => p.id) as string[]
  const sees = (ids: string[], id: string) => (ids.includes(id) ? 'da' : 'nu')
  for (const [person, own, foreign] of [[admin, true, true], [SA, true, false], [JA, true, false], [JO, false, false], [client, true, false]] as const) {
    const ids = await listOf(person)
    noteaza(person.who, 'vede proiectul propriu / proiectul străin', `${own ? 'da' : 'nu'} / ${foreign ? 'da' : 'nu'}`, `${sees(ids, OWN)} / ${sees(ids, FOREIGN)}`, ids.includes(OWN) === own && ids.includes(FOREIGN) === foreign, 'API')
  }
  if (client2) {
    const ids = await listOf(client2)
    noteaza(client2.who, 'vede proiectul propriu / proiectul străin', 'nu / da', `${sees(ids, OWN)} / ${sees(ids, FOREIGN)}`, !ids.includes(OWN) && ids.includes(FOREIGN), 'API')
  }

  rand('Creare proiect', 'schimbat: decizia din 1 octombrie 2026 — doar adminul și seniorul (PDF: orice consultant)')
  for (const [person, expected] of [[admin, 'permis'], [SA, 'permis'], [JA, 403], [client, 403]] as const) {
    const res = await call(person, 'POST', '/api/projects', { title: `Matrice ${STAMP} — creat de ${person.who}`, client_id: client.id, supervisor_ids: [SA.id] })
    if (res.json?.project?.id) created.projects.add(res.json.project.id)
    verifica(person, 'creează un proiect', res, expected)
  }

  rand('Editare proiect (titlu, status, client, consultant general, remindere)', 'schimbat prin #104: seniorul membru editează titlul, statusul, reminderele; reasignarea rămâne la admin')
  verifica(admin, 'redenumește proiectul', await call(admin, 'PATCH', `/api/projects/${OWN}`, { title: `Matrice ${STAMP} — proiect propriu` }), 200)
  verifica(SA, 'redenumește proiectul', await call(SA, 'PATCH', `/api/projects/${OWN}`, { title: `Matrice ${STAMP} — proiect propriu` }), 200)
  verifica(SA, 'schimbă clientul proiectului', await call(SA, 'PATCH', `/api/projects/${OWN}`, { client_id: client2?.id ?? client.id }), 403)
  for (const person of [JA, JO, client]) verifica(person, 'redenumește proiectul', await call(person, 'PATCH', `/api/projects/${OWN}`, { title: 'Redenumit' }), 403)

  rand('Ștergere proiect', 'neschimbat: doar adminul')
  const victim = await project(`Matrice ${STAMP} — de șters`, client.id, [SA.id])
  for (const person of [SA, JA, client]) verifica(person, 'șterge proiectul', await call(person, 'DELETE', `/api/projects/${victim}`), 403)
  verifica(admin, 'șterge proiectul', await call(admin, 'DELETE', `/api/projects/${victim}`), 'permis')

  rand('Listare consultanți disponibili pt. proiect', 'schimbat prin #104: și seniorul membru')
  verifica(admin, 'listează consultanții disponibili', await call(admin, 'GET', `/api/projects/${OWN}/available-consultants`), 200)
  verifica(SA, 'listează consultanții disponibili', await call(SA, 'GET', `/api/projects/${OWN}/available-consultants`), 200)
  for (const person of [JA, JO, client]) verifica(person, 'listează consultanții disponibili', await call(person, 'GET', `/api/projects/${OWN}/available-consultants`), 403)

  rand('Adăugare/scoatere membru din echipă', 'schimbat prin #104: seniorul membru (scoate doar juniori); blocată dacă are sarcini')
  verifica(JA, 'adaugă un coleg', await call(JA, 'POST', `/api/projects/${OWN}/members`, { consultant_id: JO.id }), 403)
  verifica(client, 'adaugă un coleg', await call(client, 'POST', `/api/projects/${OWN}/members`, { consultant_id: JO.id }), 403)
  const added = await call(SA, 'POST', `/api/projects/${OWN}/members`, { consultant_id: JO.id })
  verifica(SA, 'adaugă un coleg', added, 'permis')
  verifica(SA, 'scoate colegul adăugat', await call(SA, 'DELETE', `/api/projects/${OWN}/members/${added.json?.member?.id}`), 'permis')
  await must(admin, 'PATCH', `/api/projects/${OWN}/phases/${PHASE}/activities/${ACTIVITY}`, { assigned_to: JA.id })
  const { data: jaMember } = await service.from('project_members').select('id').eq('project_id', OWN).eq('consultant_id', JA.id).single()
  verifica(admin, 'scoate un membru cu o activitate atribuită', await call(admin, 'DELETE', `/api/projects/${OWN}/members/${jaMember!.id}`), 409)

  rand('Vizualizare echipă proiect', 'neschimbat: oricine are acces la proiect, inclusiv clientul')
  for (const person of [admin, SA, JA, client]) verifica(person, 'vede echipa', await call(person, 'GET', `/api/projects/${OWN}/members`), 200)
  verifica(JO, 'vede echipa unui proiect străin', await call(JO, 'GET', `/api/projects/${OWN}/members`), 403)
  if (client2) verifica(client2, 'vede echipa proiectului altui client', await call(client2, 'GET', `/api/projects/${OWN}/members`), 403)

  rand('Creare/editare/publicare fază sau activitate', 'neschimbat: admin și consultanți, nu clientul; mereu creată ca ciornă')
  for (const person of [admin, SA, JA]) {
    const res = await call(person, 'POST', `/api/projects/${OWN}/phases`, { name: `Fază de ${person.who}` })
    verifica(person, 'adaugă o fază', res, 'permis')
    noteaza(person.who, 'faza nouă pornește ca ciornă', 'draft', String(res.json?.phase?.visibility), res.json?.phase?.visibility === 'draft', 'API')
  }
  verifica(client, 'adaugă o fază', await call(client, 'POST', `/api/projects/${OWN}/phases`, { name: 'Fază de client' }), 403)
  verifica(JA, 'redenumește activitatea', await call(JA, 'PATCH', `/api/projects/${OWN}/phases/${PHASE}/activities/${ACTIVITY}`, { name: 'Activitatea matricei' }), 200)
  verifica(client, 'redenumește activitatea', await call(client, 'PATCH', `/api/projects/${OWN}/phases/${PHASE}/activities/${ACTIVITY}`, { name: 'De client' }), 403)
  const deadline = new Date(Date.now() + 14 * 86_400_000).toISOString()
  verifica(JA, 'publică activitatea (cu responsabil și termen)', await call(JA, 'PATCH', `/api/projects/${OWN}/phases/${PHASE}/activities/${ACTIVITY}`, { assigned_to: JA.id, deadline_at: deadline, visibility: 'published' }), 200)

  rand('Ștergere fază sau activitate', 'schimbat prin #104: și seniorul membru')
  const scratchPhase = (await must(admin, 'POST', `/api/projects/${OWN}/phases`, { name: 'Fază de șters' })).phase.id
  const scratch = async () => (await must(admin, 'POST', `/api/projects/${OWN}/phases/${scratchPhase}/activities`, { name: `De șters ${randomUUID().slice(0, 4)}` })).activity.id as string
  for (const person of [JA, client]) verifica(person, 'șterge o activitate', await call(person, 'DELETE', `/api/projects/${OWN}/phases/${scratchPhase}/activities/${await scratch()}`), 403)
  verifica(SA, 'șterge o activitate', await call(SA, 'DELETE', `/api/projects/${OWN}/phases/${scratchPhase}/activities/${await scratch()}`), 'permis')
  verifica(admin, 'șterge o activitate', await call(admin, 'DELETE', `/api/projects/${OWN}/phases/${scratchPhase}/activities/${await scratch()}`), 'permis')
  verifica(JA, 'șterge o fază', await call(JA, 'DELETE', `/api/projects/${OWN}/phases/${scratchPhase}`), 403)
  verifica(SA, 'șterge o fază', await call(SA, 'DELETE', `/api/projects/${OWN}/phases/${scratchPhase}`), 'permis')

  rand('Duplicare fază/activitate', 'neschimbat: admin și consultanți')
  verifica(JA, 'duplică o activitate', await call(JA, 'POST', `/api/projects/${OWN}/phases/${PHASE}/activities/${ACTIVITY}/duplicate`, {}), 'permis')
  verifica(SA, 'duplică o fază', await call(SA, 'POST', `/api/projects/${OWN}/phases/${PHASE}/duplicate`, {}), 'permis')
  verifica(client, 'duplică o activitate', await call(client, 'POST', `/api/projects/${OWN}/phases/${PHASE}/activities/${ACTIVITY}/duplicate`, {}), 403)

  rand('Creare/editare/publicare cerere de document', 'neschimbat: admin și consultanți; documentele trimise clientului cer atașament')
  for (const person of [admin, SA, JA]) {
    verifica(person, 'creează o cerere', await call(person, 'POST', `/api/projects/${OWN}/document-requests`, { name: `Cerere de ${person.who}`, activity_id: ACTIVITY }), 'permis')
  }
  verifica(client, 'creează o cerere', await call(client, 'POST', `/api/projects/${OWN}/document-requests`, { name: 'Cerere de client', activity_id: ACTIVITY }), 403)
  verifica(JA, 'creează un document trimis clientului fără atașament', await call(JA, 'POST', `/api/projects/${OWN}/document-requests`, { name: 'Document trimis fără fișier', activity_id: ACTIVITY, is_outgoing: true }), 400)
  const editable = await request(JA, OWN, 'Cerere de redenumit', ACTIVITY)
  verifica(JA, 'redenumește cererea', await call(JA, 'PATCH', `/api/document-requests/${editable}`, { name: 'Cerere redenumită' }), 200)
  verifica(client, 'redenumește cererea', await call(client, 'PATCH', `/api/document-requests/${editable}`, { name: 'Redenumită de client' }), 403)

  rand('Ștergere cerere de document', 'neschimbat: admin și consultanți; soft-delete, idempotent')
  const deletable = await request(JA, OWN, 'Cerere de șters', ACTIVITY)
  verifica(client, 'șterge cererea', await call(client, 'DELETE', `/api/document-requests/${deletable}`), 403)
  verifica(JA, 'șterge cererea', await call(JA, 'DELETE', `/api/document-requests/${deletable}`), 'permis')
  verifica(JA, 'șterge din nou aceeași cerere', await call(JA, 'DELETE', `/api/document-requests/${deletable}`), 'permis')
  const { data: soft } = await service.from('document_requirements').select('deleted_at').eq('id', deletable).maybeSingle()
  noteaza('sistem', 'cererea ștearsă rămâne în bază, marcată', 'deleted_at setat', soft?.deleted_at ? 'deleted_at setat' : 'rândul lipsește sau nemarcat', !!soft?.deleted_at, 'Bază de date')

  rand('Aprobare/respingere document încărcat de client', 'neschimbat: orice membru al echipei')
  const inReview = async () => {
    const id = await request(admin, OWN, `Cerere în verificare ${randomUUID().slice(0, 4)}`)
    await uploadFixture(id, 1)
    await service.from('document_requirements').update({ status: 'review' }).eq('id', id)
    return id
  }
  verifica(client, 'aprobă documentul', await call(client, 'POST', `/api/document-requests/${await inReview()}/review`, { action: 'approved' }), 403)
  verifica(JO, 'aprobă documentul dintr-un proiect străin', await call(JO, 'POST', `/api/document-requests/${await inReview()}/review`, { action: 'approved' }), 403)
  verifica(JA, 'aprobă documentul', await call(JA, 'POST', `/api/document-requests/${await inReview()}/review`, { action: 'approved' }), 'permis')
  verifica(SA, 'respinge documentul', await call(SA, 'POST', `/api/document-requests/${await inReview()}/review`, { action: 'rejected', notes: 'Lipsește semnătura' }), 'permis')

  rand('Retrimitere manuală reminder pt. o cerere', 'neschimbat: admin sau consultant membru; clientul niciodată')
  const remindable = await request(admin, OWN, 'Cerere cu reminder')
  await service.from('document_requirements').update({ visibility: 'published', status: 'pending', deadline_at: deadline }).eq('id', remindable)
  verifica(client, 'trimite reminderul', await call(client, 'POST', `/api/document-requests/${remindable}/reminder`), 403)
  verifica(JO, 'trimite reminderul dintr-un proiect străin', await call(JO, 'POST', `/api/document-requests/${remindable}/reminder`), 403)
  verifica(JA, 'trimite reminderul', await call(JA, 'POST', `/api/document-requests/${remindable}/reminder`), 'permis')

  rand('Descărcare fișier / descărcare „tot” (zip)', 'neschimbat: clientul vede doar ultima versiune')
  const versioned = await request(admin, OWN, 'Cerere cu două versiuni')
  await service.from('document_requirements').update({ visibility: 'published' }).eq('id', versioned)
  const v1 = await uploadFixture(versioned, 1)
  const v2 = await uploadFixture(versioned, 2)
  verifica(JA, 'descarcă versiunea veche', await call(JA, 'POST', `/api/files/${v1}/signed-download`), 'permis')
  verifica(client, 'descarcă ultima versiune', await call(client, 'POST', `/api/files/${v2}/signed-download`), 'permis')
  verifica(client, 'descarcă versiunea veche', await call(client, 'POST', `/api/files/${v1}/signed-download`), 404)
  verifica(JO, 'descarcă un fișier dintr-un proiect străin', await call(JO, 'POST', `/api/files/${v2}/signed-download`), 403)
  verifica(JA, 'descarcă ambele versiuni ca zip', await call(JA, 'POST', '/api/files/bulk-archive', { fileIds: [v1, v2] }), 'permis')
  verifica(client, 'descarcă ambele versiuni ca zip', await call(client, 'POST', '/api/files/bulk-archive', { fileIds: [v1, v2] }), 404)

  rand('Upload răspuns (fișiere client)', 'neschimbat: oricine are acces la cerere')
  const file = { files: [{ name: 'raspuns.pdf', size: 1024, type: 'application/pdf' }] }
  for (const person of [client, JA, admin]) verifica(person, 'pregătește încărcarea unui fișier', await call(person, 'POST', `/api/document-requests/${versioned}/uploads/init`, file), 'permis')
  verifica(JO, 'pregătește încărcarea într-un proiect străin', await call(JO, 'POST', `/api/document-requests/${versioned}/uploads/init`, file), 403)
  if (client2) verifica(client2, 'pregătește încărcarea în proiectul altui client', await call(client2, 'POST', `/api/document-requests/${versioned}/uploads/init`, file), 403)

  rand('Calendar general (toate proiectele)', 'neschimbat: clientul nu are calendarul general, doar pe al proiectului lui')
  for (const person of [admin, SA, JA]) verifica(person, 'deschide calendarul general', await call(person, 'GET', '/api/calendar'), 200)
  verifica(client, 'deschide calendarul general', await call(client, 'GET', '/api/calendar'), 403)
  verifica(client, 'deschide calendarul propriului proiect', await call(client, 'GET', `/api/calendar?project_id=${OWN}`), 200)

  rand('Reminder automat (cron)', 'neschimbat: doar cu cheia secretă')
  verifica({ who: 'fără cont' }, 'pornește cronul fără cheie', await call(admin, 'GET', '/api/cron/deadline-reminders', undefined, ''), 401)
  verifica({ who: 'fără cont' }, 'pornește cronul cu o cheie greșită', await call(admin, 'GET', '/api/cron/deadline-reminders', undefined, 'gresit'), 401)
  verifica(admin, 'pornește cronul cu tokenul de admin', await call(admin, 'GET', '/api/cron/deadline-reminders'), 401)
})

// ─── D. Chat, conversații private, notificări ────────────────────────────────

test('D. Chat, conversații private, notificări', async () => {
  sectiune('D. Chat, conversații private, notificări')

  rand('Chat de proiect — citire/scriere mesaje', 'neschimbat: oricine are acces la proiect, inclusiv clientul')
  const messages: Record<string, string> = {}
  for (const person of [admin, SA, JA, client]) {
    verifica(person, 'citește chatul', await call(person, 'GET', `/api/projects/${OWN}/chat/messages`), 200)
    const res = await call(person, 'POST', `/api/projects/${OWN}/chat/messages`, { body: `Mesaj de ${person.who} ${STAMP}` })
    verifica(person, 'scrie în chat', res, 201)
    messages[person.who] = res.json?.item?.id
  }
  verifica(JO, 'citește chatul unui proiect străin', await call(JO, 'GET', `/api/projects/${OWN}/chat/messages`), 403)
  if (client2) verifica(client2, 'citește chatul proiectului altui client', await call(client2, 'GET', `/api/projects/${OWN}/chat/messages`), 403)

  rand('Editare/ștergere mesaj propriu (chat proiect)', 'schimbat prin #104: seniorul șterge mesajele altora; textul altcuiva îl schimbă doar adminul')
  verifica(client, 'își editează mesajul', await call(client, 'PATCH', `/api/projects/${OWN}/chat/messages/${messages.client}`, { body: 'Mesaj de client, editat' }), 200)
  verifica(JA, 'editează mesajul seniorului', await call(JA, 'PATCH', `/api/projects/${OWN}/chat/messages/${messages.senior}`, { body: 'Schimbat de junior' }), 403)
  verifica(JA, 'șterge mesajul seniorului', await call(JA, 'DELETE', `/api/projects/${OWN}/chat/messages/${messages.senior}`), 403)
  verifica(SA, 'editează mesajul juniorului', await call(SA, 'PATCH', `/api/projects/${OWN}/chat/messages/${messages.junior}`, { body: 'Schimbat de senior' }), 403)
  verifica(admin, 'editează mesajul juniorului', await call(admin, 'PATCH', `/api/projects/${OWN}/chat/messages/${messages.junior}`, { body: 'Corectat de admin' }), 200)
  verifica(SA, 'șterge mesajul clientului', await call(SA, 'DELETE', `/api/projects/${OWN}/chat/messages/${messages.client}`), 'permis')
  verifica(JA, 'își șterge mesajul', await call(JA, 'DELETE', `/api/projects/${OWN}/chat/messages/${messages.junior}`), 'permis')

  rand('Conversații private (chat intern)', 'neschimbat: doar admin și consultanți între ei')
  const conversation = await call(JA, 'POST', '/api/private-conversations', { userId: admin.id })
  verifica(JA, 'deschide o conversație cu adminul', conversation, 'permis')
  verifica(SA, 'deschide o conversație cu juniorul', await call(SA, 'POST', '/api/private-conversations', { userId: JA.id }), 'permis')
  verifica(client, 'deschide o conversație cu un consultant', await call(client, 'POST', '/api/private-conversations', { userId: SA.id }), 403)
  verifica(SA, 'deschide o conversație cu un client', await call(SA, 'POST', '/api/private-conversations', { userId: client.id }), 403)

  rand('Editare/ștergere mesaj propriu (chat privat)', 'neschimbat: doar autorul; adminul nu le poate suprascrie')
  const conversationId = conversation.json?.item?.id
  const privateMessage = await call(JA, 'POST', `/api/private-conversations/${conversationId}/messages`, { body: `Mesaj privat ${STAMP}` })
  verifica(JA, 'scrie un mesaj privat', privateMessage, 201)
  const messageId = privateMessage.json?.item?.id
  verifica(admin, 'editează mesajul privat al juniorului', await call(admin, 'PATCH', `/api/private-conversations/${conversationId}/messages/${messageId}`, { body: 'Schimbat de admin' }), 403)
  verifica(admin, 'șterge mesajul privat al juniorului', await call(admin, 'DELETE', `/api/private-conversations/${conversationId}/messages/${messageId}`), 403)
  verifica(JA, 'își editează mesajul privat', await call(JA, 'PATCH', `/api/private-conversations/${conversationId}/messages/${messageId}`, { body: 'Mesaj privat, editat' }), 200)
  verifica(SA, 'citește o conversație în care nu participă', await call(SA, 'GET', `/api/private-conversations/${conversationId}/messages`), 403)

  rand('Notificări — vizualizare/marcare citit', 'neschimbat: oricine, doar ale lui')
  for (const person of [admin, SA, JA, client]) {
    const res = await call(person, 'GET', '/api/notifications')
    const items = (res.json.items ?? res.json.notifications ?? []) as Json[]
    noteaza(person.who, 'își citește notificările', 'doar ale lui', res.status !== 200 ? `HTTP ${res.status}` : `${items.length} notificări, ${items.every(n => !n.user_id || n.user_id === person.id) ? 'toate ale lui' : 'și ale altora'}`,
      res.status === 200 && items.every(n => !n.user_id || n.user_id === person.id), 'API')
  }
  const { data: foreignNotification } = await service.from('notifications').select('id, read_at').eq('user_id', SA.id).is('read_at', null).limit(1).maybeSingle()
  if (foreignNotification) {
    await call(JA, 'POST', '/api/notifications/read', { ids: [foreignNotification.id] })
    const { data: after } = await service.from('notifications').select('read_at').eq('id', foreignNotification.id).single()
    noteaza('junior', 'marchează ca citită o notificare a seniorului', 'rămâne necitită', after?.read_at ? 'marcată citită' : 'rămâne necitită', !after?.read_at, 'Bază de date')
  }

  rand('„Ale mele” — activități/cereri asignate mie', 'neschimbat: doar din proiectele unde e membru')
  await service.from('project_activities').update({ assigned_to: JA.id }).eq('id', FOREIGN_ACTIVITY)
  const mine = await call(JA, 'GET', '/api/my-activities')
  const mineIds = ((mine.json.activities ?? []) as Json[]).map(a => a.id)
  noteaza('junior', 'activitățile mele: proiectul propriu / o activitate atribuită lui într-un proiect străin', 'da / nu',
    `${mineIds.includes(ACTIVITY) ? 'da' : 'nu'} / ${mineIds.includes(FOREIGN_ACTIVITY) ? 'da' : 'nu'}`, mineIds.includes(ACTIVITY) && !mineIds.includes(FOREIGN_ACTIVITY), 'API')
  const clientRequests = await call(client, 'GET', '/api/my-document-requests')
  const projects = new Set(((clientRequests.json.requests ?? []) as Json[]).map(r => r.project_id ?? r.project?.id))
  noteaza('client', 'cererile mele: doar din proiectele lui', 'fără proiectul străin', projects.has(FOREIGN) ? 'conține proiectul străin' : 'fără proiectul străin', clientRequests.status === 200 && !projects.has(FOREIGN), 'API')
})

// ─── Interfața, pe roluri ────────────────────────────────────────────────────

test('Interfața, pe roluri: ce vede fiecare în paginile din PDF', async ({ browser }) => {
  sectiune('Interfața, pe roluri')
  const pages: Array<[string, string, string, (page: Page) => Promise<{ ok: boolean; actual: string }>, string]> = [
    ['Vizualizare listă proiecte', 'client', '/', async page => {
      const seen = await page.getByText(`Matrice ${STAMP} — proiect propriu`).first().isVisible().catch(() => false)
      const foreign = await page.getByText(`Matrice ${STAMP} — proiect străin`).count()
      return { ok: seen && foreign === 0, actual: `${seen ? 'vede' : 'nu vede'} proiectul lui, ${foreign ? 'vede' : 'nu vede'} proiectul străin` }
    }, 'vede doar proiectul lui'],
    ['Vizualizare listă proiecte', 'junior', '/', async page => {
      const seen = await page.getByText(`Matrice ${STAMP} — proiect propriu`).first().isVisible().catch(() => false)
      const foreign = await page.getByText(`Matrice ${STAMP} — proiect străin`).count()
      return { ok: seen && foreign === 0, actual: `${seen ? 'vede' : 'nu vede'} proiectul propriu, ${foreign ? 'vede' : 'nu vede'} proiectul străin` }
    }, 'vede doar proiectul în care e membru'],
    ['Calendar general (toate proiectele)', 'client', '/calendar', async page => {
      await page.waitForURL(url => url.pathname === '/', { timeout: 15_000 }).catch(() => {})
      const pathname = new URL(page.url()).pathname
      const message = await seen(page.getByText(/Calendarul general e pentru echipa de consultanță/), 3_000)
      const navLink = await page.getByRole('link', { name: 'Calendar', exact: true }).count()
      const blocked = pathname === '/' || message
      return { ok: blocked && navLink === 0, actual: `${pathname === '/' ? 'trimis pe prima pagină' : message ? 'mesajul de blocare' : `pe ${pathname}`}, ${navLink ? 'cu' : 'fără'} „Calendar” în meniu` }
    }, 'blocat: trimis înapoi, fără „Calendar” în meniu'],
    ['Calendar general (toate proiectele)', 'junior', '/calendar', async page => {
      const blocked = await page.getByText(/Calendarul general e pentru echipa de consultanță/).count()
      return { ok: blocked === 0, actual: blocked ? 'blocat' : 'calendarul se deschide' }
    }, 'calendarul se deschide'],
    ['Conversații private (chat intern)', 'client', '/chat', async page => {
      const blocked = await seen(page.getByRole('heading', { name: 'Chat indisponibil' }))
      return { ok: blocked, actual: blocked ? '„Chat indisponibil”' : 'conversațiile se deschid' }
    }, '„Chat indisponibil”'],
    ['Conversații private (chat intern)', 'junior', '/chat', async page => {
      const url = new URL(page.url()).pathname
      return { ok: url === '/chat', actual: `pagina ${url}` }
    }, 'conversațiile private se deschid'],
    ['Notificări — vizualizare/marcare citit', 'junior', '/notificari', async page => {
      const heading = await page.getByRole('heading', { level: 1, name: 'Notificări' }).isVisible().catch(() => false)
      return { ok: heading, actual: heading ? 'pagina se deschide' : 'lipsește' }
    }, 'pagina „Notificări”'],
    ['„Ale mele” — activități/cereri asignate mie', 'client', '/my-requests', async page => {
      const foreign = await page.getByText(`Matrice ${STAMP} — proiect străin`).count()
      return { ok: foreign === 0, actual: foreign ? 'apare proiectul străin' : 'doar cererile lui' }
    }, 'doar cererile lui'],
    ['Vizualizare șabloane (draft + publicate)', 'junior', '/admin/templates', async page => {
      const shown = await seen(page.getByText(`Matrice ${STAMP} — ciornă`, { exact: true }))
      return { ok: shown, actual: shown ? 'vede ciorna adminului' : 'nu vede ciorna' }
    }, 'vede și ciornele'],
    ['Vizualizare șabloane (draft + publicate)', 'client', '/admin/templates', async page => {
      const draft = await page.getByText(`Matrice ${STAMP} — ciornă`, { exact: true }).count()
      return { ok: draft === 0, actual: draft ? 'vede ciorna' : `nu vede șabloanele (pe ${new URL(page.url()).pathname})` }
    }, 'nu vede șabloanele'],
  ]
  const people: Record<string, Person> = { client, junior: JA }
  for (const [row, who, url, verify, expected] of pages) {
    const person = people[who]
    const { context, page } = await login(browser, person)
    try {
      await page.goto(url)
      await settle(page)
      const outcome = await verify(page)
      const shot = await dovezi.captura(page, `${who}-${url}`, { fullPage: true })
      RAND = { titlu: row, fataDePdf: 'vezi rândul din secțiunile A–D' }
      noteaza(who, `deschide ${url}`, expected, outcome.actual, outcome.ok, 'Interfață', { capturi: [shot] })
    } finally {
      await context.close()
    }
  }
})

// ─── Rezultatul ──────────────────────────────────────────────────────────────

test('Matricea de acces — fără abateri noi', async () => {
  const abateri = dovezi.abateri()
  const cunoscute = dovezi.items.filter(item => !item.ok && item.cunoscut)
  console.log(`Puncte: ${dovezi.items.length}, respectate: ${dovezi.items.filter(item => item.ok).length}, abateri noi: ${abateri.length}, defecte cunoscute: ${cunoscute.length}`)
  for (const item of cunoscute) console.log(`ℹ [${item.rand}] ${item.cine} · ${item.punct}: ${item.obtinut}`)
  expect(abateri.map(a => `✗ [${a.rand}] ${a.cine} · ${a.punct}: așteptat ${a.asteptat}, obținut ${a.obtinut}`).join('\n'), 'abateri').toBe('')
})
