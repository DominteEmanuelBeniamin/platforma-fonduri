import fs from 'node:fs'
import path from 'node:path'
import { test, expect, type Browser } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { e2eEnv, requireE2EConfig, serviceClient } from './helpers/project-state'

/**
 * Regresii în jurul lucrului pentru consultantul senior: ce a atins schimbarea
 * dincolo de matricea de drepturi (tests/e2e/drepturi.spec.ts). Aici se
 * verifică fluxurile întregi din interfață — pagina „Dosar nou”, editorul de
 * șabloane, bara proiectului, panoul echipei, chatul — plus efectele laterale
 * pe API (nivelul la schimbarea rolului) și așezarea fâșiei de locație.
 *
 * Folosește aceleași conturi fixe de test ca suita de drepturi.
 */

const ENV = e2eEnv()
const CONFIG = requireE2EConfig(ENV)
const ADMIN_LOGIN = { email: ENV.E2E_ADMIN_EMAIL || CONFIG.staffEmail, password: ENV.E2E_ADMIN_PASSWORD || CONFIG.staffPassword }
const STAMP = Date.now().toString(36)
const PASSWORD = `Regresii-${STAMP}-2026!`
const SHOTS = path.join('playwright-report', 'regresii')

test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Person = { id: string; email: string; name: string; token: string }

const exact = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))

const service = serviceClient() as SupabaseClient
const created = { projects: new Set<string>(), templates: new Set<string>() }
const accounts = new Set<string>()
let admin: Person, SA: Person, JA: Person, JB: Person
let clientId = '', clientLabel = '', statusId = ''
let TPL = '', TPL_NAME = ''

async function signIn(email: string, password: string) {
  const anon = createClient(CONFIG.supabaseUrl, CONFIG.anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await anon.auth.signInWithPassword({ email, password })
  if (error || !data.session) throw new Error(`Autentificare ${email}: ${error?.message}`)
  return data.session.access_token
}

async function fixedConsultant(tag: 'sa' | 'ja' | 'jb', level: 'junior' | 'senior'): Promise<Person> {
  const email = `drepturi.${tag}@test.local`
  const name = `Test drepturi — ${{ sa: 'Senior A', ja: 'Junior A', jb: 'Junior B' }[tag]}`
  const { data } = await service.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
  let id = data?.user?.id
  if (!id) {
    const { data: existing } = await service.from('profiles').select('id').eq('email', email).single()
    id = existing!.id as string
    await service.auth.admin.updateUserById(id, { password: PASSWORD })
  }
  accounts.add(id)
  await service.from('profiles').upsert({ id, email, role: 'consultant', consultant_level: level, full_name: name, is_active: true })
  return { id, email, name, token: await signIn(email, PASSWORD) }
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
  expect(res.status, `${method} ${url}: ${JSON.stringify(res.json).slice(0, 300)}`).toBeLessThan(300)
  return res.json
}

async function login(browser: Browser, email: string, password: string, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/login')
  await page.fill('input[type=email]', email)
  await page.fill('input[type=password]', password)
  await page.click('button[type=submit]')
  await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 30_000 })
  return { context, page, errors }
}

async function newProject(title: string) {
  const json = await must(admin, 'POST', '/api/projects', { title, client_id: clientId, supervisor_ids: [SA.id] })
  created.projects.add(json.project.id)
  return json.project.id as string
}

async function memberIds(projectId: string) {
  const { data } = await service.from('project_members').select('consultant_id').eq('project_id', projectId)
  return (data ?? []).map(row => row.consultant_id as string)
}

