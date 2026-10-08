import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { test, expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { e2eEnv, requireE2EConfig, serviceClient, setLocalFixturePassword } from './helpers/project-state'
import { ROW, ROWS } from './helpers/matricea-drepturilor'

/**
 * Matricea „Cine ce poate face: admin, consultant senior, consultant junior”
 * (docs/drepturi-admin-senior-junior.pdf), verificată rând cu rând în browser:
 * ce vede și ce poate face fiecare rol, cu clicuri, pe serverul real.
 *
 * `drepturi.spec.ts` verifică aceleași rânduri prin API și în bază; aici se
 * verifică stratul pe care îl vede omul. O acțiune făcută din interfață se
 * confirmă în bază, iar una refuzată se confirmă prin lipsa controlului.
 * Unde PDF-ul dă un drept pentru care interfața n-are niciun control (pentru
 * niciun rol), raportul notează o observație în loc de o abatere.
 *
 * Folosește conturile fixe ale suitei de drepturi. Fiecare verificare intră în
 * `playwright-report/drepturi-interfata/raport.json` și `raport.md`, cu o
 * captură pentru fiecare abatere. Ultimul test pică dacă există abateri.
 */

const ENV = e2eEnv()
const CONFIG = requireE2EConfig(ENV)
const ADMIN_LOGIN = {
  email: ENV.E2E_ADMIN_EMAIL || CONFIG.staffEmail,
  password: ENV.E2E_ADMIN_PASSWORD || CONFIG.staffPassword,
}
const STAMP = Date.now().toString(36)
const PASSWORD = `Interfata-${STAMP}-2026!`
const REPORT_DIR = path.join('playwright-report', 'drepturi-interfata')
/** `E2E_CAPTURI=toate`: o captură la fiecare verificare din interfață, nu doar la abateri. */
const ALL_SCREENSHOTS = process.env.E2E_CAPTURI === 'toate'

// Serial: scenariile se sprijină pe starea lăsată de cele dinainte. Nicio
// verificare nu aruncă; un selector care nu se găsește devine o abatere și
// rularea merge mai departe, altfel un eșec ar sări peste restul matricei.
test.describe.configure({ mode: 'serial' })
test.setTimeout(240_000)

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Who = 'admin' | 'senior' | 'junior' | 'client'
type Person = { id: string; email: string; name: string; token: string; password: string; who: Who }
type Layer = 'Interfață' | 'Bază de date' | 'Observație'
type Check = {
  row: string
  who: Who | 'sistem'
  label: string
  expected: string
  actual: string
  ok: boolean
  layer: Layer
  screenshot?: string
}
type Outcome = { ok: boolean; actual: string }

const checks: Check[] = []

// ─── Stare creată de suită ───────────────────────────────────────────────────

const service = serviceClient() as SupabaseClient
const fixedAccounts = new Set<string>()
const created = {
  users: new Set<string>(),
  projects: new Set<string>(),
  templates: new Set<string>(),
  statuses: new Set<string>(),
}
let admin: Person
let client: Person
let SA: Person // senior, supervizorul proiectului propriu
let SB: Person // al doilea senior, membru în ambele proiecte
let JA: Person // junior, membru în proiectul propriu
let JB: Person // junior, adăugat și scos pe parcurs
let clientId = ''
let statusId = ''
let OWN = '' // SA, SB și JA sunt membri
let OTHER = '' // doar SB e membru
const OWN_TITLE = `Interfață ${STAMP} — proiect propriu`
const OTHER_TITLE = `Interfață ${STAMP} — proiect străin`
let TPL = '' // șablon publicat, folosit de un proiect
const TPL_NAME = `Interfață ${STAMP} — șablon publicat`
let ADMIN_DRAFT = ''
const ADMIN_DRAFT_NAME = `Interfață ${STAMP} — ciorna adminului`

// ─── Verificări ──────────────────────────────────────────────────────────────

/**
 * O verificare din matrice. Nu aruncă: eroarea devine abaterea din raport,
 * cu o captură a paginii dacă s-a dat una.
 */
async function check(
  row: string,
  who: Who | 'sistem',
  label: string,
  expected: string,
  run: () => Promise<Outcome>,
  options: { page?: Page; layer?: Layer } = {},
) {
  let outcome: Outcome
  try {
    outcome = await run()
  } catch (error) {
    outcome = { ok: false, actual: `eroare: ${firstLine(error)}` }
  }
  let screenshot: string | undefined
  if (!outcome.ok && options.page && !options.page.isClosed()) {
    screenshot = `abatere-${checks.length + 1}.png`
    await options.page.screenshot({ path: path.join(REPORT_DIR, screenshot) }).catch(() => { screenshot = undefined })
  } else if (ALL_SCREENSHOTS && options.page && !options.page.isClosed()) {
    // Pentru raportul complet: o captură la fiecare verificare, nu doar la abateri.
    screenshot = `verificare-${String(checks.length + 1).padStart(3, '0')}.jpg`
    await options.page.screenshot({ path: path.join(REPORT_DIR, screenshot), type: 'jpeg', quality: 72 }).catch(() => { screenshot = undefined })
  }
  checks.push({ row, who, label, expected, actual: outcome.actual, ok: outcome.ok, layer: options.layer ?? 'Interfață', screenshot })
  return outcome.ok
}

/** Controlul trebuie să apară (sau să lipsească) pentru rolul dat. */
function shows(row: string, who: Who, label: string, locator: Locator, expected: boolean, page: Page) {
  return check(row, who, label, expected ? 'vizibil' : 'lipsește', async () => {
    const seen = expected ? await visible(locator) : await locator.count() > 0
    return { ok: seen === expected, actual: seen ? 'vizibil' : 'lipsește' }
  }, { page })
}

/** Starea din bază după o acțiune făcută din interfață. */
function stored<T>(row: string, who: Who | 'sistem', label: string, expected: string, read: () => Promise<T>, ok: (value: T) => boolean, describe: (value: T) => string = v => JSON.stringify(v)) {
  return check(row, who, label, expected, async () => {
    const value = await until(read, ok)
    return { ok: ok(value), actual: describe(value) }
  }, { layer: 'Bază de date' })
}

/** Un drept din PDF pentru care interfața n-are control, la niciun rol. */
function observe(row: string, label: string, actual: string) {
  checks.push({ row, who: 'sistem', label, expected: '—', actual, ok: true, layer: 'Observație' })
}

function firstLine(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.split('\n').find(line => line.trim())?.trim().slice(0, 220) ?? 'necunoscută'
}

async function visible(locator: Locator, timeout = 6_000) {
  try {
    await locator.first().waitFor({ state: 'visible', timeout })
    return true
  } catch {
    return false
  }
}

async function until<T>(read: () => Promise<T>, ok: (value: T) => boolean, timeout = 15_000) {
  const deadline = Date.now() + timeout
  let value = await read()
  while (!ok(value) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 300))
    value = await read()
  }
  return value
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ─── API și conturi ──────────────────────────────────────────────────────────

