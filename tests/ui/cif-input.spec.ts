import { test, expect, type Page } from '@playwright/test'

test.use({ actionTimeout: 10_000, navigationTimeout: 30_000 })

const adminId = '11000000-0000-4000-8000-000000000001'
const pendingId = '11000000-0000-4000-8000-000000000002'
const historicalId = '11000000-0000-4000-8000-000000000003'
const createdId = '11000000-0000-4000-8000-000000000004'
const duplicateMessage = 'Firma are deja un cont. Nu poți folosi același CIF.'
const pending = { id: pendingId, email: 'incomplete@example.invalid', full_name: 'Cont incomplet', role: 'client', creation_pending: true, is_active: false, created_at: '2026-10-22T10:00:00Z', cif: null }
const historical = { ...pending, id: historicalId, email: 'consultant@example.invalid', full_name: 'Consultant', role: 'consultant', creation_pending: false, is_active: true, cif: 'DE123456789' }

// Every API/Auth/Realtime request is intercepted; these tests never write to a database.
async function setup(page: Page) {
  const posts: Record<string, unknown>[] = [], patches: Record<string, unknown>[] = []
  let reply = { status: 201, body: { userId: createdId, emailSent: true } as Record<string, unknown> }
  const user = { id: adminId, email: 'admin@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }
  const expires = Math.floor(Date.now() / 1000) + 3600
  const token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: adminId, role: 'authenticated', aud: 'authenticated', exp: expires })).toString('base64url'), 'local-ui-mock'].join('.')
  await page.routeWebSocket(/\/realtime\/v1\//, socket => socket.close())
  await page.route(/\/auth\/v1\//, route => route.fulfill({ json: route.request().url().includes('/token')
    ? { access_token: token, refresh_token: 'local-ui-refresh', token_type: 'bearer', expires_in: 3600, expires_at: expires, user }
    : user }))
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.pathname === '/api/me') return route.fulfill({ json: { profile: { ...user, role: 'admin', is_active: true, consultant_level: 'junior' } } })
    if (url.pathname === '/api/users' && request.method() === 'POST') {
      posts.push(request.postDataJSON())
      return route.fulfill({ status: reply.status, json: reply.body })
    }
    if (url.pathname === '/api/users' && request.method() === 'GET') {
      const state = url.searchParams.get('state') ?? 'all'
      return route.fulfill({ json: { users: [pending, historical].filter(person => state === 'all' || person.is_active === (state === 'active')) } })
    }
    if (url.pathname.startsWith('/api/users/') && request.method() === 'PATCH') {
      patches.push(request.postDataJSON())
      return route.fulfill({ json: { changed: true, profile: { ...historical, ...request.postDataJSON() } } })
    }
    if (url.pathname.endsWith('/lifecycle-impact')) return route.fulfill({ json: { impact: {}, blockers: [{ kind: 'public.audit_logs.user_id', count: 1 }] } })
    return route.fulfill({ json: { available: false, projects: [], notifications: [], unreadCount: 0, conversations: [], counts: {}, statuses: [] } })
  })
  const hydrated = page.waitForRequest('**/api/auth/recovery/availability')
  await page.goto('/login')
  await hydrated
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(user.email)
  await page.locator('input[autocomplete="current-password"]').fill('local-ui-password')
  await page.getByRole('button', { name: 'Intră în cont', exact: true }).click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'))
  await page.goto('/admin/users')
  await expect(page.getByRole('heading', { name: 'Utilizatori', exact: true })).toBeVisible()
  return { posts, patches, respond: (status: number, body: Record<string, unknown>) => { reply = { status, body } } }
}

async function openForm(page: Page) {
  await page.getByRole('button', { name: 'Adaugă utilizator', exact: true }).click()
  const form = page.getByRole('dialog', { name: 'Adaugă utilizator', exact: true })
  await expect(form).toBeVisible()
  return form
}

async function fillClient(page: Page, number = '5258486') {
  const form = await openForm(page)
  await form.getByRole('textbox', { name: 'Email', exact: true }).fill('new@example.invalid')
  await form.getByLabel('Nume complet').fill('Nume de test')
  await form.getByLabel('Nume firmă').fill('Firma de test')
  await form.getByLabel('Telefon', { exact: true }).fill('0700000000')
  await form.getByRole('textbox', { name: 'CUI / CIF' }).fill(number)
  return form
}

