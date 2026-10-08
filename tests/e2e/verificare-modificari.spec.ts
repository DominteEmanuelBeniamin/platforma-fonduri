import { test, expect, type Browser, type Locator, type Page } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { e2eEnv, requireE2EConfig, serviceClient, setLocalFixturePassword } from './helpers/project-state'
import { createDovezi, emailuriPrimite, type EmailCapturat, type Strat } from './helpers/dovezi'

/**
 * Verificarea modificărilor din 1 octombrie 2026, punct cu punct, cu capturi:
 *  1. profilurile se citesc din browser doar pe propriul rând;
 *  2. juniorul nu deschide dosare (interfață, API, import);
 *  3. „Dosar nou” din șablon: consultanții de pe activități intră în echipă și
 *     primesc activitatea dintr-o singură cerere, cu notificări și un lot de emailuri;
 *  4. importul refuză fără urme ce nu are voie;
 *  5. crearea proiectului își păstrează validările (verificările rulează acum în paralel);
 *  6. eticheta „Modificări neaplicate” se aprinde doar pe șabloanele publicate;
 *  7. atribuirea din proiect trimite în continuare email și notificare.
 *
 * Dovezile ajung în playwright-report/dovezi/modificari (dovezi.json + capturi).
 * Emailurile se verifică doar când aplicația rulează cu serverul Resend de
 * test (tests/e2e/helpers/resend-mock.mjs) și E2E_RESEND_LOG arată spre jurnalul lui.
 */

const ENV = e2eEnv()
const CONFIG = requireE2EConfig(ENV)
const ADMIN_LOGIN = { email: ENV.E2E_ADMIN_EMAIL || CONFIG.staffEmail, password: ENV.E2E_ADMIN_PASSWORD || CONFIG.staffPassword }
const STAMP = Date.now().toString(36)
const PASSWORD = `Verificare-${STAMP}-2026!`

test.describe.configure({ mode: 'serial' })
test.setTimeout(180_000)
// Un selector greșit pică în 20 s, nu la expirarea testului.
test.use({ actionTimeout: 20_000, navigationTimeout: 45_000 })

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Person = { id: string; email: string; name: string; password: string; token: string; who: string }

const dovezi = createDovezi('modificari')
const service = serviceClient() as SupabaseClient
const created = { projects: new Set<string>(), templates: new Set<string>() }
const accounts = new Set<string>()
let admin: Person, client: Person, SA: Person, JA: Person, JB: Person, JC: Person
let statusId = ''
let TPL = '', TPL_NAME = '', DRAFT = '', DRAFT_NAME = ''
let DOSAR = '' // dosarul deschis de senior în punctul 3

/** Numele accesibil al unui radio include și descrierea șablonului: potrivire după conținut. */
const exact = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))

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

async function fixedConsultant(tag: 'sa' | 'ja' | 'jb' | 'jc', level: 'junior' | 'senior', who: string): Promise<Person> {
  const email = `verificare.${tag}@test.local`
  const name = `Verificare — ${{ sa: 'Senior A', ja: 'Junior A', jb: 'Junior B', jc: 'Junior fără proiecte' }[tag]}`
  const { data } = await service.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
  let id = data?.user?.id
  if (!id) {
    const { data: existing } = await service.from('profiles').select('id').eq('email', email).single()
    id = existing!.id as string
    setLocalFixturePassword(id, PASSWORD)
  }
  accounts.add(id)
  await service.from('profiles').upsert({ id, email, role: 'consultant', consultant_level: level, full_name: name, is_active: true })
  return { id, email, name, password: PASSWORD, token: await signIn(email, PASSWORD), who }
}