async function signIn(email: string, password: string) {
  const anon = createClient(CONFIG.supabaseUrl, CONFIG.anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await anon.auth.signInWithPassword({ email, password })
  if (error || !data.session) throw new Error(`Autentificare ${email}: ${error?.message}`)
  return data.session.access_token
}

async function call(who: Person, method: string, url: string, body?: unknown) {
  const res = await fetch(`${CONFIG.baseUrl}${url}`, {
    method,
    headers: { Authorization: `Bearer ${who.token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Json }
}

/** Pregătirea unui scenariu: cererea trebuie să reușească. */
async function must(who: Person, method: string, url: string, body?: unknown) {
  const res = await call(who, method, url, body)
  expect(res.status, `${method} ${url}: ${JSON.stringify(res.json).slice(0, 300)}`).toBeLessThan(300)
  return res.json
}

/**
 * Conturile fixe ale suitei de drepturi: jurnalul de audit e append-only și
 * ține minte cine a făcut ce, deci un cont folosit o dată nu se mai șterge.
 */
async function fixedConsultant(tag: 'sa' | 'sb' | 'ja' | 'jb', level: 'junior' | 'senior'): Promise<Person> {
  const email = `drepturi.${tag}@test.local`
  const name = `Test drepturi — ${{ sa: 'Senior A', sb: 'Senior B', ja: 'Junior A', jb: 'Junior B' }[tag]}`
  let id: string | undefined
  const { data } = await service.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
  if (data?.user) {
    id = data.user.id
  } else {
    const { data: existing } = await service.from('profiles').select('id').eq('email', email).maybeSingle()
    if (!existing) throw new Error(`Nu am putut crea ${email}`)
    id = existing.id as string
    setLocalFixturePassword(id, PASSWORD)
  }
  fixedAccounts.add(id)
  const { error } = await service.from('profiles').upsert({ id, email, role: 'consultant', consultant_level: level, full_name: name, is_active: true })
  if (error) throw new Error(`Profil ${email}: ${error.message}`)
  return { id, email, name, password: PASSWORD, token: await signIn(email, PASSWORD), who: level }
}

async function createProject(title: string, supervisors: string[]) {
  const json = await must(admin, 'POST', '/api/projects', { title, client_id: clientId, supervisor_ids: supervisors })
  created.projects.add(json.project.id)
  return json.project.id as string
}

async function addPhase(projectId: string, name: string) {
  return (await must(admin, 'POST', `/api/projects/${projectId}/phases`, { name })).phase.id as string
}

async function addActivity(projectId: string, phaseId: string, name: string) {
  return (await must(admin, 'POST', `/api/projects/${projectId}/phases/${phaseId}/activities`, { name })).activity.id as string
}

async function addRequest(projectId: string, activityId: string, name: string) {
  return (await must(admin, 'POST', `/api/projects/${projectId}/document-requests`, { name, activity_id: activityId })).id as string
}

/** O cerere cu un fișier trimis de client, gata de verificat. */
async function requestInReview(projectId: string, activityId: string, name: string) {
  const id = await addRequest(projectId, activityId, name)
  const { error: fileError } = await service.from('files').insert({
    id: randomUUID(), requirement_id: id, storage_path: `test-fixtures/drepturi-interfata/${id}.pdf`, original_name: 'document.pdf',
    file_size: 10, mime_type: 'application/pdf', version_number: 1, uploaded_by: clientId,
  })
  if (fileError) throw new Error(`Fișier fixture: ${fileError.message}`)
  const { error } = await service.from('document_requirements').update({ status: 'review' }).eq('id', id)
  if (error) throw new Error(`Status review: ${error.message}`)
  return id
}

async function memberRow(projectId: string, consultantId: string) {
  const { data } = await service.from('project_members').select('id').eq('project_id', projectId).eq('consultant_id', consultantId).maybeSingle()
  return data?.id as string | undefined
}

async function ensureMember(projectId: string, person: Person) {
  if (!(await memberRow(projectId, person.id))) await must(admin, 'POST', `/api/projects/${projectId}/members`, { consultant_id: person.id })
}

async function postMessage(by: Person, projectId: string, body: string) {
  return (await must(by, 'POST', `/api/projects/${projectId}/chat/messages`, { body })).item.id as string
}

function templateTree(name: string, phaseNames: string[]) {
  return {
    name,
    slug: `interfata-${STAMP}-${Math.random().toString(36).slice(2, 7)}`,
    description: 'Șablon creat de suita de interfață',
    phases: phaseNames.map((phaseName, p) => ({
      id: `p${p}`, name: phaseName, project_status_id: statusId,
      activities: [{ id: `p${p}a0`, name: `${phaseName} — activitate`, document_requirements: [] }],
    })),
  }
}

async function createTemplate(by: Person, name: string) {
  const json = await must(by, 'POST', '/api/admin/templates', templateTree(name, ['Pregătire']))
  created.templates.add(json.template.id)
  return json.template.id as string
}

// ─── Browser ─────────────────────────────────────────────────────────────────

/**
 * Deschide o sesiune nouă pentru persoană și rulează scenariul. O eroare din
 * scenariu (o pagină care nu se încarcă) devine o abatere pe rândul dat, nu
 * oprește suita. Contextul e nou de fiecare dată: tokenurile Supabase se
 * rotesc, deci o sesiune nu se reia între roluri.
 */
async function session(browser: Browser, person: Person, row: string, scenario: (page: Page) => Promise<void>) {
  let context: BrowserContext | undefined
  let page: Page | undefined
  try {
    context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    page = await context.newPage()
    await page.goto('/login')
    await page.fill('input[type=email]', person.email)
    await page.fill('input[type=password]', person.password)
    await page.click('button[type=submit]')
    await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 30_000 })
    await scenario(page)
  } catch (error) {
    await check(row, person.who, 'scenariul din interfață a mers până la capăt', 'da', async () => ({ ok: false, actual: firstLine(error) }), { page })
  } finally {
    await context?.close()
  }
}

async function openProject(page: Page, projectId: string, query = '') {
  await page.goto(`/projects/${projectId}${query}`)
  await page.getByRole('button', { name: /^Chat/ }).first().waitFor({ timeout: 30_000 })
}

/**
 * Conținutul paginii proiectului, fără bara laterală de faze: pagina își are
 * `<main>`-ul ei în cel al aplicației, iar bara laterală repetă aceleași
 * butoane („Adaugă activitate”, meniurile fazelor).
 */
function projectMain(page: Page) {
  return page.locator('main main')
}

/** Editorul de șabloane: completează numele fazei tocmai adăugate, oricâte ar fi înainte. */
async function addEditorPhase(page: Page, name: string) {
  const inputs = page.getByLabel(/^Nume pentru faza \d+$/)
  await inputs.first().waitFor({ timeout: 30_000 }).catch(() => {})
  const before = await inputs.count()
  await page.getByRole('button', { name: 'Adaugă fază nouă' }).click()
  await page.getByLabel(`Nume pentru faza ${before + 1}`, { exact: true }).fill(name)
}

function deepLink(phaseId: string, activityId?: string, documentId?: string) {
  const params = new URLSearchParams({ phase: phaseId })
  if (activityId) params.set('activity', activityId)
  if (documentId) params.set('document', documentId)
  return `?${params.toString()}${activityId ? `#activity-${activityId}` : ''}`
}

/** Meniul „Opțiuni mesaj” al unei bule din chat: există, și ce oferă. */
async function messageMenu(page: Page, text: string) {
  const bubble = page.locator('div.group\\/message').filter({ hasText: text }).first()
  await bubble.waitFor({ timeout: 30_000 })
  await bubble.hover()
  const options = bubble.getByRole('button', { name: 'Opțiuni mesaj' })
  if (await options.count() === 0) return { bubble, menu: false, edit: false, remove: false }
  await options.click({ force: true })
  await bubble.getByRole('button', { name: 'Șterge', exact: true }).waitFor({ timeout: 5_000 }).catch(() => {})
  return {
    bubble,
    menu: true,
    edit: await bubble.getByRole('button', { name: 'Editează', exact: true }).count() > 0,
    remove: await bubble.getByRole('button', { name: 'Șterge', exact: true }).count() > 0,
  }
}

async function openChat(page: Page, projectId: string) {
  await openProject(page, projectId)
  await page.getByRole('button', { name: /^Chat/ }).first().click()
}

async function openTeam(page: Page, projectId: string) {
  await openProject(page, projectId)
  await page.getByRole('button', { name: /^Echipa proiectului/ }).click()
  const panel = page.getByRole('dialog', { name: 'Echipa proiectului' })
  await panel.getByRole('listitem').first().waitFor({ timeout: 30_000 })
  return panel
}

/** Fereastra de confirmare cu cuvânt de scris (ștergeri, publicare). */
async function confirmWithWord(page: Page, dialogName: string | RegExp, word: string, button: string) {
  const dialog = page.getByRole('dialog', { name: dialogName })
  await dialog.getByPlaceholder(word).fill(word)
  await dialog.getByRole('button', { name: button, exact: true }).click()
  return dialog
}

async function navLinks(page: Page) {
  await page.goto('/')
  const nav = page.locator('header, nav').first()
  await nav.waitFor({ timeout: 30_000 })
  await page.waitForTimeout(1_000)
  const labels = ['Șabloane', 'Tablou de bord', 'Utilizatori', 'Audit', 'Statusuri']
  const found: string[] = []
  for (const label of labels) {
    if (await nav.getByRole('link', { name: label, exact: true }).count() > 0) found.push(label)
  }
  return found
}

/** Pagina se deschide (rămâne pe URL) sau trimite rolul înapoi. */
async function staysOn(page: Page, url: string) {
  await page.goto(url)
  await page.waitForTimeout(2_500)
  return new URL(page.url()).pathname === url
}

// ─── Pregătire și curățenie ──────────────────────────────────────────────────

test.beforeAll(async () => {
  // Suita creează și șterge conturi, proiecte și șabloane prin cheia de
  // service: pe altă bază decât cea locală nu are ce căuta.
  for (const url of [CONFIG.supabaseUrl, CONFIG.baseUrl]) {
    const host = new URL(url).hostname
    if (host !== 'localhost' && host !== '127.0.0.1') throw new Error(`Suita de interfață rulează doar local, nu pe ${host}`)
  }
  expect(service, 'Clientul service E2E lipsește').toBeTruthy()
  fs.rmSync(REPORT_DIR, { recursive: true, force: true })
  fs.mkdirSync(REPORT_DIR, { recursive: true })

  const { data: adminProfile } = await service.from('profiles').select('id, email, full_name, role').eq('email', ADMIN_LOGIN.email).single()
  if (adminProfile?.role !== 'admin') throw new Error('E2E_ADMIN_EMAIL trebuie să fie un cont de admin')
  admin = {
    id: adminProfile.id, email: adminProfile.email, name: adminProfile.full_name || adminProfile.email,
    password: ADMIN_LOGIN.password, token: await signIn(ADMIN_LOGIN.email, ADMIN_LOGIN.password), who: 'admin',
  }
  const { data: clientProfile } = await service.from('profiles').select('id, email, full_name').eq('email', CONFIG.clientEmail).single()
  const { data: status } = await service.from('project_statuses').select('id').order('id').limit(1).single()
  if (!clientProfile || !status) throw new Error('Baza E2E nu are clientul sau statusurile așteptate')
  clientId = clientProfile.id
  statusId = status.id
  client = {
    id: clientProfile.id, email: clientProfile.email, name: clientProfile.full_name || clientProfile.email,
    password: CONFIG.clientPassword, token: await signIn(CONFIG.clientEmail, CONFIG.clientPassword), who: 'client',
  }

  SA = await fixedConsultant('sa', 'senior')
  SB = await fixedConsultant('sb', 'senior')
  JA = await fixedConsultant('ja', 'junior')
  JB = await fixedConsultant('jb', 'junior')

  OWN = await createProject(OWN_TITLE, [SA.id])
  await ensureMember(OWN, SB)
  await ensureMember(OWN, JA)
  OTHER = await createProject(OTHER_TITLE, [SB.id])

  TPL = await createTemplate(admin, TPL_NAME)
  await must(admin, 'PATCH', `/api/admin/templates/${TPL}`, { status: 'published' })
  ADMIN_DRAFT = await createTemplate(admin, ADMIN_DRAFT_NAME)
})

test.afterAll(async () => {
  fs.mkdirSync(REPORT_DIR, { recursive: true })
  writeReport()
  if (!service) return

  // Copiile făcute din interfață poartă numele originalului și sufixul.
  const { data: copies } = await service.from('project_templates').select('id').like('name', `Interfață ${STAMP}%`)
  for (const row of copies ?? []) created.templates.add(row.id)
  const { data: projects } = await service.from('projects').select('id').like('title', `Interfață ${STAMP}%`)
  for (const row of projects ?? []) created.projects.add(row.id)

  for (const id of created.projects) await service.from('projects').delete().eq('id', id)
  for (const id of created.templates) await service.from('project_templates').delete().eq('id', id)
  for (const id of created.statuses) await service.from('project_statuses').delete().eq('id', id)
  await service.from('files').delete().like('storage_path', 'test-fixtures/drepturi-interfata/%')
  for (const id of created.users) await service.auth.admin.deleteUser(id)
  // Conturile fixe rămân pentru rularea următoare, dar fără drepturi de senior.
  for (const id of fixedAccounts) await service.from('profiles').update({ consultant_level: 'junior', is_active: false }).eq('id', id)
})

function writeReport() {
  fs.writeFileSync(path.join(REPORT_DIR, 'raport.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    baseUrl: CONFIG.baseUrl,
    stamp: STAMP,
    rows: ROWS,
    checks,
  }, null, 2))

  const lines = [
    '# Matricea drepturilor, verificată în interfață',
    '',
    `Rulare ${STAMP}, ${new Date().toLocaleString('ro-RO')}, pe ${CONFIG.baseUrl}.`,
    '',
    `Verificări: ${checks.filter(c => c.layer !== 'Observație').length}, abateri: ${checks.filter(c => !c.ok).length}, observații: ${checks.filter(c => c.layer === 'Observație').length}.`,
    '',
  ]
  for (const row of ROWS) {
    const own = checks.filter(c => c.row === row.id)
    if (own.length === 0) continue
    lines.push(`## ${row.title}`, '', `PDF: admin ${row.admin} · senior ${row.senior} · junior ${row.junior}`, '')
    for (const c of own) {
      const mark = c.layer === 'Observație' ? 'ℹ' : c.ok ? '✓' : '✗'
      const shot = c.screenshot ? ` (captură: ${c.screenshot})` : ''
      lines.push(`- ${mark} ${c.who} · ${c.label} — așteptat ${c.expected}, obținut ${c.actual} [${c.layer}]${shot}`)
    }
    lines.push('')
  }
  fs.writeFileSync(path.join(REPORT_DIR, 'raport.md'), lines.join('\n'))
}

// ═══ PROIECTE ════════════════════════════════════════════════════════════════

test('Vede proiectul — adminul toate; seniorul și juniorul doar proiectele lor, și pe prima pagină', async ({ browser }) => {
  for (const person of [admin, SA, JA]) {
    await session(browser, person, 'p-vede', async page => {
      const seesAll = person === admin
      await page.goto('/')
      await check('p-vede', person.who, 'prima pagină listează proiectul propriu', 'în listă', async () => {
        const seen = await visible(page.getByRole('heading', { name: OWN_TITLE, exact: true }), 30_000)
        return { ok: seen, actual: seen ? 'în listă' : 'lipsește' }
      }, { page })
      await check('p-vede', person.who, `prima pagină ${seesAll ? 'listează' : 'nu listează'} proiectul străin`, seesAll ? 'în listă' : 'lipsește', async () => {
        const heading = page.getByRole('heading', { name: OTHER_TITLE, exact: true })
        const seen = seesAll ? await visible(heading, 15_000) : await heading.count() > 0
        return { ok: seen === seesAll, actual: seen ? 'în listă' : 'lipsește' }
      }, { page })

      await openProject(page, OWN)
      await shows('p-vede', person.who, 'deschide proiectul propriu', page.getByRole('heading', { level: 1, name: OWN_TITLE }), true, page)

      await page.goto(`/projects/${OTHER}`)
      await check('p-vede', person.who, `deschide proiectul străin ${seesAll ? '' : 'și e trimis înapoi'}`.trim(), seesAll ? 'deschis' : 'trimis pe prima pagină', async () => {
        if (seesAll) {
          const seen = await visible(page.getByRole('heading', { level: 1, name: OTHER_TITLE }), 30_000)
          return { ok: seen, actual: seen ? 'deschis' : 'nu s-a deschis' }
        }
        await page.waitForURL(url => url.pathname === '/', { timeout: 30_000 }).catch(() => {})
        const pathname = new URL(page.url()).pathname
        const leaked = await page.getByRole('heading', { level: 1, name: OTHER_TITLE }).count() > 0
        return { ok: pathname === '/' && !leaked, actual: leaked ? 'titlul proiectului străin apare' : `pe ${pathname}` }
      }, { page })
    })
  }
})

test('Creează un proiect nou — din „Dosar nou”, admin și senior; juniorul nu are buton și e trimis înapoi', async ({ browser }) => {
  await session(browser, JA, 'p-creeaza', async page => {
    await page.goto('/')
    await page.getByRole('heading', { level: 1, name: /^Salut/ }).waitFor({ timeout: 30_000 })
    await shows('p-creeaza', JA.who, 'butonul „Proiect nou” pe prima pagină', page.getByRole('link', { name: /Proiect nou/ }), false, page)
    await page.goto('/projects/new')
    await check('p-creeaza', JA.who, 'deschide „Dosar nou” direct și e trimis înapoi', 'trimis pe prima pagină', async () => {
      await page.waitForURL(url => url.pathname === '/', { timeout: 30_000 }).catch(() => {})
      const pathname = new URL(page.url()).pathname
      const form = await page.getByRole('button', { name: 'Deschide dosarul' }).count() > 0
      return { ok: pathname === '/' && !form, actual: form ? 'formularul apare' : `pe ${pathname}` }
    }, { page })
  })

  for (const person of [admin, SA]) {
    const title = `Interfață ${STAMP} — dosar creat de ${person.who}`
    await session(browser, person, 'p-creeaza', async page => {
      await page.goto('/projects/new')
      await page.getByText(SA.name).first().waitFor({ timeout: 30_000 })
      await page.fill('#dosar-nume', title)
      await page.selectOption('#dosar-beneficiar', clientId)
      await page.getByRole('checkbox', { name: new RegExp(escapeRegex(SA.name)) }).check()
      await page.getByRole('button', { name: 'Deschide dosarul' }).click()
      await check('p-creeaza', person.who, 'creează dosarul din formular', 'pagina proiectului nou', async () => {
        await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/, { timeout: 60_000 })
        return { ok: true, actual: 'pagina proiectului nou' }
      }, { page })
    })
    const { data: project } = await service.from('projects').select('id').eq('title', title).maybeSingle()
    if (project) created.projects.add(project.id)
    const members = project ? (await service.from('project_members').select('consultant_id').eq('project_id', project.id)).data ?? [] : []
    const ids = members.map(m => m.consultant_id as string)
    if (person === admin) {
      await stored('p-creeaza', 'admin', 'supervizorul ales devine membru', 'membru', async () => ids, v => v.includes(SA.id), v => (v.includes(SA.id) ? 'membru' : 'lipsește'))
    } else {
      await stored('p-creeaza', person.who, 'cine creează devine membru', 'membru', async () => ids, v => v.includes(person.id), v => (v.includes(person.id) ? 'membru' : 'nu e membru'))
    }
  }
})

test('Adaugă și modifică faze, activități și cereri — din pagina proiectului, pentru toți în proiectul propriu', async ({ browser }) => {
  for (const person of [admin, SA, JA]) {
    const phaseName = `Fază din interfață (${person.who}) ${STAMP}`
    const renamed = `${phaseName} — redenumită`
    const activityName = `Activitate din interfață (${person.who}) ${STAMP}`
    const requestName = `Cerere din interfață (${person.who}) ${STAMP}`
    await session(browser, person, 'p-continut', async page => {
      await openProject(page, OWN)
      const sidebar = page.locator('aside')
      await sidebar.getByRole('button', { name: 'Adaugă fază' }).click()
      await sidebar.getByPlaceholder('Nume fază...').fill(phaseName)
      await sidebar.getByPlaceholder('Nume fază...').press('Enter')
      let phaseId = ''
      await stored('p-continut', person.who, 'adaugă o fază din bara laterală', 'fază nouă', async () => {
        const { data } = await service.from('project_phases').select('id').eq('project_id', OWN).eq('name', phaseName).maybeSingle()
        phaseId = data?.id ?? ''
        return phaseId
      }, v => !!v, v => (v ? 'fază nouă' : 'lipsește'))
      if (!phaseId) return

      await openProject(page, OWN, deepLink(phaseId))
      const main = projectMain(page)
      await main.getByRole('button', { name: 'Adaugă activitate' }).click()
      await main.getByPlaceholder('Nume activitate...').fill(activityName)
      await main.getByPlaceholder('Nume activitate...').press('Enter')
      let activityId = ''
      await stored('p-continut', person.who, 'adaugă o activitate în fază', 'activitate nouă', async () => {
        const { data } = await service.from('project_activities').select('id').eq('phase_id', phaseId).eq('name', activityName).maybeSingle()
        activityId = data?.id ?? ''
        return activityId
      }, v => !!v, v => (v ? 'activitate nouă' : 'lipsește'))

      if (activityId) {
        await openProject(page, OWN, deepLink(phaseId, activityId))
        await main.getByRole('button', { name: /cerere de document nouă/i }).first().click()
        const form = page.getByRole('dialog', { name: 'Cerere de document nouă' })
        await form.locator('input[type="text"]').first().fill(requestName)
        await form.getByRole('button', { name: 'Trimite cerere' }).click()
        await stored('p-continut', person.who, 'adaugă o cerere de document în activitate', 'cerere nouă', async () => {
          const { data } = await service.from('document_requirements').select('id').eq('activity_id', activityId).eq('name', requestName).maybeSingle()
          return data?.id ?? ''
        }, v => !!v, v => (v ? 'cerere nouă' : 'lipsește'))
      }

      await openProject(page, OWN, deepLink(phaseId))
      await main.getByRole('button', { name: `Acțiuni pentru faza ${phaseName}` }).first().click()
      await page.getByRole('menuitem', { name: /Redenumește/ }).click()
      const input = main.locator(`input[title="${phaseName}"]`)
      await input.fill(renamed)
      await input.press('Enter')
      await stored('p-continut', person.who, 'redenumește faza din meniul ei', renamed, async () => {
        const { data } = await service.from('project_phases').select('name').eq('id', phaseId).single()
        return data?.name as string
      }, v => v === renamed, v => String(v))
    })
  }
})

test('Aprobă sau respinge documentele — din fișa cererii, pentru toți în proiectul propriu', async ({ browser }) => {
  const phaseId = await addPhase(OWN, `Fază pentru verificare ${STAMP}`)
  const activityId = await addActivity(OWN, phaseId, `Activitate pentru verificare ${STAMP}`)
  for (const person of [admin, SA, JA]) {
    const approve = await requestInReview(OWN, activityId, `De aprobat în interfață (${person.who})`)
    const reject = await requestInReview(OWN, activityId, `De respins în interfață (${person.who})`)
    await session(browser, person, 'p-aproba', async page => {
      const approveButton = page.getByRole('button', { name: /Aprobă documentul/ })
      await openProject(page, OWN, deepLink(phaseId, activityId, approve))
      if (!(await visible(approveButton, 8_000))) await page.locator(`#request-${approve}`).click()
      await approveButton.click()
      await stored('p-aproba', person.who, 'aprobă un document din fișa cererii', 'approved', async () => {
        const { data } = await service.from('document_requirements').select('status').eq('id', approve).single()
        return data?.status as string
      }, v => v === 'approved', v => String(v))

      await openProject(page, OWN, deepLink(phaseId, activityId, reject))
      const rejectButton = page.getByRole('button', { name: 'Respinge', exact: true })
      if (!(await visible(rejectButton, 8_000))) await page.locator(`#request-${reject}`).click()
      await page.getByPlaceholder('Opțional la aprobare, obligatoriu la respingere').fill('Documentul nu se citește.')
      await rejectButton.click()
      await page.getByRole('button', { name: 'Respinge documentul' }).click()
      await stored('p-aproba', person.who, 'respinge un document, cu motiv', 'rejected', async () => {
        const { data } = await service.from('document_requirements').select('status').eq('id', reject).single()
        return data?.status as string
      }, v => v === 'rejected', v => String(v))
    })
  }
})

test('Schimbă titlul, statusul și reminderele — adminul și seniorul din bara proiectului; juniorul nu le are', async ({ browser }) => {
  await session(browser, admin, 'p-editeaza', async page => {
    await openProject(page, OWN)
    await shows('p-editeaza', 'admin', 'are „Redenumește proiectul”', page.getByRole('button', { name: 'Redenumește proiectul' }), true, page)
    await shows('p-editeaza', 'admin', 'are comutatorul de remindere', page.locator('[title^="Reminderele automate sunt"]'), true, page)
    const renamed = `${OWN_TITLE} (redenumit de admin)`
    await page.getByRole('button', { name: 'Redenumește proiectul' }).click()
    await page.getByLabel('Titlul proiectului').fill(renamed)
    await page.getByRole('button', { name: 'Salvează', exact: true }).click()
    await stored('p-editeaza', 'admin', 'redenumirea din interfață ajunge în bază', renamed, async () => {
      const { data } = await service.from('projects').select('title').eq('id', OWN).single()
      return data?.title as string
    }, v => v === renamed, v => String(v))
    await must(admin, 'PATCH', `/api/projects/${OWN}`, { title: OWN_TITLE })
  })

  await session(browser, SA, 'p-editeaza', async page => {
    await openProject(page, OWN)
    await shows('p-editeaza', 'senior', 'are „Redenumește proiectul”', page.getByRole('button', { name: 'Redenumește proiectul' }), true, page)
    await page.locator('[title^="Reminderele automate sunt pornite"]').click()
    await page.getByRole('dialog').getByRole('button', { name: 'Oprește reminderele' }).click()
    await stored('p-editeaza', 'senior', 'oprește reminderele din bara proiectului', 'false', async () => {
      const { data } = await service.from('projects').select('automatic_reminders_enabled').eq('id', OWN).single()
      return data?.automatic_reminders_enabled as boolean
    }, v => v === false, v => String(v))
    await page.locator('[title^="Reminderele automate sunt oprite"]').click()
    await stored('p-editeaza', 'senior', 'le pornește la loc', 'true', async () => {
      const { data } = await service.from('projects').select('automatic_reminders_enabled').eq('id', OWN).single()
      return data?.automatic_reminders_enabled as boolean
    }, v => v === true, v => String(v))
  })

  await session(browser, JA, 'p-editeaza', async page => {
    await openProject(page, OWN)
    await shows('p-editeaza', 'junior', 'nu are „Redenumește proiectul”', page.getByRole('button', { name: 'Redenumește proiectul' }), false, page)
    await shows('p-editeaza', 'junior', 'nu are comutatorul de remindere', page.locator('[title^="Reminderele automate sunt"]'), false, page)
  })

  observe('p-editeaza', 'Statusul proiectului nu are control în interfață, pentru niciun rol (nici admin)', 'se schimbă doar prin API; drepturi.spec.ts verifică acolo admin/senior da, junior nu')
})

test('Șterge faze și activități — „Șterge” apare la admin și senior, nu la junior; activitatea ștearsă își păstrează cererile', async ({ browser }) => {
  const phaseName = `Fază cu ștergeri ${STAMP}`
  const doomedName = `Activitate de șters ${STAMP}`
  const keptName = `Activitate care rămâne ${STAMP}`
  const phaseId = await addPhase(OWN, phaseName)
  const doomed = await addActivity(OWN, phaseId, doomedName)
  await addActivity(OWN, phaseId, keptName)
  const request = await addRequest(OWN, doomed, `Cerere din activitatea ștearsă ${STAMP}`)

  await session(browser, SA, 'p-sterge-faze', async page => {
    await openProject(page, OWN, deepLink(phaseId))
    const main = projectMain(page)
    await main.getByRole('button', { name: `Acțiuni pentru activitatea ${doomedName}` }).click()
    await page.getByRole('menuitem', { name: /Șterge/ }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Șterge activitatea' }).click()
    await stored('p-sterge-faze', 'senior', 'șterge o activitate, cu confirmare', 'ștearsă', async () => {
      const { data, error } = await service.from('project_activities').select('id').eq('id', doomed).maybeSingle()
      if (error) throw error
      return data
    }, v => !v, v => (v ? 'încă acolo' : 'ștearsă'))
    await stored('p-sterge-faze', 'senior', 'cererea din activitatea ștearsă se păstrează', 'păstrată', async () => {
      const { data, error } = await service.from('document_requirements').select('id, deleted_at').eq('id', request).maybeSingle()
      if (error) throw error
      return data
    }, v => !!v && !v.deleted_at, v => (v ? (v.deleted_at ? 'marcată ștearsă' : 'păstrată') : 'dispărută'))
  })

  for (const [person, allowed] of [[admin, true], [JA, false]] as const) {
    await session(browser, person, 'p-sterge-faze', async page => {
      await openProject(page, OWN, deepLink(phaseId))
      const main = projectMain(page)
      await main.getByRole('button', { name: `Acțiuni pentru activitatea ${keptName}` }).click()
      await shows('p-sterge-faze', person.who, `meniul activității ${allowed ? 'are' : 'nu are'} „Șterge”`, page.getByRole('menuitem', { name: /Șterge/ }), allowed, page)
      await page.keyboard.press('Escape')
      await main.getByRole('button', { name: `Acțiuni pentru faza ${phaseName}` }).click()
      await shows('p-sterge-faze', person.who, `meniul fazei ${allowed ? 'are' : 'nu are'} „Șterge”`, page.getByRole('menuitem', { name: /Șterge/ }), allowed, page)
      await page.keyboard.press('Escape')
    })
  }
})

test('Adaugă colegi — adminul și seniorul din panoul echipei; juniorul doar citește', async ({ browser }) => {
  await session(browser, admin, 'p-adauga-colegi', async page => {
    const panel = await openTeam(page, OTHER)
    await panel.locator('#echipa-adauga option', { hasText: JB.name }).waitFor({ state: 'attached', timeout: 30_000 })
    await panel.locator('#echipa-adauga').selectOption(JB.id)
    await panel.getByRole('button', { name: 'Adaugă', exact: true }).click()
    await stored('p-adauga-colegi', 'admin', 'adaugă un coleg într-un proiect în care nu e membru', 'membru', () => memberRow(OTHER, JB.id), v => !!v, v => (v ? 'membru' : 'lipsește'))
    await panel.getByRole('button', { name: `Scoate pe ${JB.name} din echipă` }).click()
    await panel.getByRole('button', { name: 'Scoate din echipă' }).click()
    await stored('p-adauga-colegi', 'admin', 'și îl scoate la loc', 'scos', () => memberRow(OTHER, JB.id), v => !v, v => (v ? 'încă membru' : 'scos'))
  })
  await session(browser, SA, 'p-adauga-colegi', async page => {
    const panel = await openTeam(page, OWN)
    await shows('p-adauga-colegi', 'senior', 'panoul are „Adaugă în echipă”', panel.locator('#echipa-adauga'), true, page)
  })
  await session(browser, JA, 'p-adauga-colegi', async page => {
    const panel = await openTeam(page, OWN)
    await shows('p-adauga-colegi', 'junior', 'panoul nu are „Adaugă în echipă”', panel.locator('#echipa-adauga'), false, page)
    await shows('p-adauga-colegi', 'junior', 'panoul spune cine schimbă echipa', panel.getByText('Echipa o schimbă un administrator sau un consultant senior din echipă.'), true, page)
  })
})

test('Scoate colegi — seniorul primește motivul când încearcă consultantul general sau pe cineva cu sarcini; adminul poate scoate un senior', async ({ browser }) => {
  await ensureMember(OWN, JB)
  await ensureMember(OWN, SB)
  const phaseId = await addPhase(OWN, `Fază cu sarcini ${STAMP}`)
  const activityId = await addActivity(OWN, phaseId, `Activitate asignată ${STAMP}`)

  await must(admin, 'PATCH', `/api/projects/${OWN}`, { general_consultant_id: JB.id })
  try {
    await session(browser, SA, 'p-scoate-colegi', async page => {
      const panel = await openTeam(page, OWN)
      await panel.getByRole('button', { name: `Scoate pe ${JB.name} din echipă` }).click()
      await panel.getByRole('button', { name: 'Scoate din echipă' }).click()
      await shows('p-scoate-colegi', 'senior', 'la consultantul general, panoul spune de ce nu se poate', panel.getByRole('alert').filter({ hasText: 'răspunde de cererile generale' }), true, page)
      await stored('p-scoate-colegi', 'senior', 'consultantul general rămâne în echipă', 'membru', () => memberRow(OWN, JB.id), v => !!v, v => (v ? 'membru' : 'scos'))
    })
  } finally {
    await must(admin, 'PATCH', `/api/projects/${OWN}`, { general_consultant_id: null })
  }

  await must(admin, 'PATCH', `/api/projects/${OWN}/phases/${phaseId}/activities/${activityId}`, { assigned_to: JB.id })
  try {
    await session(browser, SA, 'p-scoate-colegi', async page => {
      const panel = await openTeam(page, OWN)
      await shows('p-scoate-colegi', 'senior', 'nu are buton de scoatere la alt senior', panel.getByRole('button', { name: `Scoate pe ${SB.name} din echipă` }), false, page)
      await shows('p-scoate-colegi', 'senior', 'nu are buton de scoatere la el însuși', panel.getByRole('button', { name: `Scoate pe ${SA.name} din echipă` }), false, page)
      await panel.getByRole('button', { name: `Scoate pe ${JB.name} din echipă` }).click()
      await panel.getByRole('button', { name: 'Scoate din echipă' }).click()
      await shows('p-scoate-colegi', 'senior', 'la un junior cu activități atribuite, panoul spune de ce nu se poate', panel.getByRole('alert').filter({ hasText: 'activități atribuite' }), true, page)
      await stored('p-scoate-colegi', 'senior', 'juniorul cu sarcini rămâne în echipă', 'membru', () => memberRow(OWN, JB.id), v => !!v, v => (v ? 'membru' : 'scos'))
    })
  } finally {
    await must(admin, 'PATCH', `/api/projects/${OWN}/phases/${phaseId}/activities/${activityId}`, { assigned_to: null })
  }

  await session(browser, admin, 'p-scoate-colegi', async page => {
    const panel = await openTeam(page, OWN)
    await shows('p-scoate-colegi', 'admin', 'are buton de scoatere și la un senior', panel.getByRole('button', { name: `Scoate pe ${SB.name} din echipă` }), true, page)
  })
  await session(browser, JA, 'p-scoate-colegi', async page => {
    const panel = await openTeam(page, OWN)
    await shows('p-scoate-colegi', 'junior', 'nu are niciun buton de scoatere', panel.getByRole('button', { name: /^Scoate pe/ }), false, page)
  })
})

test('Șterge mesajele altora din chat — adminul și seniorul din meniul mesajului; juniorul nu are meniu pe mesajele altora', async ({ browser }) => {
  const byJunior = `Mesaj de junior, de șters ${STAMP}`
  const byJuniorId = await postMessage(JA, OWN, byJunior)
  const bySenior = `Mesaj de senior ${STAMP}`
  await postMessage(SB, OWN, bySenior)

  await session(browser, SA, 'p-chat-sterge', async page => {
    await openChat(page, OWN)
    const menu = await messageMenu(page, byJunior)
    await check('p-chat-sterge', 'senior', 'meniul mesajului unui junior are „Șterge”', 'vizibil', async () => ({ ok: menu.remove, actual: menu.remove ? 'vizibil' : menu.menu ? 'lipsește' : 'fără meniu' }), { page })
    if (menu.remove) {
      await menu.bubble.getByRole('button', { name: 'Șterge', exact: true }).click()
      await page.getByRole('button', { name: 'Șterge mesajul' }).click()
      await stored('p-chat-sterge', 'senior', 'mesajul altcuiva se șterge din interfață', 'șters', async () => {
        const { data, error } = await service.from('project_chat_messages').select('deleted_at').eq('id', byJuniorId).maybeSingle()
        if (error) throw error
        return data
      }, v => !v || !!v.deleted_at, v => (!v || v.deleted_at ? 'șters' : 'încă acolo'))
    }
  })

  await session(browser, admin, 'p-chat-sterge', async page => {
    await openChat(page, OWN)
    const menu = await messageMenu(page, bySenior)
    await check('p-chat-sterge', 'admin', 'meniul mesajului altcuiva are „Șterge”', 'vizibil', async () => ({ ok: menu.remove, actual: menu.remove ? 'vizibil' : 'lipsește' }), { page })
  })

  await session(browser, JA, 'p-chat-sterge', async page => {
    await openChat(page, OWN)
    const menu = await messageMenu(page, bySenior)
    await check('p-chat-sterge', 'junior', 'mesajul altcuiva nu are meniu de ștergere', 'fără „Șterge”', async () => ({ ok: !menu.remove, actual: menu.remove ? '„Șterge” vizibil' : menu.menu ? 'meniu fără „Șterge”' : 'fără meniu' }), { page })
  })
})

test('Modifică textul mesajelor altora — doar adminul; fiecare își modifică propriile mesaje', async ({ browser }) => {
  const forAdmin = `De corectat de admin ${STAMP}`
  const forAdminId = await postMessage(JA, OWN, forAdmin)
  const forSenior = `Al juniorului, văzut de senior ${STAMP}`
  await postMessage(JA, OWN, forSenior)
  const seniorsOwn = `Al seniorului ${STAMP}`
  await postMessage(SA, OWN, seniorsOwn)

  await session(browser, admin, 'p-chat-editeaza', async page => {
    await openChat(page, OWN)
    const menu = await messageMenu(page, forAdmin)
    await check('p-chat-editeaza', 'admin', 'meniul mesajului altcuiva are „Editează”', 'vizibil', async () => ({ ok: menu.edit, actual: menu.edit ? 'vizibil' : 'lipsește' }), { page })
    if (menu.edit) {
      await menu.bubble.getByRole('button', { name: 'Editează', exact: true }).click()
      await page.locator('textarea').first().fill(`${forAdmin} (corectat)`)
      await page.getByRole('button', { name: 'Salvează', exact: true }).click()
      await stored('p-chat-editeaza', 'admin', 'textul corectat ajunge în bază', `${forAdmin} (corectat)`, async () => {
        const { data } = await service.from('project_chat_messages').select('body').eq('id', forAdminId).single()
        return data?.body as string
      }, v => v === `${forAdmin} (corectat)`, v => String(v))
    }
  })

  await session(browser, SA, 'p-chat-editeaza', async page => {
    await openChat(page, OWN)
    const other = await messageMenu(page, forSenior)
    await check('p-chat-editeaza', 'senior', 'meniul mesajului altcuiva nu are „Editează”', 'lipsește', async () => ({ ok: other.menu && !other.edit, actual: other.edit ? 'vizibil' : other.menu ? 'lipsește' : 'fără meniu' }), { page })
    // Fără Escape: ar închide tot chatul, nu doar meniul. Meniul următor îl înlocuiește.
    const own = await messageMenu(page, seniorsOwn)
    await check('p-chat-editeaza', 'senior', 'propriul mesaj are „Editează”', 'vizibil', async () => ({ ok: own.edit, actual: own.edit ? 'vizibil' : 'lipsește' }), { page })
  })

  await session(browser, JA, 'p-chat-editeaza', async page => {
    await openChat(page, OWN)
    const other = await messageMenu(page, seniorsOwn)
    await check('p-chat-editeaza', 'junior', 'mesajul altcuiva nu are „Editează”', 'lipsește', async () => ({ ok: !other.edit, actual: other.edit ? 'vizibil' : other.menu ? 'lipsește' : 'fără meniu' }), { page })
    const own = await messageMenu(page, forSenior)
    await check('p-chat-editeaza', 'junior', 'propriul mesaj are „Editează”', 'vizibil', async () => ({ ok: own.edit, actual: own.edit ? 'vizibil' : 'lipsește' }), { page })
  })
})

test('Schimbă clientul sau consultantul general — doar adminul are selectorul de la „Cereri generale”', async ({ browser }) => {
  await session(browser, admin, 'p-reasigneaza', async page => {
    await openProject(page, OWN, '?phase=__general__')
    const select = page.getByLabel('Atribuie consultant pentru cererile generale')
    await shows('p-reasigneaza', 'admin', 'are selectorul consultantului general', select, true, page)
    await select.selectOption(JA.id)
    await stored('p-reasigneaza', 'admin', 'alegerea din interfață ajunge în bază', JA.id, async () => {
      const { data } = await service.from('projects').select('general_consultant_id').eq('id', OWN).single()
      return data?.general_consultant_id as string | null
    }, v => v === JA.id, v => String(v))
    await must(admin, 'PATCH', `/api/projects/${OWN}`, { general_consultant_id: null })
  })
  for (const person of [SA, JA]) {
    await session(browser, person, 'p-reasigneaza', async page => {
      await openProject(page, OWN, '?phase=__general__')
      await page.getByText('Cereri generale').first().waitFor({ timeout: 30_000 })
      await shows('p-reasigneaza', person.who, 'nu are selectorul consultantului general', page.getByLabel('Atribuie consultant pentru cererile generale'), false, page)
    })
  }
  observe('p-reasigneaza', 'Clientul unui proiect nu se schimbă din interfață, pentru niciun rol (nici admin)', 'se schimbă doar prin API; drepturi.spec.ts verifică acolo că doar adminul poate')
})

test('Șterge proiectul — doar adminul are „Șterge proiectul” pe prima pagină', async ({ browser }) => {
  const doomedTitle = `Interfață ${STAMP} — de șters din interfață`
  const doomed = await createProject(doomedTitle, [SA.id])
  for (const person of [SA, JA]) {
    await session(browser, person, 'p-sterge', async page => {
      await page.goto('/')
      await page.getByRole('heading', { name: OWN_TITLE, exact: true }).waitFor({ timeout: 30_000 })
      await shows('p-sterge', person.who, 'cardurile nu au „Opțiuni proiect” (ștergere)', page.getByRole('button', { name: 'Opțiuni proiect' }), false, page)
    })
  }
  await session(browser, admin, 'p-sterge', async page => {
    await page.goto('/')
    const heading = page.getByRole('heading', { name: doomedTitle, exact: true })
    await heading.waitFor({ timeout: 30_000 })
    const card = heading.locator('xpath=ancestor::*[.//button[@aria-label="Opțiuni proiect"]][1]')
    await card.getByRole('button', { name: 'Opțiuni proiect' }).click()
    await card.getByRole('button', { name: 'Șterge proiectul' }).click()
    await confirmWithWord(page, `Șterge "${doomedTitle}"`, 'sterge', 'Șterge proiectul')
    await stored('p-sterge', 'admin', 'proiectul șters din interfață dispare din bază', 'șters', async () => {
      const { data } = await service.from('projects').select('id').eq('id', doomed).maybeSingle()
      return data
    }, v => !v, v => (v ? 'încă există' : 'șters'))
  })
})

// ═══ ȘABLOANE ════════════════════════════════════════════════════════════════

test('Vede șabloanele — adminul, seniorul și juniorul au lista și meniul; clientul e trimis înapoi', async ({ browser }) => {
  for (const person of [admin, SA, JA]) {
    await session(browser, person, 's-vede', async page => {
      const links = await navLinks(page)
      await check('s-vede', person.who, 'meniul are „Șabloane”', 'da', async () => ({ ok: links.includes('Șabloane'), actual: links.join(', ') || 'niciun link' }), { page })
      await page.goto('/admin/templates')
      await shows('s-vede', person.who, 'lista arată șablonul publicat', page.getByText(TPL_NAME, { exact: true }), true, page)
    })
  }
  await session(browser, client, 's-vede', async page => {
    const links = await navLinks(page)
    await check('s-vede', 'client', 'meniul nu are „Șabloane”', 'nu', async () => ({ ok: !links.includes('Șabloane'), actual: links.join(', ') || 'niciun link' }), { page })
    await check('s-vede', 'client', 'deschide /admin/templates și e trimis înapoi', 'trimis înapoi', async () => {
      const stays = await staysOn(page, '/admin/templates')
      return { ok: !stays, actual: stays ? 'a rămas pe pagină' : `pe ${new URL(page.url()).pathname}` }
    }, { page })
  })
})

test('Creează și modifică ciorne de șablon — toți, din editor', async ({ browser }) => {
  for (const person of [admin, SA, JA]) {
    const name = `Interfață ${STAMP} — ciornă de ${person.who}`
    await session(browser, person, 's-ciorne', async page => {
      await page.goto('/admin/templates')
      await page.getByRole('button', { name: 'Șablon nou' }).first().click()
      await page.getByLabel('Nume șablon').fill(name)
      await page.getByRole('button', { name: 'Adaugă fază nouă' }).click()
      await page.getByLabel('Nume pentru faza 1').fill('Etapa întâi')
      await page.getByRole('button', { name: 'Creează template' }).click()
      await stored('s-ciorne', person.who, 'creează o ciornă din editor', 'draft', async () => {
        const { data } = await service.from('project_templates').select('id, status').eq('name', name).maybeSingle()
        if (data) created.templates.add(data.id)
        return data?.status as string | undefined
      }, v => v === 'draft', v => String(v ?? 'lipsește'))
    })
  }

  const phaseName = `Fază pusă de junior ${STAMP}`
  await session(browser, JA, 's-ciorne', async page => {
    await page.goto('/admin/templates')
    await page.getByRole('button', { name: `Editează șablonul ${ADMIN_DRAFT_NAME}`, exact: true }).click()
    await addEditorPhase(page, phaseName)
    await page.getByRole('button', { name: 'Salvează modificările' }).click()
    await stored('s-ciorne', 'junior', 'modifică ciorna altcuiva din editor', 'faza adăugată', async () => {
      const { data } = await service.from('template_phases').select('id').eq('template_id', ADMIN_DRAFT).eq('name', phaseName).maybeSingle()
      return data?.id as string | undefined
    }, v => !!v, v => (v ? 'faza adăugată' : 'lipsește'))
  })
})

test('Modifică un șablon publicat — adminul și seniorul din editor; juniorul nu ajunge în editor', async ({ browser }) => {
  for (const person of [admin, SA]) {
    const phaseName = `Fază pusă de ${person.who} pe publicat ${STAMP}`
    await session(browser, person, 's-publicat', async page => {
      await page.goto('/admin/templates')
      await page.getByRole('button', { name: `Editează șablonul ${TPL_NAME}`, exact: true }).click()
      await addEditorPhase(page, phaseName)
      await page.getByRole('button', { name: 'Salvează modificările' }).click()
      await stored('s-publicat', person.who, 'salvează o fază nouă într-un șablon publicat', 'faza adăugată', async () => {
        const { data } = await service.from('template_phases').select('id').eq('template_id', TPL).eq('name', phaseName).maybeSingle()
        return data?.id as string | undefined
      }, v => !!v, v => (v ? 'faza adăugată' : 'lipsește'))
    })
  }
  await session(browser, JA, 's-publicat', async page => {
    await page.goto('/admin/templates')
    await page.getByText(TPL_NAME, { exact: true }).first().waitFor({ timeout: 30_000 })
    await shows('s-publicat', 'junior', 'șablonul publicat nu are „Editează”', page.getByRole('button', { name: `Editează șablonul ${TPL_NAME}`, exact: true }), false, page)
    await page.goto(`/admin/templates?edit=${TPL}`)
    await shows('s-publicat', 'junior', 'linkul direct spune cine îl poate edita', page.getByText(/doar un administrator sau un consultant senior îl poate edita/), true, page)
    await shows('s-publicat', 'junior', 'linkul direct nu deschide editorul', page.getByRole('button', { name: 'Salvează modificările' }), false, page)
  })
})

test('Duplică un șablon — adminul și seniorul; juniorul nu are butonul', async ({ browser }) => {
  for (const person of [admin, SA]) {
    await session(browser, person, 's-duplica', async page => {
      const before = (await service.from('project_templates').select('id').eq('name', `${TPL_NAME} (Copie)`)).data?.length ?? 0
      await page.goto('/admin/templates')
      await page.getByRole('button', { name: `Duplică șablonul ${TPL_NAME}`, exact: true }).click()
      await stored('s-duplica', person.who, 'duplică din listă; copia pornește ciornă', 'o copie nouă, ciornă', async () => {
        const { data } = await service.from('project_templates').select('id, status').eq('name', `${TPL_NAME} (Copie)`)
        for (const row of data ?? []) created.templates.add(row.id)
        return data ?? []
      }, v => v.length > before && v.every(row => row.status === 'draft'), v => `${v.length - before} copii noi, ${v.map(row => row.status).join('/') || '—'}`)
    })
  }
  await session(browser, JA, 's-duplica', async page => {
    await page.goto('/admin/templates')
    await page.getByText(TPL_NAME, { exact: true }).first().waitFor({ timeout: 30_000 })
    await shows('s-duplica', 'junior', 'nu are „Duplică”', page.getByRole('button', { name: /^Duplică șablonul/ }), false, page)
  })
})

test('Șterge un șablon — adminul și seniorul; blocat dacă îl folosește un proiect; juniorul nu are butonul', async ({ browser }) => {
  const unusedName = `Interfață ${STAMP} — șablon de șters`
  const unused = await createTemplate(admin, unusedName)
  const usedBy = await createProject(`Interfață ${STAMP} — proiect pe șablonul publicat`, [SA.id])
  await must(admin, 'POST', `/api/projects/${usedBy}/import-template`, { template_id: TPL })

  await session(browser, SA, 's-sterge', async page => {
    await page.goto('/admin/templates')
    await page.getByRole('button', { name: `Șterge șablonul ${unusedName}`, exact: true }).click()
    await confirmWithWord(page, `Șterge template-ul "${unusedName}"?`, 'sterge', 'Șterge template-ul')
    await stored('s-sterge', 'senior', 'șterge un șablon nefolosit, cu confirmare', 'șters', async () => {
      const { data } = await service.from('project_templates').select('id').eq('id', unused).maybeSingle()
      return data
    }, v => !v, v => (v ? 'încă există' : 'șters'))

    await page.getByRole('button', { name: `Șterge șablonul ${TPL_NAME}`, exact: true }).click()
    const refused = page.waitForResponse(response => response.url().endsWith(`/api/admin/templates/${TPL}`) && response.request().method() === 'DELETE', { timeout: 30_000 })
    const dialog = await confirmWithWord(page, `Șterge template-ul "${TPL_NAME}"?`, 'sterge', 'Șterge template-ul')
    await check('s-sterge', 'senior', 'la un șablon folosit, serverul refuză ștergerea', 'HTTP 409 template_in_use', async () => {
      const response = await refused
      const body = await response.json().catch(() => ({})) as Json
      return { ok: response.status() === 409 && body.code === 'template_in_use', actual: `HTTP ${response.status()} ${body.code ?? ''}`.trim() }
    }, { page })
    await shows('s-sterge', 'senior', 'fereastra rămâne deschisă, cu un mesaj de eroare', dialog.getByRole('alert'), true, page)
    const message = (await dialog.getByRole('alert').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
    if (message && !/folosit/i.test(message)) {
      observe('s-sterge', 'Mesajul de la ștergerea blocată nu spune că șablonul e folosit de un proiect', `fereastra arată „${message}”; apiFetch înlocuiește orice eroare 409 cu textul generic din lib/user-error.js`)
    }
    await stored('s-sterge', 'senior', 'șablonul folosit rămâne', 'există', async () => {
      const { data } = await service.from('project_templates').select('id').eq('id', TPL).maybeSingle()
      return data
    }, v => !!v, v => (v ? 'există' : 'șters'))
  })

  const juniorDraft = await createTemplate(JA, `Interfață ${STAMP} — ciornă de junior, de păstrat`)
  await session(browser, admin, 's-sterge', async page => {
    await page.goto('/admin/templates')
    await shows('s-sterge', 'admin', 'are „Șterge” pe șablonul publicat', page.getByRole('button', { name: `Șterge șablonul ${TPL_NAME}`, exact: true }), true, page)
  })
  await session(browser, JA, 's-sterge', async page => {
    await page.goto('/admin/templates')
    await page.getByText(TPL_NAME, { exact: true }).first().waitFor({ timeout: 30_000 })
    await shows('s-sterge', 'junior', 'nu are „Șterge” nici pe propria ciornă', page.getByRole('button', { name: /^Șterge șablonul/ }), false, page)
  })
  created.templates.add(juniorDraft)
})

test('Dezactivează un șablon sau îl face implicit — nimeni n-are control în interfață; seniorul și juniorul nu văd nimic de felul ăsta', async ({ browser }) => {
  for (const person of [SA, JA]) {
    await session(browser, person, 's-dezactiveaza', async page => {
      await page.goto('/admin/templates')
      await page.getByText(TPL_NAME, { exact: true }).first().waitFor({ timeout: 30_000 })
      await shows('s-dezactiveaza', person.who, 'lista nu are dezactivare sau „implicit”', page.getByRole('button', { name: /dezactiv|implicit/i }).or(page.getByRole('checkbox', { name: /activ|implicit/i })), false, page)
    })
  }
  observe('s-dezactiveaza', 'Dezactivarea și „implicit” nu au control în interfață, pentru niciun rol (nici admin)', 'se schimbă doar prin API; drepturi.spec.ts verifică acolo că doar adminul poate')
})

test('Publică un șablon — doar adminul, din listă; fereastra nu contrazice matricea', async ({ browser }) => {
  const draftName = `Interfață ${STAMP} — de publicat din interfață`
  const draft = await createTemplate(SA, draftName)
  for (const person of [SA, JA]) {
    await session(browser, person, 's-publica', async page => {
      await page.goto('/admin/templates')
      await page.getByText(draftName, { exact: true }).first().waitFor({ timeout: 30_000 })
      await shows('s-publica', person.who, 'nu are „Publică”', page.getByRole('button', { name: `Publică șablonul ${draftName}`, exact: true }), false, page)
    })
  }
  await session(browser, admin, 's-publica', async page => {
    await page.goto('/admin/templates')
    await page.getByRole('button', { name: `Publică șablonul ${draftName}`, exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Aprobă template-ul' })
    await dialog.waitFor({ timeout: 15_000 })
    // După #104 seniorul editează șabloanele publicate, juniorul nu: fereastra
    // îi spune adminului exact asta.
    await check('s-publica', 'admin', 'fereastra de publicare spune că, dintre consultanți, doar seniorii îl mai pot edita', 'doar seniorii', async () => {
      const text = (await dialog.innerText()).replace(/\s+/g, ' ')
      const sentence = text.match(/După aprobare[^.]*\./)?.[0] ?? 'fără propoziția despre editare'
      return { ok: /doar seniorii îl mai pot edita/i.test(sentence), actual: `„${sentence}”` }
    }, { page })
    await confirmWithWord(page, 'Aprobă template-ul', 'aproba', 'Aprobă')
    await stored('s-publica', 'admin', 'publicarea din interfață ajunge în bază', 'published', async () => {
      const { data } = await service.from('project_templates').select('status').eq('id', draft).single()
      return data?.status as string
    }, v => v === 'published', v => String(v))
  })
})

test('Aplică modificările în proiectele existente — doar adminul vede eticheta „Modificări neaplicate” și o aplică', async ({ browser }) => {
  // Proiectul de la testul de ștergere folosește TPL; o modificare de senior aprinde eticheta.
  const template = (await must(admin, 'GET', `/api/admin/templates/${TPL}`)).template as Json
  const phases = (template.phases as Json[]).map(phase => ({
    id: phase.id, name: phase.name, project_status_id: phase.project_status_id,
    activities: (phase.activities as Json[]).map(activity => ({
      id: activity.id, name: activity.name, default_consultant_id: activity.default_consultant_id,
      document_requirements: (activity.document_requirements as Json[]).map(doc => ({
        id: doc.id, name: doc.name, description: doc.description, is_outgoing: doc.is_outgoing,
        requirement_type: doc.requirement_type, attachments: doc.attachments,
      })),
    })),
  }))
  phases.push({ id: `nou-${randomUUID()}`, name: `Fază de propagat ${STAMP}`, project_status_id: statusId, activities: [] })
  await must(SA, 'PUT', `/api/admin/templates/${TPL}/tree`, { name: template.name, description: template.description, phases })

  const label = 'Modificări neaplicate în proiecte'
  for (const person of [SA, JA]) {
    await session(browser, person, 's-aplica', async page => {
      await page.goto('/admin/templates')
      const row = page.getByRole('row').filter({ has: page.getByText(TPL_NAME, { exact: true }) }).first()
      await row.waitFor({ timeout: 30_000 })
      await shows('s-aplica', person.who, `nu vede eticheta „${label}”`, row.getByText(label), false, page)
    })
  }
  await session(browser, admin, 's-aplica', async page => {
    await page.goto('/admin/templates')
    const row = page.getByRole('row').filter({ has: page.getByText(TPL_NAME, { exact: true }) }).first()
    await row.waitFor({ timeout: 30_000 })
    const shown = await shows('s-aplica', 'admin', `vede eticheta „${label}” pe șablonul schimbat de senior`, row.getByText(label), true, page)
    if (!shown) return
    await row.getByText(label).click()
    const applied = page.waitForResponse(response => response.url().endsWith('/propagation/apply'), { timeout: 30_000 })
    const apply = page.getByRole('button', { name: /Aplică|Propagă/ }).last()
    await apply.waitFor({ timeout: 30_000 })
    if (await apply.isDisabled()) {
      const boxes = page.getByRole('checkbox')
      for (let i = 0; i < await boxes.count(); i++) if (!(await boxes.nth(i).isChecked())) await boxes.nth(i).check().catch(() => {})
    }
    await apply.click()
    await check('s-aplica', 'admin', 'aplică modificările din fereastra de propagare', 'HTTP 2xx', async () => {
      const response = await applied
      return { ok: response.ok(), actual: `HTTP ${response.status()}` }
    }, { page })
    await stored('s-aplica', 'admin', 'după aplicare eticheta se stinge', 'null', async () => {
      const { data } = await service.from('project_templates').select('unpropagated_changes_at').eq('id', TPL).single()
      return data?.unpropagated_changes_at as string | null
    }, v => v === null, v => String(v))
  })
})

// ═══ ADMINISTRAREA PLATFORMEI ════════════════════════════════════════════════

test('Conturi — adminul creează, schimbă rolul și șterge din „Utilizatori”; un cont nou pornește junior; consultanții nu ajung acolo', async ({ browser }) => {
  const email = `interfata.nou.${STAMP}@test.local`
  const name = `Consultant nou ${STAMP}`
  await session(browser, admin, 'a-conturi', async page => {
    const links = await navLinks(page)
    await check('a-conturi', 'admin', 'meniul are „Utilizatori”', 'da', async () => ({ ok: links.includes('Utilizatori'), actual: links.join(', ') }), { page })
    await page.goto('/admin/users')
    await page.getByRole('button', { name: 'Adaugă utilizator' }).first().click()
    const panel = page.getByRole('dialog', { name: 'Adaugă utilizator' })
    await panel.getByRole('radio', { name: 'Consultant' }).check()
    await panel.getByLabel('Email').fill(email)
    await panel.getByLabel('Nume complet').fill(name)
    await expect(panel.getByLabel('Parolă temporară')).toHaveCount(0)
    await panel.getByLabel('Specializare').fill('PNRR')
    await panel.getByRole('button', { name: 'Creează' }).click()
    let userId = ''
    await stored('a-conturi', 'admin', 'creează un cont de consultant din panou', 'consultant', async () => {
      const { data } = await service.from('profiles').select('id, role, consultant_level').eq('email', email).maybeSingle()
      if (data) { userId = data.id; created.users.add(data.id) }
      return data
    }, v => v?.role === 'consultant', v => String(v?.role ?? 'lipsește'))
    if (!userId) return
    await stored('r-junior', 'sistem', 'contul nou pornește junior, în bază', 'junior', async () => {
      const { data } = await service.from('profiles').select('consultant_level').eq('id', userId).single()
      return data?.consultant_level as string
    }, v => v === 'junior', v => String(v))

    await page.goto(`/admin/users/${userId}`)
    const level = page.getByRole('radiogroup', { name: 'Nivelul consultantului' })
    await check('r-junior', 'admin', 'pagina contului nou arată „Junior” ales', 'Junior', async () => {
      await level.waitFor({ timeout: 30_000 })
      const junior = await level.getByRole('radio', { name: 'Junior' }).getAttribute('aria-checked')
      return { ok: junior === 'true', actual: junior === 'true' ? 'Junior' : 'Senior' }
    }, { page })

    await page.goto('/admin/users')
    await page.getByLabel('Caută utilizatori').fill(email)
    await page.getByLabel(`Rolul lui ${email}`).selectOption('client')
    await page.getByRole('dialog').getByRole('button', { name: 'Schimbă rolul' }).click()
    await stored('a-conturi', 'admin', 'schimbă rolul din listă', 'client', async () => {
      const { data } = await service.from('profiles').select('role').eq('id', userId).single()
      return data?.role as string
    }, v => v === 'client', v => String(v))

    await page.getByRole('button', { name: `Șterge definitiv utilizatorul ${email}` }).click()
    await confirmWithWord(page, 'Șterge definitiv utilizatorul', 'sterge', 'Șterge definitiv')
    await stored('a-conturi', 'admin', 'șterge contul din listă', 'șters', async () => {
      const { data } = await service.from('profiles').select('id').eq('id', userId).maybeSingle()
      return data
    }, v => !v, v => (v ? 'încă există' : 'șters'))
    created.users.delete(userId)
  })

  for (const person of [SA, JA]) {
    await session(browser, person, 'a-conturi', async page => {
      const links = await navLinks(page)
      await check('a-conturi', person.who, 'meniul nu are „Utilizatori”', 'nu', async () => ({ ok: !links.includes('Utilizatori'), actual: links.join(', ') || 'niciun link' }), { page })
      for (const url of ['/admin/users', `/admin/users/${JB.id}`]) {
        await check('a-conturi', person.who, `deschide ${url} și e trimis înapoi`, 'trimis înapoi', async () => {
          const stays = await staysOn(page, url)
          return { ok: !stays, actual: stays ? 'a rămas pe pagină' : `pe ${new URL(page.url()).pathname}` }
        }, { page })
      }
    })
  }
  observe('a-conturi', 'Parola temporară este generată automat la creare', 'nu există resetare separată de parolă în interfață')
})

test('Statusurile de proiect — adminul adaugă un status din pagină; consultanții sunt trimiși înapoi', async ({ browser }) => {
  const statusName = `Status din interfață ${STAMP}`
  await session(browser, admin, 'a-statusuri', async page => {
    const links = await navLinks(page)
    if (!links.includes('Statusuri')) {
      observe('a-statusuri', 'Pagina „Statusuri” nu are link în meniu, nici pentru admin', 'se deschide doar scriind /admin/statuses; ascunsă din 6ae7aa0, dar fazele de șablon cer iar un status')
    }
    await page.goto('/admin/statuses')
    await page.getByRole('button', { name: 'Status nou' }).click()
    await page.getByPlaceholder('Ex: Implementare').fill(statusName)
    await page.getByRole('button', { name: 'Creează', exact: true }).click()
    await stored('a-statusuri', 'admin', 'adaugă un status din pagină', 'creat', async () => {
      const { data } = await service.from('project_statuses').select('id').eq('name', statusName).maybeSingle()
      if (data) created.statuses.add(data.id)
      return data
    }, v => !!v, v => (v ? 'creat' : 'lipsește'))
  })
  for (const person of [SA, JA]) {
    await session(browser, person, 'a-statusuri', async page => {
      await check('a-statusuri', person.who, 'deschide /admin/statuses și e trimis înapoi', 'trimis înapoi', async () => {
        const stays = await staysOn(page, '/admin/statuses')
        return { ok: !stays, actual: stays ? 'a rămas pe pagină' : `pe ${new URL(page.url()).pathname}` }
      }, { page })
    })
  }
})

test('Jurnalul de audit și tabloul de bord — doar adminul; consultanții n-au link și sunt trimiși înapoi', async ({ browser }) => {
  await session(browser, admin, 'a-audit', async page => {
    const links = await navLinks(page)
    await check('a-audit', 'admin', 'meniul are „Audit”', 'da', async () => ({ ok: links.includes('Audit'), actual: links.join(', ') }), { page })
    await check('a-tablou', 'admin', 'meniul are „Tablou de bord”', 'da', async () => ({ ok: links.includes('Tablou de bord'), actual: links.join(', ') }), { page })
    await page.goto('/admin/audit')
    await shows('a-audit', 'admin', 'deschide jurnalul de audit', page.getByRole('heading', { level: 1, name: 'Jurnal de audit' }), true, page)
    await page.goto('/admin/proiecte')
    await shows('a-tablou', 'admin', 'deschide tabloul de bord', page.getByRole('heading', { level: 1, name: 'Tablou de bord' }), true, page)
    const search = page.getByPlaceholder('Caută proiect')
    if (await visible(search, 5_000)) await search.fill(STAMP)
    await shows('a-tablou', 'admin', 'tabloul arată și proiectul în care nu e membru', page.getByText(OTHER_TITLE).first(), true, page)
  })
  for (const person of [SA, JA]) {
    await session(browser, person, 'a-audit', async page => {
      const links = await navLinks(page)
      await check('a-audit', person.who, 'meniul nu are „Audit”', 'nu', async () => ({ ok: !links.includes('Audit'), actual: links.join(', ') || 'niciun link' }), { page })
      await check('a-tablou', person.who, 'meniul nu are „Tablou de bord”', 'nu', async () => ({ ok: !links.includes('Tablou de bord'), actual: links.join(', ') || 'niciun link' }), { page })
      for (const [row, url] of [['a-audit', '/admin/audit'], ['a-tablou', '/admin/proiecte'], ['a-tablou', '/admin']] as const) {
        await check(row, person.who, `deschide ${url} și e trimis înapoi`, 'trimis înapoi', async () => {
          const stays = await staysOn(page, url)
          return { ok: !stays, actual: stays ? 'a rămas pe pagină' : `pe ${new URL(page.url()).pathname}` }
        }, { page })
      }
    })
  }
})

// ═══ REGULI GENERALE ═════════════════════════════════════════════════════════

test('Doar adminul schimbă nivelul, din pagina utilizatorului; consultanții nu ajung la comutator', async ({ browser }) => {
  await session(browser, admin, 'r-nivel', async page => {
    await page.goto(`/admin/users/${JB.id}`)
    const group = page.getByRole('radiogroup', { name: 'Nivelul consultantului' })
    await group.waitFor({ timeout: 30_000 })
    await group.getByRole('radio', { name: 'Senior' }).click()
    await page.getByRole('button', { name: 'Promovează' }).click()
    await stored('r-nivel', 'admin', 'promovează un junior din pagina lui', 'senior', async () => {
      const { data } = await service.from('profiles').select('consultant_level').eq('id', JB.id).single()
      return data?.consultant_level as string
    }, v => v === 'senior', v => String(v))
    await group.getByRole('radio', { name: 'Junior' }).click()
    await page.getByRole('button', { name: 'Retrogradează' }).click()
    await stored('r-nivel', 'admin', 'îl retrogradează la loc', 'junior', async () => {
      const { data } = await service.from('profiles').select('consultant_level').eq('id', JB.id).single()
      return data?.consultant_level as string
    }, v => v === 'junior', v => String(v))
  })
  for (const person of [SA, JA]) {
    await session(browser, person, 'r-nivel', async page => {
      await page.goto(`/admin/users/${person.id}`)
      await page.waitForTimeout(2_500)
      await shows('r-nivel', person.who, 'nu ajunge la comutatorul de nivel, nici pentru el', page.getByRole('radiogroup', { name: 'Nivelul consultantului' }), false, page)
    })
  }
})

test('Retrogradarea are efect imediat, la următoarea acțiune, fără delogare', async ({ browser }) => {
  const attempted = `${OWN_TITLE} (după retrogradare)`
  await session(browser, SA, 'r-retrogradare', async page => {
    await openProject(page, OWN)
    const rename = page.getByRole('button', { name: 'Redenumește proiectul' })
    await shows('r-retrogradare', 'senior', 'înainte de retrogradare are „Redenumește proiectul”', rename, true, page)
    await must(admin, 'PATCH', `/api/users/${SA.id}`, { consultant_level: 'junior' })
    try {
      // Pagina e încă cea de senior: butonul stă acolo, dar serverul refuză.
      await rename.click()
      await page.getByLabel('Titlul proiectului').fill(attempted)
      await page.getByRole('button', { name: 'Salvează', exact: true }).click()
      await shows('r-retrogradare', 'senior', 'următoarea acțiune e refuzată, cu mesaj', page.getByText('Nu am putut salva proiectul'), true, page)
      await stored('r-retrogradare', 'senior', 'titlul nu se schimbă în bază', OWN_TITLE, async () => {
        const { data } = await service.from('projects').select('title').eq('id', OWN).single()
        return data?.title as string
      }, v => v === OWN_TITLE, v => String(v))
      await check('r-retrogradare', 'senior', 'rămâne autentificat, pe pagina proiectului', `/projects/${OWN}`, async () => {
        const pathname = new URL(page.url()).pathname
        return { ok: pathname === `/projects/${OWN}`, actual: pathname }
      }, { page })
      await openProject(page, OWN)
      await shows('r-retrogradare', 'senior', 'după reîncărcare, „Redenumește proiectul” a dispărut', page.getByRole('button', { name: 'Redenumește proiectul' }), false, page)
      await check('r-retrogradare', 'senior', 'și tot autentificat e', 'nu la /login', async () => {
        const pathname = new URL(page.url()).pathname
        return { ok: !pathname.startsWith('/login'), actual: pathname }
      }, { page })
    } finally {
      await must(admin, 'PATCH', `/api/users/${SA.id}`, { consultant_level: 'senior' })
    }
  })
})

test('Totul rămâne în audit — adminul vede în jurnal nivelul schimbat și acțiunile seniorului sub numele lui', async ({ browser }) => {
  await session(browser, admin, 'r-audit', async page => {
    await page.goto('/admin/audit')
    const search = page.getByLabel('Caută în jurnalul de audit')
    await search.waitFor({ timeout: 30_000 })

    await search.fill(`nivelul consultantului ${JB.email}`)
    await page.getByRole('button', { name: 'Caută', exact: true }).click()
    const levelRow = page.getByRole('row').filter({ hasText: `nivelul consultantului ${JB.email}` }).first()
    await shows('r-audit', 'admin', 'jurnalul arată schimbarea nivelului', levelRow, true, page)
    await check('r-audit', 'admin', 'sub numele adminului', admin.name, async () => {
      const text = await levelRow.innerText()
      return { ok: text.includes(admin.name), actual: text.replace(/\s+/g, ' ').slice(0, 160) }
    }, { page })

    await search.fill(`${SA.email} a dezactivat reminderele`)
    await page.getByRole('button', { name: 'Caută', exact: true }).click()
    const seniorRow = page.getByRole('row').filter({ hasText: OWN_TITLE }).first()
    await shows('r-audit', 'senior', 'jurnalul arată acțiunea seniorului din interfață', seniorRow, true, page)
    await check('r-audit', 'senior', 'sub numele seniorului', SA.name, async () => {
      const text = await seniorRow.innerText()
      return { ok: text.includes(SA.name), actual: text.replace(/\s+/g, ' ').slice(0, 160) }
    }, { page })
  })
})

test('Matricea din PDF, în interfață — toate verificările de mai sus', async () => {
  const failed = checks.filter(check => !check.ok)
  const notes = checks.filter(check => check.layer === 'Observație')
  const summary = failed.map(check => `✗ [${ROW[check.row].title}] ${check.who} · ${check.label}: așteptat ${check.expected}, obținut ${check.actual}${check.screenshot ? ` (${check.screenshot})` : ''}`)
  console.log(`Verificări: ${checks.length - notes.length}, respectate: ${checks.length - notes.length - failed.length}, abateri: ${failed.length}, observații: ${notes.length}`)
  for (const note of notes) console.log(`ℹ [${ROW[note.row].title}] ${note.label}: ${note.actual}`)
  const rowsWithoutChecks = ROWS.filter(row => row.section !== 'Reguli adăugate în aplicație' && !checks.some(check => check.row === row.id))
  expect(rowsWithoutChecks.map(row => row.title), 'rânduri din PDF fără nicio verificare în interfață').toEqual([])
  expect(failed, summary.join('\n')).toHaveLength(0)
})