test('CIF: catalog, labels, blur validation, correction and keyboard focus', async ({ page }) => {
  const api = await setup(page), form = await openForm(page)
  const country = form.getByLabel('Țara firmei'), number = form.getByRole('textbox', { name: 'CUI / CIF' })
  await expect(country).toHaveValue('RO'); await expect(country.locator('option')).toHaveCount(27)
  await expect(country.locator('option').first()).toHaveText('România (RO)')
  await expect(form.getByText(/Prefixul RO nu atestă statutul TVA/)).toBeVisible()
  await expect(number).toHaveAttribute('type', 'text'); await expect(number).toHaveAttribute('inputmode', 'numeric')
  await number.fill('12345678'); await number.press('Tab')
  await expect(number).toHaveAttribute('aria-invalid', 'true')
  await expect(form.getByRole('alert')).toHaveText('CUI-ul nu e valid. Verifică cifrele.')
  await expect(number).toHaveAccessibleDescription(/CUI-ul nu e valid/)
  await number.fill('ro 0005.258.486')
  await expect(number).toHaveAttribute('aria-invalid', 'false'); await expect(form.getByRole('alert')).toHaveCount(0)
  expect(api.posts).toHaveLength(0)
  await form.getByRole('button', { name: 'Creează', exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(form.getByRole('button', { name: 'Închide panoul' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(form.getByRole('button', { name: 'Creează', exact: true })).toBeFocused()
  await expect(page.getByRole('tooltip')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(form).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Adaugă utilizator', exact: true })).toBeFocused()
})

test('CIF: submit focuses the first invalid field and never sends invalid data', async ({ page }) => {
  const api = await setup(page), form = await fillClient(page, '12345678')
  await form.getByRole('textbox', { name: 'Email', exact: true }).fill('')
  await form.getByRole('button', { name: 'Creează', exact: true }).click()
  await expect(form.getByRole('textbox', { name: 'Email', exact: true })).toBeFocused()
  await form.getByRole('textbox', { name: 'Email', exact: true }).fill('new@example.invalid')
  await form.getByRole('button', { name: 'Creează', exact: true }).click()
  await expect(form.getByRole('textbox', { name: 'CUI / CIF' })).toBeFocused()
  await expect(form.getByRole('alert')).toHaveText('CUI-ul nu e valid. Verifică cifrele.')
  expect(api.posts).toHaveLength(0)
})

test('CIF: country changes preserve text, revalidate and send the FR prefix-like key', async ({ page }) => {
  const api = await setup(page), form = await fillClient(page, 'DE123456789')
  const country = form.getByLabel('Țara firmei')
  await form.getByRole('textbox', { name: 'CUI / CIF' }).press('Tab')
  await expect(form.getByRole('alert')).toContainText('nu corespunde')
  await country.selectOption('FR')
  const number = form.getByRole('textbox', { name: 'Număr TVA' })
  await expect(number).toHaveValue('DE123456789'); await expect(number).toHaveAttribute('inputmode', 'text')
  await expect(form.getByRole('alert')).toHaveCount(0)
  await expect(form.getByText(/firmele fără unul nu sunt încă acceptate/)).toBeVisible()
  await form.getByRole('button', { name: 'Creează', exact: true }).click()
  await expect(form).toHaveCount(0)
  expect(api.posts).toHaveLength(1); expect(api.posts[0]).toMatchObject({ cif: 'DE123456789', cifCountry: 'FR' })
  const reset = await openForm(page)
  await expect(reset.getByLabel('Țara firmei')).toHaveValue('RO')
  await expect(reset.getByRole('textbox', { name: 'CUI / CIF' })).toHaveValue('')
})

test('CIF: duplicate message persists beside the field and preserves the whole form', async ({ page }) => {
  const api = await setup(page), form = await fillClient(page)
  api.respond(409, { code: 'CIF_DUPLICATE', message: duplicateMessage, field: 'cif' })
  await form.getByLabel('Adresă firmă').fill('Adresa de test')
  await form.getByLabel('Persoană de contact').fill('Contact de test')
  await form.getByRole('button', { name: 'Creează', exact: true }).click()
  const number = form.getByRole('textbox', { name: 'CUI / CIF' })
  await expect(number).toBeFocused(); await expect(number).toHaveAttribute('aria-invalid', 'true')
  await expect(number).toHaveAccessibleDescription(new RegExp(duplicateMessage.replaceAll('.', '\\.')))
  await number.press('Tab')
  await expect(form.getByRole('alert')).toHaveText(duplicateMessage)
  for (const [label, value] of [['Email', 'new@example.invalid'], ['Nume complet', 'Nume de test'], ['Nume firmă', 'Firma de test'], ['Telefon', '0700000000'], ['Adresă firmă', 'Adresa de test'], ['Persoană de contact', 'Contact de test']]) {
    await expect(form.getByRole('textbox', { name: label })).toHaveValue(value)
  }
  await number.fill('RO18547290')
  await expect(form.getByRole('alert')).toHaveCount(0)
  expect(api.posts).toHaveLength(1)
})

test('CIF: server country error is associated with and focuses the country control', async ({ page }) => {
  const api = await setup(page), form = await fillClient(page)
  api.respond(400, { code: 'CIF_COUNTRY_UNSUPPORTED', message: 'Alege o țară din Uniunea Europeană.', field: 'cifCountry' })
  await form.getByRole('button', { name: 'Creează', exact: true }).click()
  await expect(form.getByLabel('Țara firmei')).toBeFocused()
  await expect(form.getByLabel('Țara firmei')).toHaveAttribute('aria-invalid', 'true')
  await expect(form.getByLabel('Țara firmei')).toHaveAccessibleDescription(/Alege o țară din Uniunea Europeană/)
})

for (const [status, code] of [[500, 'ACCOUNT_CREATION_PENDING'], [503, 'ACCOUNT_CREATION_UNCONFIRMED'], [409, 'ACCOUNT_CREATION_INACTIVE']] as const) {
  test(`CIF: ${code} shows the actual result and requires list review`, async ({ page }) => {
    const api = await setup(page), form = await fillClient(page)
    const message = code === 'ACCOUNT_CREATION_PENDING' ? 'Contul a rămas incomplet și blocat.' : 'Verifică lista înainte de a reîncerca.'
    api.respond(status, { code, message })
    await form.getByRole('button', { name: 'Creează', exact: true }).click()
    await expect(form.getByRole('alert')).toContainText(message)
    await expect(form.getByRole('button', { name: 'Creează', exact: true })).toBeDisabled()
    await expect(form.getByRole('textbox', { name: 'Email', exact: true })).toHaveValue('new@example.invalid')
    await expect(form.getByRole('textbox', { name: 'Email', exact: true })).toBeDisabled()
    await expect(page.getByText('Utilizatorul a fost creat.', { exact: true })).toHaveCount(0)
    await expect(form.getByLabel('Parola temporară generată')).toHaveCount(0)
    await form.getByRole('button', { name: 'Verifică lista de utilizatori' }).click()
    await expect(form).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Toate stările', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByLabel('Caută utilizatori')).toHaveValue('new@example.invalid')
    expect(api.posts).toHaveLength(1)
  })
}

test('CIF: confirmed email failure shows fallback credentials; incomplete success never does', async ({ page }) => {
  const api = await setup(page), form = await fillClient(page)
  api.respond(201, { userId: createdId, emailSent: false, temporaryPassword: 'Local-probe-fallback-only' })
  await form.getByRole('button', { name: 'Creează', exact: true }).click()
  await expect(form.getByLabel('Parola temporară generată')).toHaveValue('Local-probe-fallback-only')
  await expect(form.getByLabel('Parola temporară generată')).toHaveAttribute('readonly', '')
  await form.getByRole('button', { name: 'Închide panoul' }).click()
  const again = await fillClient(page)
  api.respond(201, { userId: createdId, emailSent: false })
  await again.getByRole('button', { name: 'Creează', exact: true }).click()
  await expect(again.getByRole('alert')).toContainText('Nu am putut confirma')
  await expect(again.getByLabel('Parola temporară generată')).toHaveCount(0)
})

test('CIF: internal roles hide CIF and omit it from the request; role change resets country', async ({ page }) => {
  const api = await setup(page), form = await fillClient(page)
  await form.getByLabel('Țara firmei').selectOption('FR')
  await form.getByRole('radio', { name: 'Consultant', exact: true }).check()
  await expect(form.getByLabel('Țara firmei')).toHaveCount(0)
  await form.getByLabel('Specializare').fill('Proiecte')
  await form.getByRole('button', { name: 'Creează', exact: true }).click()
  await expect(form).toHaveCount(0)
  expect(api.posts[0]).not.toHaveProperty('cif'); expect(api.posts[0]).not.toHaveProperty('cifCountry')
  const again = await openForm(page)
  await again.getByRole('radio', { name: 'Client (firmă)', exact: true }).check()
  await expect(again.getByLabel('Țara firmei')).toHaveValue('RO')
  await expect(again.getByRole('textbox', { name: 'CUI / CIF' })).toHaveValue('')
})

test('CIF: pending accounts cannot change role or reactivate and deletion stays protected', async ({ page }) => {
  const api = await setup(page)
  await page.getByRole('button', { name: 'Toate stările', exact: true }).click()
  await expect(page.getByText('Creare incompletă', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Rolul lui ' + pending.email, { exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Reactivează ' + pending.email, exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Dezactivează ' + pending.email, exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Șterge definitiv utilizatorul ' + pending.email }).click()
  await expect(page.getByRole('dialog')).toHaveAccessibleName('Utilizatorul nu poate fi șters')
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Șterge definitiv', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.goto('/admin/users/' + pending.id)
  await expect(page.getByText('Creare incompletă', { exact: true })).toBeVisible()
  await expect(page.getByRole('alert').filter({ hasText: 'Acces blocat: crearea' })).toContainText('Editarea și reactivarea nu sunt permise')
  await page.goto('/admin/users/' + historical.id)
  await expect(page.getByText('CIF ' + historical.cif, { exact: true })).toHaveCount(0)
  expect(api.patches).toHaveLength(0)
})

test('CIF: list role transition refuses missing CIF before confirmation', async ({ page }) => {
  const api = await setup(page)
  // This historical CIF is valid, so the role can be reused; another blank account cannot.
  await page.getByLabel('Rolul lui ' + historical.email, { exact: true }).selectOption('client')
  const confirmation = page.getByRole('dialog', { name: 'Confirmă schimbarea rolului' })
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: 'Anulează', exact: true }).click()
  await page.route('**/api/users?state=*', route => route.fulfill({ json: { users: [{ ...historical, cif: null }] } }))
  await page.reload()
  await page.getByLabel('Rolul lui ' + historical.email, { exact: true }).selectOption('client')
  await expect(page.getByRole('alert').filter({ hasText: 'Trecerea la client necesită' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(api.patches).toHaveLength(0)
})

test('CIF: long country hints and errors fit narrow phones', async ({ page }) => {
  const api = await setup(page), form = await fillClient(page)
  await form.getByLabel('Țara firmei').selectOption('IE')
  await form.getByRole('textbox', { name: 'Număr TVA' }).fill('1+23456A')
  api.respond(409, { code: 'CIF_DUPLICATE', message: duplicateMessage, field: 'cif' })
  await form.getByRole('button', { name: 'Creează', exact: true }).click()
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await form.getByRole('textbox', { name: 'Număr TVA' }).scrollIntoViewIfNeeded()
    await expect(form.getByRole('alert')).toBeInViewport({ ratio: 1 })
    for (const control of [form.getByLabel('Țara firmei'), form.getByRole('textbox', { name: 'Număr TVA' }), form.getByRole('alert')]) {
      const bounds = await control.boundingBox()
      expect(bounds).not.toBeNull(); expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
    }
    expect(await form.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    await page.screenshot({ path: test.info().outputPath('cif-error-' + width + '.png') })
  }
})
