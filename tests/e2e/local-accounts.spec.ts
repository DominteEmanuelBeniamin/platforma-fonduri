import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { assertLocalStack, fixtureCif } from '../../scripts/local-account-fixtures.mjs'
import { e2eEnv, requireE2EConfig, serviceClient } from './helpers/project-state'

const env = e2eEnv(), config = requireE2EConfig(env), service = serviceClient()!
assertLocalStack({ SUPABASE_URL: config.supabaseUrl, NEXT_PUBLIC_SUPABASE_URL: config.supabaseUrl })
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.baseUrl).hostname)) throw new Error('Local account smoke requires a local app')
const mailLog = path.resolve('playwright-report/local-mail/resend.jsonl')
const ids = new Set<string>()
let token: string
const email = () => 'local-smoke.' + randomUUID() + '@example.invalid'
const input = (role = 'client') => ({ email: email(), fullName: 'Cont local de verificare', role,
  ...(role === 'client' ? { cif: fixtureCif(randomUUID()), cifCountry: 'RO', numeFirma: 'Firmă de test', adresaFirma: 'Str. Test 1' } : {}),
  ...(role === 'consultant' ? { specializare: 'Fonduri europene' } : {}),
})
const authClient = () => createClient(config.supabaseUrl, config.anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
async function api(method: string, route: string, body?: unknown) {
  const response = await fetch(config.baseUrl + route, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
  return { status: response.status, body: await response.json() }
}
function passwordFromMail(address: string) {
  const messages = fs.readFileSync(mailLog, 'utf8').trim().split('\n').map(line => JSON.parse(line))
  return messages.find(message => message.body?.text?.includes('Adresa de email: ' + address))?.body.text.match(/Parola temporară: ([^\n]+)/)?.[1]
}
test.beforeAll(async () => {
  const login = await authClient().auth.signInWithPassword({ email: config.staffEmail, password: config.staffPassword })
  expect(login.error).toBeNull()
  token = login.data.session!.access_token
  expect((await api('GET', '/api/me')).body.profile.role).toBe('admin')
  expect(fs.existsSync(mailLog), 'Start the app with npm run dev:local').toBe(true)
})
test.afterAll(async () => {
  for (const id of ids) expect((await api('DELETE', '/api/users/' + id)).status).toBe(200)
})

test('all roles finalize, capture credentials locally and allow login', async () => {
  for (const role of ['client', 'consultant', 'admin']) {
    const body = input(role), result = await api('POST', '/api/users', body)
    expect(result.status, result.body.code).toBe(201)
    ids.add(result.body.userId)
    expect(result.body.emailSent).toBe(true)
    expect(result.body.temporaryPassword).toBeUndefined()
    const profile = await service.from('profiles').select('role,cif,creation_pending,is_active,must_change_password').eq('id', result.body.userId).single()
    expect(profile.error).toBeNull()
    expect(profile.data).toMatchObject({ role, cif: role === 'client' ? body.cif : null, creation_pending: false, is_active: true, must_change_password: true })
    const password = passwordFromMail(body.email)
    expect(Boolean(password)).toBe(true)
    const auth = authClient()
    expect((await auth.auth.signInWithPassword({ email: body.email, password })).error).toBeNull()
    expect((await auth.rpc('current_account_session_active')).data).toBe(true)
    const audit = await service.from('audit_logs').select('old_values,new_values').eq('entity_id', result.body.userId)
    expect(audit.error).toBeNull()
    expect(JSON.stringify(audit.data).includes(password!)).toBe(false)
  }
})

test('invalid and duplicate CIFs are refused before creating a profile', async () => {
  const body = input(), created = await api('POST', '/api/users', body)
  expect(created.status).toBe(201)
  ids.add(created.body.userId)
  for (const [cif, code, status] of [['12345678', 'CIF_INVALID', 400], [body.cif, 'CIF_DUPLICATE', 409]] as const) {
    const attempted = { ...input(), cif }
    const result = await api('POST', '/api/users', attempted)
    expect(result.status).toBe(status)
    expect(result.body.code).toBe(code)
    expect((await service.from('profiles').select('id').eq('email', attempted.email)).data).toEqual([])
  }
})

test('pending accounts remain inactive and cannot log in', async () => {
  const address = email(), password = 'Pending-' + randomUUID()
  const pending = await service.auth.admin.createUser({ email: address, password, email_confirm: true, ban_duration: '87600h' })
  expect(pending.error).toBeNull()
  ids.add(pending.data.user!.id)
  expect((await service.from('profiles').select('creation_pending,is_active').eq('id', pending.data.user!.id).single()).data)
    .toEqual({ creation_pending: true, is_active: false })
  expect((await authClient().auth.signInWithPassword({ email: address, password })).error).not.toBeNull()
  expect((await api('POST', '/api/users/' + pending.data.user!.id + '/reactivate')).body.code).toBe('ACCOUNT_CREATION_PENDING')
})

test('browser creates a client and keeps the form filled after a duplicate', async ({ page }) => {
  await page.goto('/login')
  const passwordInput = page.locator('input[autocomplete=current-password]')
  await expect(async () => {
    if (await passwordInput.getAttribute('type') === 'password') await page.getByRole('button', { name: 'Arată parola', exact: true }).click()
    await expect(passwordInput).toHaveAttribute('type', 'text', { timeout: 1000 })
  }).toPass({ timeout: 15000 })
  await page.getByRole('button', { name: 'Ascunde parola', exact: true }).click()
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(config.staffEmail)
  await passwordInput.fill(config.staffPassword)
  await page.getByRole('button', { name: 'Intră în cont', exact: true }).click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'))
  await page.goto('/admin/users')
  const body = input()
  async function form(address: string) {
    await page.getByRole('button', { name: 'Adaugă utilizator', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Adaugă utilizator', exact: true })
    await dialog.getByRole('textbox', { name: 'Email', exact: true }).fill(address)
    await dialog.getByRole('textbox', { name: 'Nume complet', exact: true }).fill(body.fullName)
    await dialog.getByRole('textbox', { name: 'Nume firmă', exact: true }).fill(body.numeFirma!)
    await dialog.getByRole('textbox', { name: 'Adresă firmă', exact: true }).fill(body.adresaFirma!)
    await dialog.getByRole('textbox', { name: 'CUI / CIF' }).fill(body.cif!)
    return dialog
  }
  const dialog = await form(body.email)
  await dialog.getByRole('button', { name: 'Creează', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const profile = await service.from('profiles').select('id,creation_pending,is_active').eq('email', body.email).single()
  expect(profile.error).toBeNull()
  ids.add(profile.data!.id)
  expect(profile.data).toMatchObject({ creation_pending: false, is_active: true })
  const address = email(), duplicate = await form(address)
  await duplicate.getByRole('button', { name: 'Creează', exact: true }).click()
  await expect(duplicate.getByRole('alert')).toHaveText('Firma are deja un cont. Nu poți folosi același CIF.')
  await expect(duplicate.getByRole('textbox', { name: 'Email', exact: true })).toHaveValue(address)
  await expect(duplicate.getByRole('textbox', { name: 'CUI / CIF' })).toBeFocused()
})
