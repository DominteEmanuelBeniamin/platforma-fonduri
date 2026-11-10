import { randomUUID } from 'node:crypto'
import { test, expect, type Browser, type BrowserContextOptions, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { finalizeLocalFixture } from '../../scripts/local-account-fixtures.mjs'
import {
  createTemporaryProject,
  destroyTemporaryProject,
  e2eEnv,
  requireE2EConfig,
  serviceClient,
  verifyServerUsesFixture,
  type TemporaryProjectFixture,
} from './helpers/project-state'

const ENV = e2eEnv()
const CONFIG = requireE2EConfig(ENV)
const service = serviceClient()!
const BUCKET = 'project-internal'
const STAMP = randomUUID().slice(0, 8)
const PASSWORD = `Dosar-${STAMP}-2026!`
const LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(CONFIG.supabaseUrl).hostname)

type Session = { access_token: string; refresh_token: string; token_type: string; expires_in: number; expires_at?: number; user: { id: string } }
type Person = { id: string; email: string; password: string; token: string; session: Session; label: string }
type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Fixture = { project: TemporaryProjectFixture; title: string }

let admin: Person
let senior: Person
let junior: Person
let outsider: Person
let client: Person
let own: Fixture
let foreign: Fixture
let juniorEntry = ''
let seniorEntry = ''
let adminEntry = ''
let uploadedAttachment = ''
const people: Person[] = []