async function call(who: Person, method: string, url: string, body?: unknown) {
  const res = await fetch(`${CONFIG.baseUrl}${url}`, {
    method,
    headers: { Authorization: `Bearer ${who.token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Json }
}

async function must(who: Person, method: string, url: string, body?: unknown) {
  const res = await call(who, method, url, body)
  if (res.status >= 300) throw new Error(`${method} ${url} → ${res.status} ${JSON.stringify(res.json).slice(0, 300)}`)
  return res.json
}

async function newProject(title: string, supervisors: string[] = [SA.id]) {
  const json = await must(admin, 'POST', '/api/projects', { title, client_id: client.id, supervisor_ids: supervisors })
  created.projects.add(json.project.id)
  return json.project.id as string
}

async function memberIds(projectId: string) {
  const { data } = await service.from('project_members').select('consultant_id').eq('project_id', projectId)
  return (data ?? []).map(row => row.consultant_id as string)
}

async function phaseCount(projectId: string) {
  const { count } = await service.from('project_phases').select('id', { count: 'exact', head: true }).eq('project_id', projectId)
  return count ?? 0
}

async function login(browser: Browser, person: { email: string; password: string }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/login')
  await page.fill('input[type=email]', person.email)
  await page.fill('input[type=password]', person.password)
  await page.click('button[type=submit]')
  await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 30_000 })
  return { context, page, errors }
}

async function home(page: Page) {
  await page.goto('/')
  await page.getByRole('heading', { level: 1, name: /^Salut/ }).waitFor({ timeout: 30_000 })
}

async function openProject(page: Page, projectId: string, query = '') {
  await page.goto(`/projects/${projectId}${query}`)
  await page.getByRole('button', { name: /^Chat/ }).first().waitFor({ timeout: 30_000 })
}

function punct(
  zona: string,
  cine: string,
  text: string,
  asteptat: string,
  obtinut: string,
  ok: boolean,
  strat: Strat,
  capturi: string[] = [],
) {
  return dovezi.noteaza({ zona, cine, punct: text, asteptat, obtinut, ok, strat, capturi })
}

/** Un răspuns HTTP ca dovadă: statusul așteptat și mesajul primit. */
function raspuns(zona: string, cine: string, text: string, res: { status: number; json: Json }, expected: number) {
  const message = res.json?.message ?? res.json?.error
  return punct(zona, cine, text, `HTTP ${expected}`, `HTTP ${res.status}${message ? ` — ${String(message).slice(0, 160)}` : ''}`, res.status === expected, 'API')
}

function emailuriNoi(before: number) {
  const log = emailuriPrimite()
  return log ? log.slice(before) : null
}

function emailuriAcum() {
  return emailuriPrimite()?.length ?? 0
}

function emailCatre(entries: EmailCapturat[], email: string) {
  for (const entry of entries) {
    const list = Array.isArray(entry.body) ? entry.body : [entry.body]
    for (const item of list as Json[]) {
      const to = Array.isArray(item?.to) ? item.to : [item?.to]
      if (to.includes(email)) return item
    }
  }
  return null
}

async function addEditorPhase(page: Page, name: string) {
  const inputs = page.getByLabel(/^Nume pentru faza \d+$/)
  const before = await inputs.count()
  await page.getByRole('button', { name: 'Adaugă fază nouă' }).click()
  await page.getByLabel(`Nume pentru faza ${before + 1}`, { exact: true }).fill(name)
}

async function flag(templateId: string) {
  const { data } = await service.from('project_templates').select('unpropagated_changes_at').eq('id', templateId).single()
  return data?.unpropagated_changes_at as string | null
}

// ─── Pregătire și curățenie ──────────────────────────────────────────────────

test.beforeAll(async () => {
  dovezi.reset()
  const { data: adminProfile } = await service.from('profiles').select('id, email, full_name').eq('email', ADMIN_LOGIN.email).single()
  admin = { id: adminProfile!.id, email: adminProfile!.email, name: adminProfile!.full_name, password: ADMIN_LOGIN.password, token: await signIn(ADMIN_LOGIN.email, ADMIN_LOGIN.password), who: 'admin' }
  const { data: clientProfile } = await service.from('profiles').select('id, email, full_name').eq('email', CONFIG.clientEmail).single()
  client = { id: clientProfile!.id, email: clientProfile!.email, name: clientProfile!.full_name, password: CONFIG.clientPassword, token: await signIn(CONFIG.clientEmail, CONFIG.clientPassword), who: 'client' }
  statusId = (await service.from('project_statuses').select('id').order('id').limit(1).single()).data!.id

  SA = await fixedConsultant('sa', 'senior', 'senior')
  JA = await fixedConsultant('ja', 'junior', 'junior')
  JB = await fixedConsultant('jb', 'junior', 'junior')
  JC = await fixedConsultant('jc', 'junior', 'junior')

  TPL_NAME = `Verificare ${STAMP} — șablon publicat`
  const tree = {
    name: TPL_NAME, slug: `verificare-${STAMP}`, description: 'Șablon pentru verificarea modificărilor',
    phases: [{
      id: 'p0', name: 'Pregătire', project_status_id: statusId,
      activities: [
        { id: 'a0', name: 'Activitate cu implicit anulat', default_consultant_id: SA.id, document_requirements: [] },
        { id: 'a1', name: 'Activitate pentru juniorul A', default_consultant_id: null, document_requirements: [] },
        { id: 'a2', name: 'Activitate cu implicit păstrat', default_consultant_id: SA.id, document_requirements: [] },
        { id: 'a3', name: 'Activitate pentru juniorul B', default_consultant_id: null, document_requirements: [] },
      ],
    }],
  }
  const template = (await must(admin, 'POST', '/api/admin/templates', tree)).template
  created.templates.add(template.id)
  await must(admin, 'PATCH', `/api/admin/templates/${template.id}`, { status: 'published' })
  TPL = template.id

  DRAFT_NAME = `Verificare ${STAMP} — ciornă`
  const draft = (await must(admin, 'POST', '/api/admin/templates', {
    name: DRAFT_NAME, slug: `verificare-ciorna-${STAMP}`, description: 'Ciornă pentru eticheta de propagare',
    phases: [{ id: 'p0', name: 'Etapa întâi', project_status_id: statusId, activities: [] }],
  })).template
  created.templates.add(draft.id)
  DRAFT = draft.id
})

test.afterAll(async () => {
  dovezi.scrie({ baseUrl: CONFIG.baseUrl, stamp: STAMP, emailuri: !!process.env.E2E_RESEND_LOG })
  if (!service) return
  for (const id of created.projects) await service.from('projects').delete().eq('id', id)
  for (const id of created.templates) await service.from('project_templates').delete().eq('id', id)
  for (const id of accounts) await service.from('profiles').update({ consultant_level: 'junior', is_active: false }).eq('id', id)
})

// ─── 1. Profilurile ──────────────────────────────────────────────────────────

test('1. Profilurile: din browser, fiecare își citește doar propriul rând', async () => {
  const zona = '1. Citirea profilurilor din browser'
  for (const person of [admin, SA, JA, client]) {
    const direct = createClient(CONFIG.supabaseUrl, CONFIG.anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
    await direct.auth.signInWithPassword({ email: person.email, password: person.password })
    const { data, error } = await direct.from('profiles').select('id, email, telefon, cif')
    const ids = (data ?? []).map(row => row.id)
    punct(zona, person.who, 'citește toate profilurile cu clientul Supabase din browser', '1 rând: propriul profil',
      error ? `eroare: ${error.message}` : `${ids.length} ${ids.length === 1 ? 'rând' : 'rânduri'}${ids.length === 1 && ids[0] === person.id ? ': propriul profil' : ''}`,
      !error && ids.length === 1 && ids[0] === person.id, 'Bază de date')
  }
  const direct = createClient(CONFIG.supabaseUrl, CONFIG.anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  await direct.auth.signInWithPassword({ email: client.email, password: client.password })
  const { data } = await direct.from('profiles').select('email, telefon, cif').eq('id', admin.id)
  punct(zona, 'client', 'cere explicit profilul adminului (email, telefon, CIF)', '0 rânduri', `${(data ?? []).length} rânduri`, (data ?? []).length === 0, 'Bază de date')
})

// ─── 2. Juniorul nu deschide dosare ──────────────────────────────────────────

test('2. Juniorul nu deschide dosare: fără buton, trimis înapoi, refuzat de API', async ({ browser }) => {
  const zona = '2. Juniorul nu deschide dosare'
  const { context, page, errors } = await login(browser, JA)
  try {
    await home(page)
    const shot = await dovezi.captura(page, 'junior-acasa-fara-buton')
    const buttons = await page.getByRole('link', { name: /Proiect nou/ }).count()
    punct(zona, 'junior', 'butonul „Proiect nou” pe prima pagină', 'lipsește', buttons ? 'vizibil' : 'lipsește', buttons === 0, 'Interfață', [shot])

    await page.goto('/projects/new')
    await page.waitForURL(url => url.pathname === '/', { timeout: 30_000 }).catch(() => {})
    await page.getByRole('heading', { level: 1, name: /^Salut/ }).waitFor({ timeout: 30_000 }).catch(() => {})
    const back = await dovezi.captura(page, 'junior-dosar-nou-trimis-inapoi')
    const pathname = new URL(page.url()).pathname
    const form = await page.getByRole('button', { name: 'Deschide dosarul' }).count()
    punct(zona, 'junior', 'deschide direct /projects/new', 'trimis pe prima pagină, fără formular', form ? 'formularul apare' : `pe ${pathname}`, pathname === '/' && form === 0, 'Interfață', [back])
    punct(zona, 'junior', 'paginile se încarcă fără erori JavaScript', '0 erori', `${errors.length} erori${errors.length ? `: ${errors[0]}` : ''}`, errors.length === 0, 'Interfață')
  } finally {
    await context.close()
  }

  const title = `Verificare ${STAMP} — încercare de junior`
  raspuns(zona, 'junior', 'POST /api/projects (creează un dosar)', await call(JA, 'POST', '/api/projects', { title, client_id: client.id, supervisor_ids: [SA.id] }), 403)
  const { data: leftover } = await service.from('projects').select('id').eq('title', title)
  punct(zona, 'junior', 'încercarea refuzată nu lasă un proiect în bază', '0 proiecte', `${(leftover ?? []).length} proiecte`, (leftover ?? []).length === 0, 'Bază de date')

  const projectId = await newProject(`Verificare ${STAMP} — proiect cu junior în echipă`)
  await must(admin, 'POST', `/api/projects/${projectId}/members`, { consultant_id: JA.id })
  raspuns(zona, 'junior', 'importă un șablon în proiectul în care e membru', await call(JA, 'POST', `/api/projects/${projectId}/import-template`, { template_id: TPL }), 403)
  const phases = await phaseCount(projectId)
  punct(zona, 'junior', 'importul refuzat nu lasă faze', '0 faze', `${phases} faze`, phases === 0, 'Bază de date')
})

test('2b. Juniorul fără proiecte vede un mesaj pentru el, nu pentru client', async ({ browser }) => {
  const zona = '2. Juniorul nu deschide dosare'
  const { context, page } = await login(browser, JC)
  try {
    await home(page)
    const text = 'Când un consultant senior sau un administrator te adaugă într-un proiect, apare aici.'
    const visible = await page.getByText(text).isVisible().catch(() => false)
    const shot = await dovezi.captura(page, 'junior-fara-proiecte')
    punct(zona, 'junior', 'prima pagină fără proiecte', `„${text}”`, visible ? 'mesajul apare' : 'alt mesaj', visible, 'Interfață', [shot])
  } finally {
    await context.close()
  }
})

test('2c. Adminul și seniorul văd „Proiect nou”', async ({ browser }) => {
  const zona = '2. Juniorul nu deschide dosare'
  for (const person of [admin, SA]) {
    const { context, page } = await login(browser, person)
    try {
      await home(page)
      const visible = await page.getByRole('link', { name: /Proiect nou/ }).first().isVisible().catch(() => false)
      const shot = await dovezi.captura(page, `${person.who}-acasa-cu-buton`)
      punct(zona, person.who, 'butonul „Proiect nou” pe prima pagină', 'vizibil', visible ? 'vizibil' : 'lipsește', visible, 'Interfață', [shot])
    } finally {
      await context.close()
    }
  }
})

// ─── 3. Dosar nou din șablon, ca senior ──────────────────────────────────────

test('3. Dosar nou din șablon, ca senior: colegii din afara echipei primesc activitățile într-o singură cerere', async ({ browser }) => {
  const zona = '3. Dosar nou cu consultanți pe activități'
  const title = `Verificare ${STAMP} — dosar de senior`
  const { context, page, errors } = await login(browser, SA)
  try {
    await page.goto('/projects/new')
    await page.getByText(SA.name).first().waitFor({ timeout: 30_000 })
    const proposed = await page.getByRole('checkbox', { name: new RegExp(SA.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).isChecked()
    const empty = await dovezi.captura(page, 'senior-dosar-nou-formular')
    punct(zona, 'senior', 'seniorul care deschide dosarul e propus ca supervizor', 'bifat', proposed ? 'bifat' : 'nebifat', proposed, 'Interfață', [empty])

    await page.fill('#dosar-nume', title)
    await page.selectOption('#dosar-beneficiar', client.id)
    await page.getByRole('radio', { name: /Din șablon/ }).check()
    await page.getByRole('radio', { name: exact(TPL_NAME) }).check()
    await page.getByLabel('Activitate cu implicit anulat').selectOption('')
    await page.getByLabel('Activitate pentru juniorul A').selectOption(JA.id)
    await page.getByLabel('Activitate pentru juniorul B').selectOption(JB.id)
    const filled = await dovezi.captura(page, 'senior-dosar-nou-completat', { fullPage: true })
    punct(zona, 'senior', 'completează dosarul: șablon, implicit anulat, doi juniori din afara echipei', 'formular gata', 'formular gata', true, 'Interfață', [filled])

    const calls: string[] = []
    page.on('request', request => {
      const url = new URL(request.url())
      if (url.pathname.startsWith('/api/projects')) calls.push(`${request.method()} ${url.pathname}`)
    })
    const emailsBefore = emailuriAcum()
    const started = Date.now()
    await page.getByRole('button', { name: 'Deschide dosarul' }).click()
    await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/, { timeout: 60_000 })
    const elapsed = Date.now() - started
    DOSAR = new URL(page.url()).pathname.split('/').pop()!
    created.projects.add(DOSAR)
    await page.getByRole('button', { name: /^Chat/ }).first().waitFor({ timeout: 30_000 })
    const projectShot = await dovezi.captura(page, 'senior-dosar-deschis', { fullPage: true })

    const creates = calls.filter(c => c === 'POST /api/projects').length
    const imports = calls.filter(c => c.startsWith('POST') && c.endsWith('/import-template')).length
    const patches = calls.filter(c => c.startsWith('PATCH') && c.includes('/activities/')).length
    punct(zona, 'senior', 'cererile trimise la „Deschide dosarul”', '1 creare + 1 import, 0 atribuiri separate',
      `${creates} creare + ${imports} import, ${patches} atribuiri separate`, creates === 1 && imports === 1 && patches === 0, 'Performanță', [projectShot])
    punct(zona, 'senior', 'timpul de la clic până în pagina dosarului', 'sub 10 s', `${elapsed} ms`, elapsed < 10_000, 'Performanță')

    const members = await memberIds(DOSAR)
    punct(zona, 'sistem', 'echipa dosarului', 'seniorul + juniorii A și B', [SA, JA, JB].map(p => `${p.name}: ${members.includes(p.id) ? 'da' : 'nu'}`).join(', '),
      members.length === 3 && [SA, JA, JB].every(p => members.includes(p.id)), 'Bază de date')

    const { data: phases } = await service.from('project_phases').select('id').eq('project_id', DOSAR)
    const { data: activities } = await service.from('project_activities').select('id, name, assigned_to').in('phase_id', (phases ?? []).map(p => p.id))
    const byName = Object.fromEntries((activities ?? []).map(a => [a.name, a]))
    const expected: Record<string, string | null> = {
      'Activitate cu implicit anulat': null,
      'Activitate pentru juniorul A': JA.id,
      'Activitate cu implicit păstrat': SA.id,
      'Activitate pentru juniorul B': JB.id,
    }
    const nameOf = (id: string | null) => (id === null ? 'nimeni' : [SA, JA, JB].find(p => p.id === id)?.name ?? id)
    for (const [activity, consultant] of Object.entries(expected)) {
      const actual = byName[activity]?.assigned_to ?? null
      punct(zona, 'sistem', `„${activity}” e atribuită`, nameOf(consultant), nameOf(actual), actual === consultant, 'Bază de date')
    }
    for (const person of [JA, JB]) {
      const activity = person === JA ? byName['Activitate pentru juniorul A'] : byName['Activitate pentru juniorul B']
      const { data: notified } = await service.from('notifications').select('id, title').eq('user_id', person.id).eq('entity_type', 'activity').eq('entity_id', activity?.id ?? '')
      punct(zona, person.who, `${person.name} primește notificarea de atribuire`, '1 notificare', `${(notified ?? []).length} notificări`, (notified ?? []).length === 1, 'Bază de date')
    }

    await page.getByRole('button', { name: /^Echipa proiectului/ }).click()
    await page.getByRole('dialog').getByText(JB.name).first().waitFor({ timeout: 15_000 }).catch(() => {})
    const team = await dovezi.captura(page, 'senior-echipa-dosarului')
    const panel = page.getByRole('dialog')
    const listed = await Promise.all([SA, JA, JB].map(p => panel.getByText(p.name).first().isVisible().catch(() => false)))
    punct(zona, 'senior', 'panoul echipei arată seniorul și juniorii aduși la import', '3 membri vizibili', `${listed.filter(Boolean).length} vizibili`, listed.every(Boolean), 'Interfață', [team])
    punct(zona, 'senior', 'formularul și dosarul se încarcă fără erori JavaScript', '0 erori', `${errors.length} erori${errors.length ? `: ${errors[0]}` : ''}`, errors.length === 0, 'Interfață')

    // Emailurile de atribuire: un singur lot, câte unul pentru fiecare activitate dată cuiva.
    const entries = emailuriNoi(emailsBefore)
    if (entries) {
      const batches = entries.filter(e => e.path?.startsWith('/emails/batch'))
      const singles = entries.filter(e => e.path === '/emails')
      const batch = (batches[0]?.body ?? []) as Json[]
      const recipients = batch.map(item => (Array.isArray(item.to) ? item.to[0] : item.to))
      punct(zona, 'sistem', 'emailurile de atribuire de la import', '1 lot cu 3 emailuri (senior, junior A, junior B), 0 emailuri separate',
        `${batches.length} ${batches.length === 1 ? 'lot' : 'loturi'} cu ${batch.length} emailuri (${recipients.join(', ')}), ${singles.length} separate`,
        batches.length === 1 && batch.length === 3 && [SA, JA, JB].every(p => recipients.includes(p.email)) && singles.length === 0, 'Email')
      punct(zona, 'sistem', 'lotul are cheie de idempotență', 'cheie prezentă', batches[0]?.idempotencyKey ? 'prezentă' : 'lipsește', !!batches[0]?.idempotencyKey, 'Email')
      const toJB = batch.find(item => (Array.isArray(item.to) ? item.to : [item.to]).includes(JB.email))
      if (toJB) {
        const mailPage = await context.newPage()
        const shot = await dovezi.capturaHtml(mailPage, 'email-atribuire-junior-b', String(toJB.html))
        await mailPage.close()
        punct(zona, JB.who, 'emailul primit de juniorul B', `subiect „Ți-a fost atribuită o activitate nouă — ${title}”`, `subiect „${toJB.subject}”`,
          toJB.subject === `Ți-a fost atribuită o activitate nouă — ${title}` && String(toJB.html).includes('Activitate pentru juniorul B'), 'Email', [shot])
      } else {
        punct(zona, JB.who, 'emailul primit de juniorul B', 'un email în lot', 'lipsește', false, 'Email')
      }
    } else {
      test.info().annotations.push({ type: 'emailuri', description: 'nu rulează serverul Resend de test (E2E_RESEND_LOG lipsește)' })
    }
  } finally {
    await context.close()
  }

  const { context: jbContext, page: jbPage } = await login(browser, JB)
  try {
    await jbPage.goto('/notificari')
    await jbPage.getByRole('heading', { level: 1, name: 'Notificări' }).waitFor({ timeout: 30_000 })
    const shown = await seen(jbPage.getByText('Activitate pentru juniorul B'))
    const shot = await dovezi.captura(jbPage, 'junior-b-notificari')
    punct(zona, JB.who, 'pagina „Notificări” a juniorului B arată activitatea primită', '„Activitate pentru juniorul B”', shown ? 'apare' : 'lipsește', shown, 'Interfață', [shot])
    await openProject(jbPage, DOSAR)
    const opened = await dovezi.captura(jbPage, 'junior-b-deschide-dosarul')
    punct(zona, JB.who, 'juniorul B, adus la import, deschide dosarul', 'dosarul se deschide', 'dosarul se deschide', true, 'Interfață', [opened])
  } finally {
    await jbContext.close()
  }
})

// ─── 4. Importul refuză fără urme ────────────────────────────────────────────

test('4. Importul unui șablon: refuzurile nu lasă urme; reușita aduce colegul în echipă', async ({ browser }) => {
  const zona = '4. Importul unui șablon'
  const projectId = await newProject(`Verificare ${STAMP} — import`)
  await must(admin, 'POST', `/api/projects/${projectId}/members`, { consultant_id: JA.id })
  const { data: templateActivities } = await service.from('template_activities')
    .select('id, name, scope:template_phases!inner(template_id)')
    .eq('scope.template_id', TPL)
  const forB = (templateActivities ?? []).find(a => a.name === 'Activitate pentru juniorul B')!.id

  raspuns(zona, 'junior', 'juniorul din echipă importă și aduce un coleg', await call(JA, 'POST', `/api/projects/${projectId}/import-template`, { template_id: TPL, assignments: { [forB]: JB.id } }), 403)
  raspuns(zona, 'junior', 'un consultant din afara echipei importă și se adaugă singur', await call(JB, 'POST', `/api/projects/${projectId}/import-template`, { template_id: TPL, assignments: { [forB]: JB.id } }), 403)
  raspuns(zona, 'client', 'clientul proiectului importă un șablon', await call(client, 'POST', `/api/projects/${projectId}/import-template`, { template_id: TPL }), 403)
  raspuns(zona, 'admin', 'o activitate dată unui client', await call(admin, 'POST', `/api/projects/${projectId}/import-template`, { template_id: TPL, assignments: { [forB]: client.id } }), 409)
  raspuns(zona, 'admin', 'atribuiri într-o formă greșită (listă în loc de obiect)', await call(admin, 'POST', `/api/projects/${projectId}/import-template`, { template_id: TPL, assignments: [JB.id] }), 400)
  await service.from('profiles').update({ is_active: false }).eq('id', JC.id)
  try {
    raspuns(zona, 'admin', 'o activitate dată unui consultant dezactivat', await call(admin, 'POST', `/api/projects/${projectId}/import-template`, { template_id: TPL, assignments: { [forB]: JC.id } }), 409)
  } finally {
    await service.from('profiles').update({ is_active: true }).eq('id', JC.id)
  }

  const phases = await phaseCount(projectId)
  const members = (await memberIds(projectId)).sort()
  punct(zona, 'sistem', 'după toate refuzurile', '0 faze, echipa neschimbată (senior + junior A)', `${phases} faze, ${members.length} membri`,
    phases === 0 && JSON.stringify(members) === JSON.stringify([SA.id, JA.id].sort()), 'Bază de date')

  const { context, page } = await login(browser, admin)
  try {
    await openProject(page, projectId)
    const shot = await dovezi.captura(page, 'admin-proiect-dupa-refuzuri', { fullPage: true })
    punct(zona, 'admin', 'pagina proiectului după refuzuri', 'fără faze importate', `${phases} faze`, phases === 0, 'Interfață', [shot])

    raspuns(zona, 'admin', 'importul corect, cu juniorul B pe o activitate', await call(admin, 'POST', `/api/projects/${projectId}/import-template`, { template_id: TPL, assignments: { [forB]: JB.id } }), 200)
    const after = await memberIds(projectId)
    punct(zona, 'sistem', 'juniorul B intră în echipă la importul corect', 'membru', after.includes(JB.id) ? 'membru' : 'lipsește', after.includes(JB.id), 'Bază de date')
    await openProject(page, projectId)
    const imported = await dovezi.captura(page, 'admin-proiect-dupa-import', { fullPage: true })
    punct(zona, 'admin', 'pagina proiectului după importul corect', 'fazele șablonului', `${await phaseCount(projectId)} faze`, (await phaseCount(projectId)) === 1, 'Interfață', [imported])
  } finally {
    await context.close()
  }
})

// ─── 5. Crearea proiectului ──────────────────────────────────────────────────

test('5. Crearea proiectului: validările rămân aceleași cu verificările în paralel', async () => {
  const zona = '5. Crearea proiectului'
  const base = { title: `Verificare ${STAMP} — validare`, client_id: client.id }
  raspuns(zona, 'admin', 'fără supervizori', await call(admin, 'POST', '/api/projects', base), 400)
  raspuns(zona, 'admin', 'cu lista de supervizori goală', await call(admin, 'POST', '/api/projects', { ...base, supervisor_ids: [] }), 400)
  raspuns(zona, 'admin', 'cu un junior ca supervizor', await call(admin, 'POST', '/api/projects', { ...base, supervisor_ids: [JA.id] }), 400)
  raspuns(zona, 'admin', 'cu un client inexistent', await call(admin, 'POST', '/api/projects', { ...base, client_id: '00000000-0000-4000-8000-000000000000', supervisor_ids: [SA.id] }), 404)
  raspuns(zona, 'admin', 'cu un consultant în locul clientului', await call(admin, 'POST', '/api/projects', { ...base, client_id: SA.id, supervisor_ids: [SA.id] }), 400)
  raspuns(zona, 'admin', 'cu un titlu de 121 de caractere', await call(admin, 'POST', '/api/projects', { ...base, title: 'x'.repeat(121), supervisor_ids: [SA.id] }), 400)
  raspuns(zona, 'client', 'clientul deschide un dosar', await call(client, 'POST', '/api/projects', { ...base, supervisor_ids: [SA.id] }), 403)
  const { data: leftover } = await service.from('projects').select('id').eq('title', base.title)
  punct(zona, 'sistem', 'încercările refuzate nu lasă proiecte', '0 proiecte', `${(leftover ?? []).length} proiecte`, (leftover ?? []).length === 0, 'Bază de date')

  for (const person of [admin, SA]) {
    const res = await call(person, 'POST', '/api/projects', { ...base, title: `Verificare ${STAMP} — creat de ${person.who}`, supervisor_ids: [SA.id] })
    if (res.json?.project?.id) created.projects.add(res.json.project.id)
    raspuns(zona, person.who, 'deschide un dosar corect', res, 201)
  }
})

// ─── 6. Eticheta „Modificări neaplicate” ─────────────────────────────────────

test('6. Eticheta „Modificări neaplicate”: doar pe șabloanele publicate', async ({ browser }) => {
  const zona = '6. Eticheta „Modificări neaplicate”'
  await service.from('project_templates').update({ unpropagated_changes_at: null }).in('id', [TPL, DRAFT])

  const { context, page } = await login(browser, SA)
  try {
    for (const [templateId, name, published] of [[DRAFT, DRAFT_NAME, false], [TPL, TPL_NAME, true]] as const) {
      await page.goto('/admin/templates')
      await page.getByRole('button', { name: `Editează șablonul ${name}`, exact: true }).click()
      await addEditorPhase(page, `Fază adăugată de senior ${STAMP}`)
      const saved = page.waitForResponse(res => res.url().endsWith(`/api/admin/templates/${templateId}/tree`) && res.request().method() === 'PUT')
      await page.getByRole('button', { name: 'Salvează modificările' }).click()
      const ok = (await saved).ok()
      const shot = await dovezi.captura(page, `senior-salveaza-${published ? 'publicat' : 'ciorna'}`)
      const value = await flag(templateId)
      punct(zona, 'senior', `salvează din editor ${published ? 'un șablon publicat' : 'o ciornă'}`,
        published ? 'salvat, eticheta aprinsă' : 'salvat, fără etichetă',
        `${ok ? 'salvat' : 'nesalvat'}, ${value ? 'eticheta aprinsă' : 'fără etichetă'}`,
        ok && (published ? !!value : !value), 'Interfață', [shot])
    }
  } finally {
    await context.close()
  }

  const { context: adminContext, page: adminPage } = await login(browser, admin)
  try {
    await adminPage.goto('/admin/templates')
    await adminPage.getByText(TPL_NAME, { exact: true }).first().waitFor({ timeout: 30_000 })
    const rowOf = (name: string) => adminPage.getByRole('row').filter({ has: adminPage.getByText(name, { exact: true }) })
    const onPublished = await rowOf(TPL_NAME).getByText('Modificări neaplicate în proiecte').isVisible().catch(() => false)
    const onDraft = await rowOf(DRAFT_NAME).getByText('Modificări neaplicate în proiecte').count()
    const shot = await dovezi.captura(adminPage, 'admin-lista-sabloane-eticheta', { fullPage: true })
    punct(zona, 'admin', 'eticheta pe șablonul publicat modificat de senior', 'vizibilă', onPublished ? 'vizibilă' : 'lipsește', onPublished, 'Interfață', [shot])
    punct(zona, 'admin', 'eticheta pe ciorna modificată de senior', 'lipsește', onDraft ? 'vizibilă' : 'lipsește', onDraft === 0, 'Interfață', [shot])
  } finally {
    await adminContext.close()
  }

  // Și pe rutele per element (fază), nu doar pe salvarea întregului arbore.
  await service.from('project_templates').update({ unpropagated_changes_at: null }).in('id', [TPL, DRAFT])
  for (const [templateId, published] of [[DRAFT, false], [TPL, true]] as const) {
    const res = await call(SA, 'POST', '/api/admin/templates/phases', { template_id: templateId, name: `Fază prin API ${STAMP}`, project_status_id: statusId })
    const value = await flag(templateId)
    punct(zona, 'senior', `adaugă o fază prin API într-${published ? 'un șablon publicat' : 'o ciornă'}`,
      published ? 'HTTP 201, eticheta aprinsă' : 'HTTP 201, fără etichetă',
      `HTTP ${res.status}, ${value ? 'eticheta aprinsă' : 'fără etichetă'}`,
      res.status === 201 && (published ? !!value : !value), 'API')
  }
})

// ─── 7. Atribuirea din proiect ───────────────────────────────────────────────

test('7. Atribuirea din pagina proiectului trimite email și notificare', async ({ browser }) => {
  const zona = '7. Atribuirea din proiect'
  expect(DOSAR, 'dosarul din punctul 3').not.toBe('')
  const { data: phases } = await service.from('project_phases').select('id').eq('project_id', DOSAR)
  const { data: activity } = await service.from('project_activities').select('id, name, assigned_to, phase_id')
    .in('phase_id', (phases ?? []).map(p => p.id)).eq('name', 'Activitate cu implicit anulat').single()

  const { context, page, errors } = await login(browser, SA)
  try {
    // Activitățile (și selectul responsabilului) se văd în faza deschisă, nu în panoul proiectului.
    await openProject(page, DOSAR, `?phase=${activity!.phase_id}`)
    await page.getByRole('button', { name: `Extinde activitatea ${activity!.name}` }).waitFor({ timeout: 20_000 })
    const row = page.locator('div').filter({ has: page.getByRole('button', { name: `Extinde activitatea ${activity!.name}` }) }).last()
    const select = row.getByLabel('Atribuie consultant')
    const emailsBefore = emailuriAcum()
    const patched = page.waitForResponse(res => res.url().includes(`/activities/${activity!.id}`) && res.request().method() === 'PATCH')
    await select.selectOption(JA.id)
    const response = await patched
    await page.waitForTimeout(500)
    const shot = await dovezi.captura(page, 'senior-atribuie-din-proiect', { fullPage: true })
    punct(zona, 'senior', `atribuie „${activity!.name}” juniorului A din antetul activității`, 'HTTP 200', `HTTP ${response.status()}`, response.ok(), 'Interfață', [shot])

    const { data: after } = await service.from('project_activities').select('assigned_to').eq('id', activity!.id).single()
    punct(zona, 'sistem', 'activitatea e atribuită în bază', JA.name, after?.assigned_to === JA.id ? JA.name : String(after?.assigned_to), after?.assigned_to === JA.id, 'Bază de date')
    const { data: notified } = await service.from('notifications').select('id').eq('user_id', JA.id).eq('entity_type', 'activity').eq('entity_id', activity!.id)
    punct(zona, JA.who, 'juniorul A primește notificarea', '1 notificare', `${(notified ?? []).length} notificări`, (notified ?? []).length === 1, 'Bază de date')
    punct(zona, 'senior', 'pagina proiectului fără erori JavaScript', '0 erori', `${errors.length} erori${errors.length ? `: ${errors[0]}` : ''}`, errors.length === 0, 'Interfață')

    const entries = emailuriNoi(emailsBefore)
    if (entries) {
      const singles = entries.filter(e => e.path === '/emails')
      const email = emailCatre(singles, JA.email)
      if (email) {
        const mailPage = await context.newPage()
        const mailShot = await dovezi.capturaHtml(mailPage, 'email-atribuire-din-proiect', String(email.html))
        await mailPage.close()
        punct(zona, JA.who, 'emailul de atribuire (trimis individual, ca înainte)', '1 email către juniorul A', `${singles.length} email(uri), subiect „${email.subject}”`,
          singles.length === 1 && String(email.html).includes(activity!.name), 'Email', [mailShot])
      } else {
        punct(zona, JA.who, 'emailul de atribuire (trimis individual, ca înainte)', '1 email către juniorul A', `${singles.length} emailuri, niciunul către juniorul A`, false, 'Email')
      }
    }
  } finally {
    await context.close()
  }
})

// ─── Rezultatul ──────────────────────────────────────────────────────────────

test('Toate punctele de mai sus', async () => {
  const abateri = dovezi.abateri()
  console.log(`Puncte: ${dovezi.items.length}, respectate: ${dovezi.items.length - abateri.length}, abateri: ${abateri.length}`)
  expect(abateri.map(a => `✗ [${a.zona}] ${a.cine} · ${a.punct}: așteptat ${a.asteptat}, obținut ${a.obtinut}`).join('\n'), 'abateri').toBe('')
})