test.beforeAll(async () => {
  fs.rmSync(SHOTS, { recursive: true, force: true })
  fs.mkdirSync(SHOTS, { recursive: true })
  const { data: adminProfile } = await service.from('profiles').select('id, email, full_name').eq('email', ADMIN_LOGIN.email).single()
  admin = { id: adminProfile!.id, email: adminProfile!.email, name: adminProfile!.full_name, token: await signIn(ADMIN_LOGIN.email, ADMIN_LOGIN.password) }
  const { data: client } = await service.from('profiles').select('id, nume_firma, full_name, email').eq('email', CONFIG.clientEmail).single()
  clientId = client!.id
  clientLabel = client!.nume_firma || client!.full_name || client!.email
  statusId = (await service.from('project_statuses').select('id').order('id').limit(1).single()).data!.id

  SA = await fixedConsultant('sa', 'senior')
  JA = await fixedConsultant('ja', 'junior')
  JB = await fixedConsultant('jb', 'junior')

  // Șablon publicat cu trei activități: una cu SA implicit (de anulat în formular),
  // una fără nimeni (de dat juniorului), una cu SA implicit (păstrat).
  TPL_NAME = `Regresii ${STAMP} — șablon`
  const tree = {
    name: TPL_NAME, slug: `regresii-${STAMP}`, description: 'Șablon pentru regresii',
    phases: [{
      id: 'p0', name: 'Pregătire', project_status_id: statusId,
      activities: [
        { id: 'a0', name: 'Activitate cu implicit anulat', default_consultant_id: SA.id, document_requirements: [] },
        { id: 'a1', name: 'Activitate fără implicit', default_consultant_id: null, document_requirements: [] },
        { id: 'a2', name: 'Activitate cu implicit păstrat', default_consultant_id: SA.id, document_requirements: [] },
      ],
    }],
  }
  const template = (await must(admin, 'POST', '/api/admin/templates', tree)).template
  created.templates.add(template.id)
  await must(admin, 'PATCH', `/api/admin/templates/${template.id}`, { status: 'published' })
  TPL = template.id
})

test.afterAll(async () => {
  if (!service) return
  for (const id of created.projects) await service.from('projects').delete().eq('id', id)
  for (const id of created.templates) await service.from('project_templates').delete().eq('id', id)
  for (const id of accounts) await service.from('profiles').update({ consultant_level: 'junior', is_active: false }).eq('id', id)
})

// ─── Dosar nou ───────────────────────────────────────────────────────────────

test('Dosar nou din interfață, ca junior: supervizor, șablon și consultanții pe activități', async ({ browser }) => {
  const title = `Regresii ${STAMP} — dosar de junior`
  const { context, page, errors } = await login(browser, JA.email, PASSWORD)
  try {
    await page.goto('/projects/new')
    await page.getByText(SA.name).first().waitFor({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: 'Deschide dosarul' })).toBeDisabled()
    await expect(page.getByText(/Mai lipsește numele, beneficiarul și un supervizor/)).toBeVisible()

    await page.fill('#dosar-nume', title)
    await page.selectOption('#dosar-beneficiar', clientId)
    await page.getByRole('checkbox', { name: exact(SA.name) }).check()
    await page.getByRole('radio', { name: /Din șablon/ }).check()
    await page.getByRole('radio', { name: exact(TPL_NAME) }).check()

    const cancelDefault = page.getByLabel('Activitate cu implicit anulat')
    const keepDefault = page.getByLabel('Activitate cu implicit păstrat')
    await expect(cancelDefault, 'consultantul implicit din șablon e propus').toHaveValue(SA.id)
    await expect(keepDefault).toHaveValue(SA.id)
    await cancelDefault.selectOption('')
    await page.getByLabel('Activitate fără implicit').selectOption(JA.id)
    await expect(page.getByText(`„${title}”`)).toBeVisible()
    await page.screenshot({ path: path.join(SHOTS, 'dosar-nou-junior.png') })

    await page.getByRole('button', { name: 'Deschide dosarul' }).click()
    await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/, { timeout: 60_000 })
    const projectId = new URL(page.url()).pathname.split('/').pop()!
    created.projects.add(projectId)

    const members = await memberIds(projectId)
    expect(members, 'juniorul care creează devine membru').toContain(JA.id)
    expect(members, 'supervizorul ales devine membru').toContain(SA.id)

    const { data: phases } = await service.from('project_phases').select('id').eq('project_id', projectId)
    const { data: activities } = await service.from('project_activities').select('name, assigned_to').in('phase_id', (phases ?? []).map(p => p.id))
    const assigned = Object.fromEntries((activities ?? []).map(a => [a.name, a.assigned_to]))
    expect(assigned['Activitate cu implicit anulat'], '„Fără consultant” ales în formular nu e înlocuit de implicit').toBeNull()
    expect(assigned['Activitate fără implicit']).toBe(JA.id)
    expect(assigned['Activitate cu implicit păstrat']).toBe(SA.id)
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})