test.describe('Dosar intern — acces, atașamente și citire în proiect încheiat', () => {
  test.skip(!LOCAL, 'Fixture-urile E2E pentru acest flux cer Supabase local.')
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(180_000)
  test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 })

  async function call(who: Person | null, method: string, path: string, body?: unknown) {
    const response = await fetch(CONFIG.baseUrl + path, {
      method,
      headers: {
        ...(who ? { Authorization: `Bearer ${who.token}` } : {}),
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, json: await response.json().catch(() => ({})) as Json }
  }

  async function must(who: Person, method: string, path: string, body?: unknown) {
    const result = await call(who, method, path, body)
    expect(result.status, `${method} ${path}: ${JSON.stringify(result.json).slice(0, 300)}`).toBeLessThan(300)
    return result.json
  }

  async function person(role: 'client' | 'consultant', label: string, level?: 'junior' | 'senior'): Promise<Person> {
    const email = `dosar.${STAMP}.${label}@example.invalid`
    const { data, error } = await service.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
    if (error || !data.user) throw new Error(`Nu am putut crea fixture-ul ${label}: ${error?.message}`)
    await finalizeLocalFixture(service, data.user.id, {
      role,
      ...(role === 'consultant' ? { consultant_level: level } : {}),
      full_name: `Dosar intern ${label}`,
    })
    const anon = createClient(CONFIG.supabaseUrl, CONFIG.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const login = await anon.auth.signInWithPassword({ email, password: PASSWORD })
    if (login.error || !login.data.session) throw new Error(`Nu am putut autentifica fixture-ul ${label}`)
    const result = { id: data.user.id, email, password: PASSWORD, token: login.data.session.access_token, session: login.data.session, label }
    people.push(result)
    return result
  }

  async function existingAdmin(): Promise<Person> {
    const anon = createClient(CONFIG.supabaseUrl, CONFIG.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const login = await anon.auth.signInWithPassword({ email: CONFIG.staffEmail, password: CONFIG.staffPassword })
    if (login.error || !login.data.session) throw new Error(`Autentificare admin eșuată: ${login.error?.message}`)
    const profile = await service.from('profiles').select('id, role').eq('email', CONFIG.staffEmail).single()
    if (profile.error || profile.data.role !== 'admin') throw new Error('E2E_STAFF_EMAIL trebuie să fie administrator')
    return { id: profile.data.id, email: CONFIG.staffEmail, password: CONFIG.staffPassword, token: login.data.session.access_token, session: login.data.session, label: 'admin' }
  }

  async function createFixture(title: string): Promise<Fixture> {
    const project = await createTemporaryProject(service, { clientEmail: client.email, staffEmail: senior.email })
    const result = await service.from('projects').update({ title: `Dosar ${STAMP} — ${title}` }).eq('id', project.projectId)
    if (result.error) throw new Error(`Redenumire proiect fixture: ${result.error.message}`)
    return { project, title: `Dosar ${STAMP} — ${title}` }
  }

  async function authenticatedPage(browser: Browser, who: Person, options: BrowserContextOptions = {}) {
    const context = await browser.newContext({ baseURL: CONFIG.baseUrl, ...options })
    await context.addInitScript(session => {
      localStorage.setItem('sb-127-auth-token', JSON.stringify(session))
    }, who.session)
    const page = await context.newPage()
    return { context, page }
  }

  async function waitForProject(page: Page, title: string) {
    await expect(page.getByRole('navigation', { name: 'Locație' }).getByText(title, { exact: true }))
      .toBeVisible({ timeout: 20_000 })
  }

  test.beforeAll(async () => {
    admin = await existingAdmin()
    client = await person('client', 'client')
    senior = await person('consultant', 'senior', 'senior')
    junior = await person('consultant', 'junior', 'junior')
    outsider = await person('consultant', 'outsider', 'senior')
    own = await createFixture('propriu')
    await verifyServerUsesFixture(CONFIG, own.project.projectId)
    const member = await service.from('project_members').insert({
      project_id: own.project.projectId,
      consultant_id: junior.id,
      role_in_project: 'member',
    })
    if (member.error) throw new Error(`Adăugarea juniorului în fixture: ${member.error.message}`)
    foreign = await createFixture('străin')
  })

  test.afterAll(async () => {
    for (const fixture of [own, foreign]) {
      if (!fixture || !service) continue
      const project = await service.from('projects').select('lifecycle_status').eq('id', fixture.project.projectId).maybeSingle()
      if (project.error) throw new Error(`Citirea stării proiectului pentru curățenie: ${project.error.message}`)
      if (project.data?.lifecycle_status === 'active') {
        const closed = await call(admin, 'POST', `/api/projects/${fixture.project.projectId}/close`)
        if (closed.status !== 200) throw new Error(`Închiderea proiectului fixture pentru curățenie: HTTP ${closed.status}`)
      }
      const entries = await service.from('project_internal_entries').select('id').eq('project_id', fixture.project.projectId)
      if (entries.error) throw new Error(`Citirea dosarului pentru curățenie: ${entries.error.message}`)
      const entryIds = (entries.data ?? []).map(row => row.id)
      if (entryIds.length) {
        const attachments = await service.from('project_internal_attachments').select('storage_path').in('entry_id', entryIds)
        if (attachments.error) throw new Error(`Citirea atașamentelor pentru curățenie: ${attachments.error.message}`)
        const paths = (attachments.data ?? []).map(row => row.storage_path).filter(Boolean)
        if (paths.length) {
          const removed = await service.storage.from(BUCKET).remove(paths)
          if (removed.error) throw new Error(`Ștergerea obiectelor temporare: ${removed.error.message}`)
        }
        const removedAttachments = await service.from('project_internal_attachments').delete().in('entry_id', entryIds)
        if (removedAttachments.error) throw new Error(`Ștergerea atașamentelor fixture: ${removedAttachments.error.message}`)
      }
      const removedEntries = await service.from('project_internal_entries').delete().eq('project_id', fixture.project.projectId)
      if (removedEntries.error) throw new Error(`Ștergerea intrărilor fixture: ${removedEntries.error.message}`)
      await destroyTemporaryProject(service, fixture.project)
    }
    for (const account of people) await service.auth.admin.deleteUser(account.id)
  })

  test('adminul și membrii creează și citesc; autorul, seniorul și adminul au drepturile de editare potrivite', async () => {
    const base = `/api/projects/${own.project.projectId}/internal-entries`
    expect((await call(null, 'GET', base)).status).toBe(401)
    expect((await must(admin, 'GET', base)).entries).toEqual([])

    juniorEntry = (await must(junior, 'POST', base, {
      title: 'Nota juniorului', body: 'Observație de lucru', activity_id: own.project.activityId,
    })).entry.id
    seniorEntry = (await must(senior, 'POST', base, { title: 'Nota seniorului', body: 'Context general' })).entry.id
    adminEntry = (await must(admin, 'POST', base, { title: 'Nota adminului', phase_id: own.project.phaseId })).entry.id

    for (const member of [admin, senior, junior]) {
      const list = await must(member, 'GET', base)
      expect(list.entries.map((entry: Json) => entry.id)).toEqual(expect.arrayContaining([juniorEntry, seniorEntry, adminEntry]))
    }
    expect((await must(junior, 'GET', base)).entries.find((entry: Json) => entry.id === juniorEntry).context)
      .toMatchObject({ type: 'activity', id: own.project.activityId })
    for (const blocked of [client, outsider]) {
      expect((await call(blocked, 'GET', base)).status).toBe(403)
      expect((await call(blocked, 'POST', base, { title: 'Nu trebuie să intre' })).status).toBe(403)
    }

    expect((await call(junior, 'PATCH', `${base}/${adminEntry}`, { title: 'Nu e autor' })).status).toBe(403)
    expect((await must(admin, 'PATCH', `${base}/${juniorEntry}`, { title: 'Nota juniorului — corectată' })).entry.title)
      .toBe('Nota juniorului — corectată')
    expect((await must(junior, 'PATCH', `${base}/${juniorEntry}`, { body: 'Autorul poate corecta' })).entry.body)
      .toBe('Autorul poate corecta')
    expect((await must(senior, 'PATCH', `${base}/${adminEntry}`, { title: 'Nota adminului — revizuită' })).entry.title)
      .toBe('Nota adminului — revizuită')
    expect((await call(junior, 'DELETE', `${base}/${adminEntry}`)).status).toBe(403)
    expect((await call(senior, 'DELETE', `${base}/${adminEntry}`)).status).toBe(204)
    expect((await call(admin, 'DELETE', `${base}/${seniorEntry}`)).status).toBe(204)

    const afterDelete = await must(admin, 'GET', base)
    expect(afterDelete.entries.map((entry: Json) => entry.id)).not.toEqual(expect.arrayContaining([adminEntry, seniorEntry]))
    const deleted = await service.from('project_internal_entries').select('deleted_at, deleted_by').eq('id', adminEntry).single()
    expect(deleted.error).toBeNull()
    if (!deleted.data) throw new Error('Intrarea retrasă nu mai există pentru verificarea soft delete')
    expect(deleted.data.deleted_at).toBeTruthy()
    expect(deleted.data.deleted_by).toBe(senior.id)

    expect((await call(junior, 'POST', base, { title: 'Context din alt proiect', phase_id: foreign.project.phaseId })).status)
      .toBe(400)
    expect((await call(junior, 'POST', base, {
      title: 'Două contexte', phase_id: own.project.phaseId, activity_id: own.project.activityId,
    })).status).toBe(400)
  })

  test('atașamentele se încarcă și se descarcă prin rute semnate, iar Storage direct refuză clientul', async () => {
    const base = `/api/projects/${own.project.projectId}/internal-entries/${juniorEntry}`
    const bytes = Buffer.from('%PDF-1.4\nDosar intern E2E\n%%EOF\n')
    const init = await must(junior, 'POST', `${base}/attachments/init`, {
      originalName: 'nota-interna.pdf', mimeType: 'application/pdf', fileSize: bytes.length,
    })
    uploadedAttachment = init.attachmentId
    const upload = await fetch(init.uploadUrl, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${init.token}`, 'Content-Type': 'application/pdf' },
      body: bytes,
    })
    expect(upload.status, await upload.text().catch(() => '')).toBeLessThan(300)
    const complete = await must(junior, 'POST', `${base}/attachments/complete`, { attachmentId: uploadedAttachment })
    expect(complete.attachment).toMatchObject({ id: uploadedAttachment, original_name: 'nota-interna.pdf' })
    expect(complete.attachment).not.toHaveProperty('storage_path')

    for (const member of [admin, senior, junior]) {
      const download = await must(member, 'POST', `${base}/attachments/${uploadedAttachment}/signed-download`, {})
      const downloaded = await fetch(download.url)
      expect(downloaded.status, `${member.label} poate descărca atașamentul`).toBe(200)
      expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(bytes)
    }
    for (const blocked of [client, outsider]) {
      expect((await call(blocked, 'POST', `${base}/attachments/${uploadedAttachment}/signed-download`, {})).status).toBe(403)
    }
    expect((await call(junior, 'POST', `${base}/attachments/${randomUUID()}/signed-download`, {})).status).toBe(404)
    expect((await call(junior, 'POST', `${base}/attachments/init`, {
      originalName: 'cale-falsă.pdf', mimeType: 'application/pdf', fileSize: 26, storagePath: 'arbitrary/path.pdf',
    })).status).toBe(400)
    expect((await call(junior, 'POST', `${base}/attachments/complete`, {
      attachmentId: randomUUID(), storagePath: 'arbitrary/path.pdf',
    })).status).toBe(400)
    expect((await call(junior, 'POST', `${base}/attachments/complete`, { attachmentId: randomUUID() })).status).toBe(404)

    const row = await service.from('project_internal_attachments').select('storage_path').eq('id', uploadedAttachment).single()
    expect(row.error).toBeNull()
    if (!row.data) throw new Error('Lipsește rândul atașamentului pentru proba Storage directă')
    const direct = createClient(CONFIG.supabaseUrl, CONFIG.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${client.token}` } },
    })
    const directRead = await direct.storage.from(BUCKET).download(row.data.storage_path)
    expect(directRead.error, 'clientul nu poate citi obiectul Storage direct').toBeTruthy()
    const directWrite = await direct.storage.from(BUCKET).upload(`${own.project.projectId}/${randomUUID()}.pdf`, Buffer.from('client'), {
      contentType: 'application/pdf',
    })
    expect(directWrite.error, 'clientul nu poate încărca direct în bucketul intern').toBeTruthy()
    const directTable = await direct.from('project_internal_entries').select('id').eq('project_id', own.project.projectId)
    expect(directTable.error, 'clientul nu poate citi tabelul direct').toBeTruthy()
  })

  test('tabul este disponibil echipei, nu clientului; formularul adaugă o notă', async ({ browser }) => {
    const base = `/api/projects/${own.project.projectId}/internal-entries`
    await must(junior, 'POST', base, { title: 'Raport pentru fază', phase_id: own.project.phaseId })
    await must(junior, 'POST', base, { title: 'Raport pentru cerere', document_requirement_id: own.project.requestId })
    const { context: emptyContext, page: emptyPage } = await authenticatedPage(browser, senior)
    await emptyPage.goto(`/projects/${foreign.project.projectId}?view=internal`)
    await waitForProject(emptyPage, foreign.title)
    await expect(emptyPage.getByRole('button', { name: 'Dosar intern' })).toBeVisible({ timeout: 20_000 })
    await expect(emptyPage.getByText('Dosarul intern este gol', { exact: true })).toBeVisible({ timeout: 20_000 })
    await emptyContext.close()

    const { context: staffContext, page: staffPage } = await authenticatedPage(browser, junior)
    await staffPage.goto(`/projects/${own.project.projectId}?view=internal`)
    await waitForProject(staffPage, own.title)
    const internalTab = staffPage.getByRole('button', { name: 'Dosar intern' })
    await expect(internalTab).toBeVisible({ timeout: 20_000 })
    await expect(staffPage.locator('summary').filter({ hasText: 'Fază: Fază E2E' }).first()).toContainText('3 rapoarte')
    const activityGroup = staffPage.locator('summary').filter({ hasText: /^Activitate: Activitate E2E/ }).locator('..')
    await expect(activityGroup).not.toHaveAttribute('open', '')
    await expect(staffPage.getByText('Raport pentru fază', { exact: true })).toBeVisible()
    await activityGroup.locator('summary').first().click()
    await expect(staffPage.getByText('Raport pentru cerere', { exact: true })).toBeVisible()
    await expect(staffPage.getByText('Nota juniorului — corectată', { exact: true })).toBeVisible({ timeout: 20_000 })
    const existingEntry = staffPage.locator('li').filter({ hasText: 'Nota juniorului — corectată' }).first()
    await expect(existingEntry.locator('details')).not.toHaveAttribute('open', '')
    await expect(existingEntry.getByText(/Fază:.*Activitate:/)).toBeVisible()
    await expect(existingEntry.getByText(/Dosar intern junior/)).toBeVisible()
    await activityGroup.locator('summary').first().click()
    await staffPage.getByLabel('Caută în dosarul intern').fill('Raport pentru cerere')
    await expect(staffPage.getByText('Raport pentru cerere', { exact: true })).toBeVisible()
    await staffPage.getByLabel('Caută în dosarul intern').clear()
    await staffPage.getByRole('button', { name: 'Adaugă în dosar' }).first().click()
    const createDialog = staffPage.getByRole('dialog', { name: 'Adaugă în dosar' })
    await expect(createDialog).toBeVisible()
    await staffPage.getByLabel('Titlu').fill('Notă creată din browser')
    await staffPage.getByLabel('Notă').fill(`Text adăugat prin interfață. ${'Conținut lung. '.repeat(40)}Finalul ascuns.`)
    await staffPage.keyboard.press('Escape')
    await expect(staffPage.getByRole('dialog', { name: 'Renunți la modificările nesalvate?' })).toBeVisible()
    await staffPage.getByRole('button', { name: 'Anulează', exact: true }).click()
    await expect(createDialog.getByLabel('Titlu')).toHaveValue('Notă creată din browser')
    await staffPage.getByRole('button', { name: 'Adaugă în dosar' }).last().click()
    await expect(staffPage.getByText('Notă creată din browser', { exact: true })).toBeVisible({ timeout: 20_000 })
    await staffPage.getByLabel('Caută în dosarul intern').fill('Notă creată din browser')
    await expect(staffPage.getByText('Nota juniorului — corectată', { exact: true })).toHaveCount(0)
    await staffPage.getByText('Notă creată din browser', { exact: true }).click()
    await expect(staffPage.getByText('Text adăugat prin interfață.')).toBeVisible()
    await expect(staffPage.getByText('Finalul ascuns.')).toHaveCount(0)
    await staffPage.getByRole('button', { name: 'Citește toată nota' }).click()
    await expect(staffPage.getByText('Finalul ascuns.')).toBeVisible()
    await staffPage.getByRole('button', { name: 'Restrânge nota' }).click()
    await staffPage.getByLabel('Caută în dosarul intern').fill('finalul ascuns')
    await expect(staffPage.locator('summary mark').filter({ hasText: 'Finalul' })).toBeVisible()
    await staffPage.getByRole('button', { name: /^Documente/ }).click()
    await expect(staffPage.getByText('nota-interna.pdf', { exact: false })).toBeVisible()
    await staffPage.getByRole('button', { name: 'Caută în proiect' }).click()
    await staffPage.getByPlaceholder('Caută faze, activități, cereri de documente...').fill('Notă creată din browser')
    await staffPage.getByRole('button', { name: /Notă creată din browser/ }).click()
    await expect(staffPage.getByText('Text adăugat prin interfață.')).toBeVisible()
    await staffContext.close()

    const { context: phoneContext, page: phonePage } = await authenticatedPage(browser, junior, {
      viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
    })
    await phonePage.goto(`/projects/${own.project.projectId}?view=internal`)
    await waitForProject(phonePage, own.title)
    await expect(phonePage.getByRole('button', { name: 'Dosar intern' })).toBeVisible({ timeout: 20_000 })
    await expect(phonePage.getByText('Notă creată din browser', { exact: true })).toBeVisible({ timeout: 20_000 })
    const phoneWidth = await phonePage.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }))
    expect(phoneWidth.scroll, `overflow în lista de telefon: ${JSON.stringify(phoneWidth)}`).toBeLessThanOrEqual(phoneWidth.viewport)
    await phonePage.getByRole('button', { name: 'Adaugă în dosar' }).click()
    await phonePage.getByLabel('Titlu').fill('Notă creată pe telefon')
    await phonePage.getByLabel('Notă (opțional)').fill('Formularul încape și se poate folosi pe telefon.')
    await expect(phonePage.getByLabel('Context asociat (opțional)')).toBeVisible()
    await expect(phonePage.getByText('Atașează fișiere', { exact: true })).toBeVisible()
    const formWidth = await phonePage.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }))
    expect(formWidth.scroll, `overflow în formularul de telefon: ${JSON.stringify(formWidth)}`).toBeLessThanOrEqual(formWidth.viewport)
    await phonePage.getByRole('button', { name: 'Adaugă în dosar' }).click()
    await expect(phonePage.getByText('Notă creată pe telefon', { exact: true })).toBeVisible({ timeout: 20_000 })
    await phoneContext.close()

    const { context: clientContext, page: clientPage } = await authenticatedPage(browser, client)
    const internalRequests: string[] = []
    clientPage.on('request', request => {
      if (new URL(request.url()).pathname.includes('/internal-entries')) internalRequests.push(request.url())
    })
    await clientPage.goto(`/projects/${own.project.projectId}?view=internal`)
    await waitForProject(clientPage, own.title)
    await expect(clientPage.getByRole('button', { name: 'Dosar intern' })).toHaveCount(0)
    expect(internalRequests).toEqual([])
    await clientContext.close()
  })

  test('atașamentele pot fi retrase doar de managerii autorizați', async ({ browser }) => {
    const base = `/api/projects/${own.project.projectId}/internal-entries/${juniorEntry}/attachments`
    const createAttachment = async (name: string) => {
      const bytes = Buffer.from('%PDF-1.4\nTest\n%%EOF')
      const init = await must(junior, 'POST', `${base}/init`, { originalName: name, mimeType: 'application/pdf', fileSize: bytes.length })
      const uploaded = await fetch(init.uploadUrl, { method: 'PUT', headers: { Authorization: `Bearer ${init.token}`, 'Content-Type': 'application/pdf' }, body: bytes })
      expect(uploaded.status).toBeLessThan(300)
      await must(junior, 'POST', `${base}/complete`, { attachmentId: init.attachmentId })
      return init.attachmentId as string
    }
    const first = await createAttachment('de-retras-admin.pdf')
    for (const blocked of [junior, client, outsider]) {
      expect((await call(blocked, 'DELETE', `${base}/${first}`)).status).toBe(403)
    }
    expect((await call(admin, 'DELETE', `/api/projects/${foreign.project.projectId}/internal-entries/${juniorEntry}/attachments/${first}`)).status).toBe(404)
    expect((await call(admin, 'DELETE', `${base}/${first}`)).status).toBe(204)
    expect((await call(senior, 'POST', `${base}/${first}/signed-download`, {})).status).toBe(404)
    expect((await must(senior, 'GET', `/api/projects/${own.project.projectId}/internal-entries`)).entries.find((entry: Json) => entry.id === juniorEntry).attachments.some((file: Json) => file.id === first)).toBe(false)

    const second = await createAttachment('de-retras-senior.pdf')
    const { context, page } = await authenticatedPage(browser, senior)
    await page.goto(`/projects/${own.project.projectId}?view=internal`)
    await waitForProject(page, own.title)
    await page.locator('summary').filter({ hasText: /^Activitate: Activitate E2E/ }).click()
    await page.getByRole('button', { name: 'Acțiuni pentru Nota juniorului — corectată' }).click()
    await page.getByRole('menuitem', { name: 'Editează' }).click()
    await expect(page.getByRole('dialog', { name: 'Editează înregistrarea' })).toBeVisible()
    await page.getByRole('button', { name: 'Retrage fișierul de-retras-senior.pdf' }).click()
    await page.getByRole('button', { name: 'Retrage fișierul', exact: true }).click()
    await expect(page.getByText('Fișierul a fost retras.')).toBeVisible()
    await expect(page.getByText('de-retras-senior.pdf')).toHaveCount(0)
    expect((await call(senior, 'POST', `${base}/${second}/signed-download`, {})).status).toBe(404)
    await context.close()
  })

  test('proiectul încheiat rămâne consultabil, dar API-ul și interfața sunt read-only', async ({ browser }) => {
    const base = `/api/projects/${own.project.projectId}/internal-entries`
    const bytes = Buffer.from('%PDF-1.4\nîncheiere\n%%EOF\n')
    const pending = await must(junior, 'POST', `${base}/${juniorEntry}/attachments/init`, {
      originalName: 'nefinalizat.pdf', mimeType: 'application/pdf', fileSize: bytes.length,
    })
    const uploaded = await fetch(pending.uploadUrl, {
      method: 'PUT', headers: { Authorization: `Bearer ${pending.token}`, 'Content-Type': 'application/pdf' }, body: bytes,
    })
    expect(uploaded.status).toBeLessThan(300)
    expect((await call(admin, 'POST', `/api/projects/${own.project.projectId}/close`)).status).toBe(200)

    for (const member of [admin, senior, junior]) {
      expect((await must(member, 'GET', base)).entries.some((entry: Json) => entry.id === juniorEntry)).toBe(true)
      expect((await call(member, 'POST', base, { title: 'Scriere după încheiere' })).status).toBe(409)
      expect((await call(member, 'PATCH', `${base}/${juniorEntry}`, { title: 'Editare după încheiere' })).status).toBe(409)
      expect((await call(member, 'DELETE', `${base}/${juniorEntry}`)).status).toBe(409)
      expect((await call(member, 'DELETE', `${base}/${juniorEntry}/attachments/${uploadedAttachment}`)).status).toBe(409)
      expect((await call(member, 'POST', `${base}/${juniorEntry}/attachments/init`, {
        originalName: 'altul.pdf', mimeType: 'application/pdf', fileSize: Buffer.byteLength('altul'),
      })).status).toBe(409)
    }
    expect((await call(junior, 'POST', `${base}/${juniorEntry}/attachments/complete`, { attachmentId: pending.attachmentId })).status)
      .toBe(409)
    const closedDownload = await must(senior, 'POST', `${base}/${juniorEntry}/attachments/${uploadedAttachment}/signed-download`, {})
    const closedFile = await fetch(closedDownload.url)
    expect(closedFile.status).toBe(200)
    expect(Buffer.from(await closedFile.arrayBuffer())).toEqual(Buffer.from('%PDF-1.4\nDosar intern E2E\n%%EOF\n'))

    const { context, page } = await authenticatedPage(browser, senior)
    await page.goto(`/projects/${own.project.projectId}?view=internal`)
    await waitForProject(page, own.title)
    await expect(page.getByText('Notă creată din browser', { exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('button', { name: 'Adaugă în dosar' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Editează' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Retrage' })).toHaveCount(0)
    await context.close()
  })
})
