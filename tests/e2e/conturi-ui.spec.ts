import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { e2eEnv, requireE2EConfig } from './helpers/project-state'

const config = requireE2EConfig(e2eEnv())

test('users default to active and explain deletion blockers before confirmation', async ({ page }) => {
  test.setTimeout(120_000)
  const active = { id: randomUUID(), email: 'ui.active@example.invalid', role: 'client', is_active: true, created_at: '2026-10-05T12:00:00Z' }
  const inactive = { ...active, id: randomUUID(), email: 'ui.inactive@example.invalid', is_active: false }
  const empty = { ...inactive, id: randomUUID(), email: 'ui.empty@example.invalid' }
  const users = [active, inactive, empty]
  const blockers = [{ kind: 'public.audit_logs.user_id', count: 1 }]
  const impact = { activities: 0, documentRequests: 0, activeProjects: 0, completedProjects: 0, generalConsultantProjects: 0, projectsWithoutActiveSenior: 0 }
  const deletions: string[] = []
  let impactAvailable = true
  let releaseImpact = () => {}
  let impactReply = Promise.resolve()
  await page.route(/\/api\/users(?:\/|\?|$)/, async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'DELETE') {
      deletions.push(url.pathname)
      await route.fulfill({ status: 409, json: { code: 'USER_HAS_RELATED_DATA', details: { blockers } } })
    } else if (url.pathname.endsWith('/lifecycle-impact')) {
      await impactReply
      await route.fulfill({ status: impactAvailable ? 200 : 503, json: { impact, blockers: url.pathname.includes(empty.id) ? [] : blockers } })
    } else if (url.pathname === '/api/users' && request.method() === 'GET') {
      const state = url.searchParams.get('state')
      await route.fulfill({ json: { users: users.filter(user => state === 'all' || user.is_active === (state === 'active')) } })
    } else {
      await route.fulfill({ status: 400, json: { error: 'Unexpected users request in UI test' } })
    }
  })

  await page.goto('/login')
  const passwordInput = page.locator('input[autocomplete=current-password]')
  await expect(async () => {
    if (await passwordInput.getAttribute('type') === 'password') await page.getByRole('button', { name: 'Arată parola', exact: true }).click()
    await expect(passwordInput).toHaveAttribute('type', 'text', { timeout: 1_000 })
  }).toPass({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Ascunde parola', exact: true }).click()
  await page.fill('input[type=email]', config.staffEmail)
  await page.fill('input[type=password]', config.staffPassword)
  await page.getByRole('button', { name: 'Intră în cont', exact: true }).click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'))
  await page.goto('/admin/users')
  const filters = page.getByRole('group', { name: 'Filtrează după starea contului' })
  await expect(filters.getByRole('button', { name: 'Active', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Șterge definitiv utilizatorul ' + active.email, exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Șterge definitiv utilizatorul ' + inactive.email, exact: true })).toHaveCount(0)
  await filters.getByRole('button', { name: 'Dezactivate', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Șterge definitiv utilizatorul ' + active.email, exact: true })).toHaveCount(0)

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    impactReply = new Promise<void>(resolve => { releaseImpact = resolve })
    await page.getByRole('button', { name: 'Șterge definitiv utilizatorul ' + inactive.email, exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Se verifică legăturile contului…')).toBeVisible()
    await expect(dialog.locator('input')).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Șterge definitiv', exact: true })).toHaveCount(0)
    releaseImpact()
    await expect(dialog).toHaveAccessibleName('Utilizatorul nu poate fi șters')
    await expect(dialog.getByText('Contul este deja dezactivat.', { exact: false })).toBeVisible()
    await expect(dialog.getByText('Acțiuni în jurnalul de audit')).toBeVisible()
    await expect(dialog.getByRole('listitem')).toContainText('1')
    await expect(dialog.getByRole('button', { name: 'Dezactivează contul', exact: true })).toHaveCount(0)
    await expect(dialog.locator('input')).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath('cont-dezactivat-' + width + '.png') })
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  }
  expect(deletions).toEqual([])

  impactAvailable = false
  await page.getByRole('button', { name: 'Șterge definitiv utilizatorul ' + empty.email, exact: true }).click()
  await expect(page.getByRole('dialog').getByText('Nu am putut verifica legăturile contului.', { exact: false })).toBeVisible()
  await expect(page.getByRole('dialog').locator('input')).toHaveCount(0)
  await page.keyboard.press('Escape')
  impactAvailable = true
  await page.getByRole('button', { name: 'Șterge definitiv utilizatorul ' + empty.email, exact: true }).click()
  await page.getByRole('dialog').getByPlaceholder('sterge', { exact: true }).fill('sterge')
  await page.getByRole('dialog').getByRole('button', { name: 'Șterge definitiv', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveAccessibleName('Utilizatorul nu poate fi șters')
  await expect(page.getByRole('dialog').getByText('Contul este deja dezactivat.', { exact: false })).toBeVisible()
  await expect(page.getByRole('dialog').locator('input')).toHaveCount(0)
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Dezactivează contul', exact: true })).toHaveCount(0)
  expect(deletions).toEqual(['/api/users/' + empty.id])
  await page.keyboard.press('Escape')

  await filters.getByRole('button', { name: 'Toate stările', exact: true }).click()
  await page.getByRole('button', { name: 'Șterge definitiv utilizatorul ' + active.email, exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveAccessibleName('Utilizatorul nu poate fi șters')
  await expect(page.getByRole('dialog').getByText('Contul este deja dezactivat.', { exact: false })).toHaveCount(0)
  await page.getByRole('dialog').getByRole('button', { name: 'Dezactivează contul', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveAccessibleName('Dezactivează contul')
  await page.keyboard.press('Escape')

  const historicalLog = {
    id: randomUUID(), user_id: inactive.id, action_type: 'login', entity_type: 'user',
    entity_id: null, entity_name: null, actor_email: inactive.email, old_values: null, new_values: null,
    description: 'Autentificare cont temporar', ip_address: null, user_agent: null,
    created_at: '2026-10-05T12:00:00Z', user: null,
  }
  await page.route(/\/api\/audit(?:\?|$)/, route => {
    if (route.request().method() !== 'GET') return route.continue()
    return route.fulfill({ json: {
      logs: [historicalLog],
      pagination: { page: 1, limit: 50, total: 1, totalPages: 1, hasNext: false, hasPrev: false },
    } })
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/admin/audit')
  await expect(page.getByText(inactive.email + ' (cont șters)', { exact: true })).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click()
  const download = await downloadPromise
  const csvPath = test.info().outputPath('audit-cont-sters.csv')
  await download.saveAs(csvPath)
  const csv = await readFile(csvPath, 'utf8')
  expect(csv.split('\n')[1].split(',')[1]).toBe(inactive.email)
  await page.screenshot({ path: test.info().outputPath('audit-cont-sters.png') })
})