test('Dosar nou gol, ca admin: fără faze, cu supervizorul în echipă', async ({ browser }) => {
  const title = `Regresii ${STAMP} — dosar gol`
  const { context, page, errors } = await login(browser, ADMIN_LOGIN.email, ADMIN_LOGIN.password)
  try {
    await page.goto('/projects/new')
    await page.getByText(SA.name).first().waitFor({ timeout: 30_000 })
    await page.fill('#dosar-nume', title)
    await page.selectOption('#dosar-beneficiar', clientId)
    await page.getByRole('checkbox', { name: exact(SA.name) }).check()
    await expect(page.getByText(new RegExp(`pentru ${clientLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*fără faze`))).toBeVisible()
    await page.getByRole('button', { name: 'Deschide dosarul' }).click()
    await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/, { timeout: 60_000 })
    const projectId = new URL(page.url()).pathname.split('/').pop()!
    created.projects.add(projectId)
    const { count } = await service.from('project_phases').select('id', { count: 'exact', head: true }).eq('project_id', projectId)
    expect(count).toBe(0)
    expect(await memberIds(projectId)).toEqual([SA.id])
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})

// ─── Editorul de șabloane ────────────────────────────────────────────────────

test('Editor de șabloane, ca senior: salvează un șablon publicat, fără fereastra de propagare', async ({ browser }) => {
  const { context, page, errors } = await login(browser, SA.email, PASSWORD)
  try {
    await page.goto('/admin/templates')
    const strip = page.getByRole('navigation', { name: 'Locație' })
    await expect(strip.getByRole('link', { name: 'Șabloane' }), 'linkul nu duce la panoul adminului').toHaveAttribute('href', '/admin/templates')

    await page.getByRole('button', { name: `Editează șablonul ${TPL_NAME}`, exact: true }).click()
    await page.getByRole('button', { name: 'Adaugă fază nouă' }).click()
    await page.getByLabel('Nume pentru faza 2').fill('Fază adăugată din editor')
    const saved = page.waitForResponse(res => res.url().endsWith(`/api/admin/templates/${TPL}/tree`) && res.request().method() === 'PUT')
    await page.getByRole('button', { name: 'Salvează modificările' }).click()
    expect((await saved).ok()).toBe(true)
    await expect(page.getByText(/Un administrator poate propaga modificările/)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('dialog', { name: /Propagă modificările/ })).toHaveCount(0)

    const { data } = await service.from('project_templates').select('unpropagated_changes_at').eq('id', TPL).single()
    expect(data?.unpropagated_changes_at, 'eticheta pentru admin s-a aprins').not.toBeNull()
    await page.screenshot({ path: path.join(SHOTS, 'editor-senior-salvare.png') })
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})

test('Duplicare din interfață, ca senior: copia apare în listă, ca ciornă', async ({ browser }) => {
  const { context, page, errors } = await login(browser, SA.email, PASSWORD)
  try {
    await page.goto('/admin/templates')
    await page.getByRole('button', { name: `Duplică șablonul ${TPL_NAME}`, exact: true }).click()
    const copy = `${TPL_NAME} (Copie)`
    await expect(page.getByText(copy, { exact: true })).toBeVisible({ timeout: 15_000 })
    const { data } = await service.from('project_templates').select('id, status').eq('name', copy).single()
    if (data) created.templates.add(data.id)
    expect(data?.status).toBe('draft')
    const row = page.getByRole('row').filter({ has: page.getByText(copy, { exact: true }) })
    await expect(row.getByText('Ciornă')).toBeVisible()
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})

test('Șablon ascuns juniorului: deschiderea directă a unui șablon publicat nu intră în editare', async ({ browser }) => {
  const { context, page } = await login(browser, JA.email, PASSWORD)
  try {
    await page.goto(`/admin/templates?edit=${TPL}`)
    await expect(page.getByText(/doar un administrator sau un consultant senior îl poate edita/)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: 'Salvează modificările' })).toHaveCount(0)
  } finally {
    await context.close()
  }
})

// ─── Proiectul, din interfață ────────────────────────────────────────────────

