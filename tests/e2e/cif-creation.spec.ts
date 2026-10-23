import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { fixtureCif } from '../../scripts/local-account-fixtures.mjs'
import { e2eEnv, requireE2EConfig, serviceClient } from './helpers/project-state'

const env = e2eEnv(), config = requireE2EConfig(env), service = serviceClient()!
if (!/^issue110_phase5_[a-f0-9]{12}$/.test(env.E2E_DB_NAME || '')) throw new Error('CIF acceptance requires the disposable phase 5 environment')
let token: string
const email = () => 'phase5.' + randomUUID() + '@example.invalid'
const input = (role = 'client') => ({ email: email(), fullName: 'Recepție CIF', role, ...(role === 'client' ? { cif: fixtureCif(randomUUID()), cifCountry: 'RO' } : {}) })
const messages = () => fs.readFileSync(env.E2E_RESEND_LOG, 'utf8').trim().split('\n').map(line => JSON.parse(line))
async function api(method: string, path: string, body?: unknown) {
  const response = await fetch(config.baseUrl + path, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
  return { status: response.status, body: await response.json() }
}
test.beforeAll(async () => {
  const auth = createClient(config.supabaseUrl, config.anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const login = await auth.auth.signInWithPassword({ email: config.staffEmail, password: config.staffPassword })
  expect(login.error).toBeNull(); token = login.data.session!.access_token
  expect((await api('GET', '/api/me')).body.profile.role).toBe('admin')
})
test('real HTTP creates every role, completes activation and sends only confirmed credentials', async () => {
  for (const role of ['client', 'consultant', 'admin']) {
    const body = input(role), result = await api('POST', '/api/users', body)
    expect(result.status, result.body.code).toBe(201)
    expect(result.body.emailSent).toBe(true)
    const profile = await service.from('profiles').select('id,role,cif,creation_pending,is_active,must_change_password').eq('email', body.email).single()
    expect(profile.error).toBeNull()
    expect(profile.data).toMatchObject({ role, creation_pending: false, is_active: true, must_change_password: true, cif: role === 'client' ? body.cif : null })
    expect((await service.auth.admin.getUserById(profile.data!.id)).data.user!.banned_until).toBeFalsy()
    const message = messages().find(row => row.body?.text?.includes('Adresa de email: ' + body.email))
    const temporaryPassword = message?.body.text.match(/Parola temporară: ([^\n]+)/)?.[1]
    expect(Boolean(temporaryPassword)).toBe(true)
    const auth = createClient(config.supabaseUrl, config.anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
    expect((await auth.auth.signInWithPassword({ email: body.email, password: temporaryPassword! })).error).toBeNull()
    expect((await auth.rpc('current_account_session_active')).data).toBe(true)
    const audit = await service.from('audit_logs').select('old_values,new_values').eq('entity_id', profile.data!.id)
    expect(audit.error).toBeNull()
    expect(JSON.stringify(audit.data).includes(temporaryPassword!)).toBe(false)
  }
})
test('recovery resets a finalized client and keeps pending accounts blocked without email', async () => {
  const body = input()
  expect((await api('POST', '/api/users', body)).status).toBe(201)
  const profile = (await service.from('profiles').select('id').eq('email', body.email).single()).data!
  const recoveryBase = env.E2E_RECOVERY_BASE_URL
  expect(Boolean(recoveryBase)).toBe(true)
  const post = (path: string, payload: unknown, cookie?: string) => fetch(recoveryBase + path, {
    method: 'POST', headers: { Origin: recoveryBase, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(payload),
  })
  expect((await post('/api/auth/recovery/request', { email: body.email })).status).toBe(200)
  await expect.poll(() => messages().some(row => row.body?.text?.includes('Acest mesaj privește contul ' + body.email)), { timeout: 15000 }).toBe(true)
  const message = messages().find(row => row.body?.text?.includes('Acest mesaj privește contul ' + body.email))
  const link = message.body.text.match(/http[^\s]+\/reset-password#token=[^\s]+/)![0]
  const proof = new URLSearchParams(new URL(link).hash.slice(1)).get('token')!
  const exchange = await post('/api/auth/recovery/exchange', { token: proof })
  expect(exchange.status).toBe(200)
  const cookie = exchange.headers.get('set-cookie')!.split(';')[0]
  const password = 'Recovered-' + randomUUID() + '!'
  const completed = await post('/api/auth/recovery/complete', { flowId: proof.split('.')[0], attemptId: randomUUID(), password, confirmation: password }, cookie)
  expect((await completed.json()).status).toBe('completed')
  const auth = createClient(config.supabaseUrl, config.anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  expect((await auth.auth.signInWithPassword({ email: body.email, password })).error).toBeNull()
  expect((await service.from('profiles').select('cif,must_change_password,creation_pending').eq('id', profile.id).single()).data)
    .toMatchObject({ cif: body.cif, must_change_password: false, creation_pending: false })
  const pendingEmail = email(), pendingPassword = 'Pending-' + randomUUID()
  const pending = await service.auth.admin.createUser({ email: pendingEmail, password: pendingPassword, email_confirm: true, ban_duration: '87600h' })
  expect(pending.error).toBeNull()
  expect((await post('/api/auth/recovery/request', { email: pendingEmail })).status).toBe(200)
  const dispatch = await fetch(recoveryBase + '/api/auth/recovery/dispatch', { headers: { Authorization: 'Bearer ' + env.E2E_CRON_SECRET } })
  expect(dispatch.status).toBe(200)
  expect(messages().some(row => row.body?.text?.includes(pendingEmail))).toBe(false)
  expect((await auth.auth.signInWithPassword({ email: pendingEmail, password: pendingPassword })).error).not.toBeNull()
  expect((await api('POST', '/api/users/' + pending.data.user!.id + '/reactivate')).body.code).toBe('ACCOUNT_CREATION_PENDING')
})
test('inactive and historical CIFs stay reserved; create and edit races have exactly one winner', async () => {
  const first = input(), created = await api('POST', '/api/users', first)
  expect(created.status).toBe(201)
  const owner = (await service.from('profiles').select('id').eq('email', first.email).single()).data!
  expect((await api('POST', '/api/users/' + owner.id + '/deactivate')).status).toBe(200)
  expect((await api('POST', '/api/users', { ...input(), cif: first.cif })).body.code).toBe('CIF_DUPLICATE')
  expect((await api('POST', '/api/users/' + owner.id + '/reactivate')).status).toBe(200)
  expect((await api('PATCH', '/api/users/' + owner.id, { role: 'consultant' })).status).toBe(200)
  expect((await api('POST', '/api/users', { ...input(), cif: first.cif })).body.code).toBe('CIF_DUPLICATE')
  const shared = fixtureCif(randomUUID())
  const race = await Promise.all([api('POST', '/api/users', { ...input(), cif: shared }), api('POST', '/api/users', { ...input(), cif: shared })])
  expect(race.map(result => result.status).sort()).toEqual([201, 409])
  expect(race.find(result => result.status === 409)!.body.code).toBe('CIF_DUPLICATE')
  const second = input()
  expect((await api('POST', '/api/users', second)).status).toBe(201)
  const target = (await service.from('profiles').select('id').eq('email', second.email).single()).data!
  const next = fixtureCif(randomUUID())
  const mixed = await Promise.all([api('POST', '/api/users', { ...input(), cif: next }), api('PATCH', '/api/users/' + target.id, { cif: next, cifCountry: 'RO' })])
  expect(mixed.map(result => result.status).sort((a, b) => a - b)).toEqual(expect.arrayContaining([409]))
  expect(mixed.filter(result => result.status < 300)).toHaveLength(1)
})
async function login(page: Page) {
  await page.goto('/login')
  const password = page.locator('input[autocomplete=current-password]')
  await expect(async () => {
    if (await password.getAttribute('type') === 'password') await page.getByRole('button', { name: 'Arată parola', exact: true }).click()
    await expect(password).toHaveAttribute('type', 'text', { timeout: 1000 })
  }).toPass({ timeout: 15000 })
  await page.getByRole('button', { name: 'Ascunde parola', exact: true }).click()
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(config.staffEmail)
  await password.fill(config.staffPassword)
  await page.getByRole('button', { name: 'Intră în cont', exact: true }).click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'))
  await page.goto('/admin/users')
}
for (const width of [1440, 390]) test(`real browser at ${width}px creates a client and preserves the form after duplicate refusal`, async ({ page }) => {
  test.setTimeout(120000)
  await page.setViewportSize({ width, height: 900 }); await login(page)
  const body = input()
  const fill = async (address: string) => {
    await page.getByRole('button', { name: 'Adaugă utilizator', exact: true }).click()
    const form = page.getByRole('dialog', { name: 'Adaugă utilizator', exact: true })
    await form.getByRole('textbox', { name: 'Email', exact: true }).fill(address)
    await form.getByRole('textbox', { name: 'Nume complet', exact: true }).fill(body.fullName)
    await form.getByRole('textbox', { name: 'Nume firmă', exact: true }).fill('Firmă sintetică')
    await form.getByRole('textbox', { name: 'CUI / CIF' }).fill(body.cif!)
    return form
  }
  const form = await fill(body.email)
  await form.getByRole('button', { name: 'Creează', exact: true }).click()
  await expect(form).toHaveCount(0)
  const saved = await service.from('profiles').select('cif,creation_pending,is_active').eq('email', body.email).single()
  expect(saved.data).toMatchObject({ cif: body.cif, creation_pending: false, is_active: true })
  const anotherEmail = email(), duplicate = await fill(anotherEmail)
  await duplicate.getByRole('button', { name: 'Creează', exact: true }).click()
  await expect(duplicate.getByRole('alert')).toHaveText('Firma are deja un cont. Nu poți folosi același CIF.')
  await expect(duplicate.getByRole('textbox', { name: 'CUI / CIF' })).toBeFocused()
  await expect(duplicate.getByRole('textbox', { name: 'Email', exact: true })).toHaveValue(anotherEmail)
  expect((await service.from('profiles').select('id').eq('email', anotherEmail)).data).toEqual([])
  expect(await page.evaluate(() => document.body.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: `playwright-report/issue110-phase5/cif-${width}.png`, fullPage: true })
})