test('Proiect, ca senior: redenumește, oprește reminderele, șterge o fază, adaugă și scoate un junior', async ({ browser }) => {
  const projectId = await newProject(`Regresii ${STAMP} — proiect de senior`)
  await must(admin, 'POST', `/api/projects/${projectId}/members`, { consultant_id: JA.id })
  const phaseId = (await must(admin, 'POST', `/api/projects/${projectId}/phases`, { name: 'Fază de șters din interfață' })).phase.id
  const activityId = (await must(admin, 'POST', `/api/projects/${projectId}/phases/${phaseId}/activities`, { name: 'Activitate cu cerere' })).activity.id
  const requestId = (await must(admin, 'POST', `/api/projects/${projectId}/document-requests`, { name: 'Cerere care rămâne', activity_id: activityId })).id

  const { context, page, errors } = await login(browser, SA.email, PASSWORD)
  try {
    await page.goto(`/projects/${projectId}`)
    await page.getByRole('button', { name: 'Redenumește proiectul' }).click({ timeout: 30_000 })
    const renamed = `Regresii ${STAMP} — redenumit de senior`
    await page.getByLabel('Titlul proiectului').fill(renamed)
    await page.getByRole('button', { name: 'Salvează', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: renamed })).toBeVisible({ timeout: 15_000 })

    await page.locator('[title^="Reminderele automate sunt pornite"]').click()
    await page.getByRole('dialog').getByRole('button', { name: 'Oprește reminderele' }).click()
    await expect.poll(async () => (await service.from('projects').select('automatic_reminders_enabled').eq('id', projectId).single()).data?.automatic_reminders_enabled).toBe(false)

    await page.getByRole('button', { name: 'Acțiuni pentru faza Fază de șters din interfață' }).first().click()
    await page.getByRole('menuitem', { name: /Șterge/ }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Șterge faza' }).click()
    await expect.poll(async () => (await service.from('project_phases').select('id').eq('id', phaseId).maybeSingle()).data).toBeNull()
    const { data: request } = await service.from('document_requirements').select('id, deleted_at').eq('id', requestId).maybeSingle()
    expect(request && !request.deleted_at, 'cererea din faza ștearsă rămâne').toBe(true)

    await page.getByRole('button', { name: /^Echipa proiectului/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Echipa proiectului' })
    await dialog.locator('#echipa-adauga option', { hasText: JB.name }).waitFor({ state: 'attached' })
    await expect(dialog.getByText('Senior', { exact: true }).first(), 'nivelul apare lângă senior').toBeVisible()
    await dialog.locator('#echipa-adauga').selectOption(JB.id)
    await dialog.getByRole('button', { name: 'Adaugă' }).click()
    await expect.poll(async () => (await memberIds(projectId)).includes(JB.id)).toBe(true)
    await dialog.getByRole('button', { name: `Scoate pe ${JB.name} din echipă` }).click()
    await dialog.getByRole('button', { name: 'Scoate din echipă' }).click()
    await expect.poll(async () => (await memberIds(projectId)).includes(JB.id)).toBe(false)
    await page.screenshot({ path: path.join(SHOTS, 'proiect-senior.png') })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: /^Echipa proiectului, 2 membri/ }), 'butonul își actualizează numărul').toBeVisible()
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})

test('Chat, ca junior: își editează propriul mesaj din interfață', async ({ browser }) => {
  const projectId = await newProject(`Regresii ${STAMP} — chat`)
  await must(admin, 'POST', `/api/projects/${projectId}/members`, { consultant_id: JA.id })
  const text = `Mesajul juniorului ${STAMP}`
  const messageId = (await must(JA, 'POST', `/api/projects/${projectId}/chat/messages`, { body: text })).item.id
  const { context, page, errors } = await login(browser, JA.email, PASSWORD)
  try {
    await page.goto(`/projects/${projectId}`)
    await page.getByRole('button', { name: /^Chat/ }).first().click()
    const bubble = page.getByText(text).first()
    await bubble.waitFor({ timeout: 30_000 })
    await bubble.hover()
    await page.getByRole('button', { name: 'Opțiuni mesaj' }).last().click({ force: true })
    await page.getByRole('button', { name: /^Editează$/ }).click()
    // Câmpul de editare stă în bula mesajului, înaintea câmpului de scriere de jos.
    await page.locator('textarea').first().fill(`${text} (corectat)`)
    await page.getByRole('button', { name: 'Salvează', exact: true }).click()
    await expect.poll(async () => (await service.from('project_chat_messages').select('body').eq('id', messageId).single()).data?.body).toBe(`${text} (corectat)`)
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})

test('Proiect, ca client: fără echipă și fără redenumire, pagina se încarcă fără erori', async ({ browser }) => {
  const projectId = await newProject(`Regresii ${STAMP} — văzut de client`)
  const { context, page, errors } = await login(browser, CONFIG.clientEmail, CONFIG.clientPassword)
  try {
    await page.goto(`/projects/${projectId}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: /^Echipa proiectului/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Redenumește proiectul' })).toHaveCount(0)
    const permissions = (await call({ ...admin, token: await signIn(CONFIG.clientEmail, CONFIG.clientPassword) }, 'GET', `/api/projects/${projectId}`)).json.permissions
    expect(Object.values(permissions ?? {}).every(value => value === false), JSON.stringify(permissions)).toBe(true)
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})

// ─── Efecte laterale pe API ──────────────────────────────────────────────────

test('Un senior care nu mai e consultant pierde nivelul; la revenire pornește junior', async () => {
  await must(admin, 'PATCH', `/api/users/${JB.id}`, { consultant_level: 'senior' })
  await must(admin, 'PATCH', `/api/users/${JB.id}`, { role: 'client' })
  const afterRole = (await service.from('profiles').select('role, consultant_level').eq('id', JB.id).single()).data
  expect(afterRole).toEqual({ role: 'client', consultant_level: 'junior' })
  await must(admin, 'PATCH', `/api/users/${JB.id}`, { role: 'consultant' })
  const back = (await service.from('profiles').select('role, consultant_level').eq('id', JB.id).single()).data
  expect(back).toEqual({ role: 'consultant', consultant_level: 'junior' })
})

test('Listele de consultanți poartă nivelul, pentru formular și pentru echipă', async () => {
  const users = (await must(JA, 'GET', '/api/users')).users as Json[]
  expect(users.find(u => u.id === SA.id)?.consultant_level).toBe('senior')
  const projectId = await newProject(`Regresii ${STAMP} — liste`)
  const members = (await must(SA, 'GET', `/api/projects/${projectId}/members`)).members as Json[]
  expect(members.find(m => m.consultant_id === SA.id)?.profiles?.consultant_level).toBe('senior')
})

// ─── Așezare ─────────────────────────────────────────────────────────────────

test('Fâșia de locație: pe desktop acțiunile stau pe un rând și nu ies din ecran', async ({ browser }) => {
  const longTitle = `Regresii ${STAMP} — un titlu de proiect foarte lung, cum apar de obicei la dosarele de finanțare cu nume de program`
  const projectId = await newProject(longTitle)
  const { context, page } = await login(browser, ADMIN_LOGIN.email, ADMIN_LOGIN.password, { width: 1280, height: 900 })
  try {
    for (const [url, wait] of [[`/projects/${projectId}`, /^Echipa proiectului/], ['/admin/users', /Adaugă utilizator/], ['/admin/templates', /Șablon nou/], ['/', null]] as const) {
      await page.goto(url)
      if (wait) await page.getByRole('button', { name: wait }).first().waitFor({ timeout: 30_000 })
      else await page.getByRole('navigation', { name: 'Locație' }).waitFor({ timeout: 30_000 })
      await page.waitForTimeout(500)
      const layout = await page.evaluate(() => {
        const nav = document.querySelector('nav[aria-label="Locație"]')!
        const actions = nav.parentElement!.lastElementChild as HTMLElement
        if (actions === nav) return { rows: 0, clipped: 0 }
        // Rândurile se numără după centrul vertical: butoanele au înălțimi diferite,
        // deci marginea de sus diferă chiar și pe același rând.
        const centers = [...actions.children]
          .map(child => { const r = (child as HTMLElement).getBoundingClientRect(); return r.top + r.height / 2 })
          .sort((a, b) => a - b)
        const rows = centers.reduce((count, center, i) => (i === 0 || center - centers[i - 1] > 12 ? count + 1 : count), 0)
        const clipped = [...actions.querySelectorAll('button, a')].filter(el => el.getBoundingClientRect().right > window.innerWidth).length
        return { rows, clipped }
      })
      expect(layout.clipped, `${url}: acțiuni ieșite din ecran`).toBe(0)
      expect(layout.rows, `${url}: acțiunile s-au rupt pe ${layout.rows} rânduri la 1280px`).toBeLessThanOrEqual(1)
    }
    await page.goto(`/projects/${projectId}`)
    await page.getByRole('button', { name: /^Echipa proiectului/ }).waitFor()
    await page.screenshot({ path: path.join(SHOTS, 'fasie-1280.png'), clip: { x: 0, y: 0, width: 1280, height: 280 } })
  } finally {
    await context.close()
  }
})

test('Paginile de administrare rămân deschise pentru admin', async ({ browser }) => {
  const { context, page, errors } = await login(browser, ADMIN_LOGIN.email, ADMIN_LOGIN.password)
  try {
    for (const url of ['/admin', '/admin/statuses', `/admin/users/${JA.id}`, '/admin/users', '/admin/audit', '/admin/proiecte']) {
      await page.goto(url)
      await page.waitForTimeout(2_000)
      expect(new URL(page.url()).pathname, `${url} nu redirecționează adminul`).toBe(url)
    }
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})
