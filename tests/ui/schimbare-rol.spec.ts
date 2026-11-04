import { test, expect, type Page } from '@playwright/test'

const id = '11000000-0000-4000-8000-000000000001'
const authUser = { id, email: 'admin@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }
const admin = { ...authUser, role: 'admin', full_name: 'Admin Test', is_active: true, creation_pending: false, specializare: 'Finanțare' }
const blocker = { id: 'project-1', kind: 'senior', title: 'Proiect test', reason: 'Adaugă alt senior activ în echipă.', project_id: 'project-1', project_name: 'Proiect test', state: 'active', url: '/projects/project-1' }
const impact = (blocked: boolean) => ({ checked_at: '2026-11-02T12:00:00Z', blockers: blocked ? [blocker] : [], information: [], totals: { blockers: blocked ? 1 : 0, information: 0 }, warnings: blocked ? ['Nu va mai exista niciun consultant senior activ.'] : [] })

async function setup(page: Page, repeatSession = false) {
  let checks = 0, patches = 0, currentRole = 'admin'
  let nextImpact: 'error' | 'blocked' | 'clear' | 'last_admin' | 'many' = 'error'
  let nextPatch = 409
  const expires = Math.floor(Date.now() / 1000) + 3600
  const token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: id, role: 'authenticated', aud: 'authenticated', exp: expires })).toString('base64url'), 'local-ui-mock'].join('.')
  await page.routeWebSocket(/\/realtime\/v1\//, socket => socket.close())
  await page.route(/\/auth\/v1\//, route => route.fulfill({ json: route.request().url().includes('/token') ? { access_token: token, refresh_token: 'local-ui-refresh', token_type: 'bearer', expires_in: 3600, expires_at: expires, user: authUser } : authUser }))
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (path === '/api/me') {
      if (repeatSession) {
        repeatSession = false
        await page.evaluate(() => {
          const key = Object.keys(localStorage).find(key => /^sb-.*-auth-token$/.test(key))
          if (!key) throw new Error('Missing mock session')
          const channel = new BroadcastChannel(key)
          channel.postMessage({ event: 'SIGNED_IN', session: JSON.parse(localStorage.getItem(key)!) })
          setTimeout(() => channel.close(), 300)
        })
        await page.waitForTimeout(150)
      }
      return route.fulfill({ json: { profile: { ...admin, role: currentRole } } })
    }
    if (path === '/api/users') return route.fulfill({ json: { users: [admin] } })
    if (path.endsWith('/role-impact')) { checks++; return nextImpact === 'error' ? route.fulfill({ status: 500, json: {} }) : route.fulfill({ json: nextImpact === 'last_admin' ? { ...impact(true), blockers: [{ id, kind: 'last_admin', title: 'Ultimul administrator activ', reason: 'Trebuie să rămână cel puțin un administrator activ.' }] } : nextImpact === 'many' ? { ...impact(true), blockers: Array.from({ length: 41 }, (_, index) => ({ ...blocker, id: String(index), title: `Activitate ${index + 1}` })), totals: { blockers: 41, information: 0 } } : impact(nextImpact === 'blocked') }) }
    if (path === `/api/users/${id}` && request.method() === 'PATCH') { patches++; if (nextPatch === 409) return route.fulfill({ status: 409, json: { code: 'USER_ROLE_CHANGE_BLOCKED' } }); currentRole = 'consultant'; return route.fulfill({ json: { profile: { ...admin, role: currentRole } } }) }
    return route.fulfill({ json: { available: false, projects: [], notifications: [], unreadCount: 0, conversations: [], counts: {}, statuses: [] } })
  })
  const hydrated = page.waitForRequest('**/api/auth/recovery/availability')
  await page.goto('/login'); await hydrated
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(authUser.email)
  await page.locator('input[autocomplete="current-password"]').fill('local-ui-password')
  await page.getByRole('button', { name: 'Intră în cont', exact: true }).click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'))
  await page.goto(`/admin/users/${id}`)
  await page.getByRole('button', { name: 'Schimbă rolul' }).click()
  return { setImpact: (value: typeof nextImpact) => { nextImpact = value }, allowPatch: () => { nextPatch = 200 }, checks: () => checks, patches: () => patches }
}

test('a repeated session from another tab does not discard the pending profile', async ({ page }) => {
  await setup(page, true)
  await expect(page.getByRole('dialog', { name: 'Schimbă rolul' })).toBeVisible()
})

test('open inherited requests appear under their completed activity without adding a blocker', async ({ page }) => {
  await setup(page)
  await page.route('**/role-impact', route => route.fulfill({ json: {
    checked_at: new Date().toISOString(), warnings: [], totals: { blockers: 2, information: 1 },
    blockers: ['1', '2'].map(id => ({ id, kind: 'request', title: `Cererea ${id}`, reason: 'Predă responsabilitatea cererii.', project_id: 'p', project_name: 'Proiect test', source: 'activity', url: `/projects/p?phase=ph&activity=a&document=${id}` })),
    information: [{ id: 'a', kind: 'historical_activity', title: 'Verificare eligibilitate', reason: 'Responsabilitate istorică.', project_id: 'p', project_name: 'Proiect test', state: 'completed', url: '/projects/p?phase=ph&activity=a' }],
  } }))
  const dialog = page.getByRole('dialog', { name: 'Schimbă rolul' })
  await dialog.getByRole('button', { name: 'Reverifică' }).click()
  await dialog.locator('summary', { hasText: 'Proiect test (2)' }).click()
  const activity = dialog.locator('li').filter({ hasText: 'Activitate: Verificare eligibilitate · Finalizată' }).first()
  await expect(activity.getByText('Cerere de documente: Cererea 1')).toBeVisible()
  await expect(activity.getByText('Cerere de documente: Cererea 2')).toBeVisible()
  await expect(dialog.getByRole('heading', { name: 'De rezolvat înainte de schimbare (2)' })).toBeVisible()
})

test('inherited requests are grouped under the open activity and direct assignments stay separate', async ({ page }) => {
  await setup(page)
  await page.route('**/role-impact', route => route.fulfill({ json: {
    checked_at: new Date().toISOString(), warnings: [], totals: { blockers: 4, information: 0 }, information: [],
    blockers: [
      { id: 'a', kind: 'activity', title: 'Activitate în lucru', reason: 'Înlocuiește responsabilul.', project_id: 'p', project_name: 'Proiect test', state: 'in_progress', url: '/projects/p?phase=ph&activity=a' },
      ...['1', '2'].map(id => ({ id, kind: 'request', title: `Cererea ${id}`, reason: 'Predă responsabilitatea cererii.', project_id: 'p', project_name: 'Proiect test', source: 'activity', url: `/projects/p?phase=ph&activity=a&document=${id}` })),
      { id: '3', kind: 'request', title: 'Cerere directă', reason: 'Predă responsabilitatea cererii.', project_id: 'p', project_name: 'Proiect test', source: 'direct', url: '/projects/p?phase=ph&activity=a&document=3' },
    ],
  } }))
  const dialog = page.getByRole('dialog', { name: 'Schimbă rolul' })
  await dialog.getByRole('button', { name: 'Reverifică' }).click()
  await dialog.locator('summary', { hasText: 'Proiect test (4)' }).click()
  const group = dialog.locator('li').filter({ hasText: 'Activitate: Activitate în lucru' }).first()
  await expect(group.getByText('Cerere de documente: Cererea 1')).toBeVisible()
  await expect(group.getByText('Cerere de documente: Cererea 2')).toBeVisible()
  await expect(group.getByText('Cerere de documente: Cerere directă')).toHaveCount(0)
  await expect(dialog.getByRole('heading', { name: 'De rezolvat înainte de schimbare (4)' })).toBeVisible()
})

test('impact failure, blockers, recheck and concurrent conflict fail closed', async ({ page }) => {
  const api = await setup(page), dialog = page.getByRole('dialog', { name: 'Schimbă rolul' })
  const confirm = dialog.getByRole('button', { name: 'Confirmă schimbarea' })
  await expect(dialog.getByRole('alert')).toContainText('Nu am putut verifica impactul')
  await expect(confirm).toBeDisabled()
  await expect(dialog.getByLabel('Specializare')).toHaveValue('Finanțare')
  await expect(dialog.getByLabel('Nivel')).toHaveValue('junior')
  await expect(dialog.getByText('Rol actual: administrator → Rol nou: consultant')).toBeVisible()
  api.setImpact('blocked'); await dialog.getByRole('button', { name: 'Reverifică' }).click()
  await expect(dialog.getByText('Acțiunea nu poate fi confirmată încă. Rezolvă blocajul de mai jos.')).toBeVisible()
  await expect(dialog.getByRole('heading', { name: 'De rezolvat înainte de schimbare (1)' })).toBeVisible()
  await expect(dialog.getByRole('heading', { name: 'Se păstrează fără modificări (0)' })).toBeVisible()
  await expect(dialog.getByText('Confirmarea devine disponibilă după rezolvarea blocajelor.')).toBeVisible()
  await expect(dialog.getByText(/Acest avertisment nu blochează singur confirmarea/)).toBeVisible()
  await expect(dialog.getByText('Adaugă alt senior activ în echipă.')).toBeHidden()
  await dialog.locator('summary', { hasText: 'Proiect test' }).click()
  await expect(dialog.getByText('Adaugă alt senior activ în echipă.')).toBeVisible()
  const entry = dialog.locator('li').filter({ hasText: 'Adaugă alt senior activ în echipă.' })
  await expect(entry.locator('p').first()).toHaveText('Adaugă alt senior activ în echipă.')
  await expect(entry).not.toContainText('Senior: Proiect test · activ')
  await expect(dialog.getByRole('link', { name: /Deschide echipa/ })).toHaveAttribute('target', '_blank')
  await expect(confirm).toBeDisabled()
  api.setImpact('clear'); await dialog.getByRole('button', { name: 'Reverifică' }).click(); await expect(confirm).toBeEnabled()
  await expect(dialog.getByText('Nu există blocaje. Verifică informațiile de mai jos înainte de confirmare.')).toBeVisible()
  await dialog.getByLabel('Specializare').fill('')
  await expect(confirm).toBeDisabled()
  await expect(dialog.getByText('Completează specializarea pentru a putea confirma.')).toBeVisible()
  await dialog.getByLabel('Specializare').fill('Finanțare')
  api.setImpact('blocked'); await confirm.click(); await expect(confirm).toBeDisabled()
  expect(api.patches()).toBe(1)
  const previous = api.checks(); await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await expect.poll(api.checks).toBeGreaterThan(previous)
  await expect(dialog.getByRole('button', { name: 'Renunță' })).toBeEnabled()
  await dialog.getByRole('button', { name: 'Renunță' }).focus(); await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0)
})

test('self demotion refreshes the session and leaves admin', async ({ page }) => {
  const api = await setup(page), dialog = page.getByRole('dialog', { name: 'Schimbă rolul' })
  api.setImpact('clear'); api.allowPatch(); await dialog.getByRole('button', { name: 'Reverifică' }).click()
  await dialog.getByRole('button', { name: 'Confirmă schimbarea' }).click()
  await page.waitForURL(url => !url.pathname.startsWith('/admin'))
  expect(api.patches()).toBe(1)
})


test('last active administrator is explained and cannot be changed', async ({ page }) => {
  const api = await setup(page), dialog = page.getByRole('dialog', { name: 'Schimbă rolul' })
  api.setImpact('last_admin')
  await dialog.getByRole('button', { name: 'Reverifică' }).click()
  await dialog.locator('summary', { hasText: 'Alte referințe' }).click()
  await expect(dialog.getByText('Trebuie să rămână cel puțin un administrator activ.')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Confirmă schimbarea' })).toBeDisabled()
  expect(api.patches()).toBe(0)
})

test('all results appear in the same collapsed project without pagination', async ({ page }) => {
  const api = await setup(page), dialog = page.getByRole('dialog', { name: 'Schimbă rolul' })
  api.setImpact('many')
  await dialog.getByRole('button', { name: 'Reverifică' }).click()
  const project = dialog.locator('summary', { hasText: 'Proiect test (41)' })
  await expect(project).toBeVisible()
  await expect(dialog.getByText('Senior: Activitate 41', { exact: false })).toBeHidden()
  await project.click()
  await expect(dialog.getByText('Senior: Activitate 41', { exact: false })).toBeVisible()
  await expect(dialog.getByRole('button', { name: /Pagina următoare|Pagina anterioară/ })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Confirmă schimbarea' })).toBeDisabled()
})

test('project links reveal a completed activity and open a closable team panel', async ({ page }) => {
  await setup(page)
  const projectId = '20000000-0000-4000-8000-000000000001'
  const phaseId = '20000000-0000-4000-8000-000000000002'
  const activityId = '20000000-0000-4000-8000-000000000003'
  await page.addInitScript(() => {
    const animate = Element.prototype.animate
    Element.prototype.animate = function (...args) {
      this.setAttribute('data-test-animated', 'true')
      return animate.apply(this, args)
    }
  })
  await page.route(`**/api/projects/${projectId}**`, route => {
    const path = new URL(route.request().url()).pathname
    const json = path.endsWith('/phases') ? { phases: [
      { id: 'other-phase', name: 'Altă fază', visibility: 'published', activities: [] },
      { id: phaseId, name: 'Faza finalizată', visibility: 'published', activities: [
        { id: activityId, phase_id: phaseId, name: 'Activitate finalizată', status: 'completed', visibility: 'published' },
      ] },
    ] } : path.endsWith('/document-requests') ? { requests: [] }
      : path.endsWith('/members') ? { members: [] }
      : { project: { id: projectId, title: 'Proiect test', lifecycle_status: 'active' }, permissions: { reassign_project: true } }
    return route.fulfill({ json })
  })
  await page.goto(`/projects/${projectId}?phase=${phaseId}&activity=${activityId}`)
  const activity = page.locator(`#activity-${activityId}`)
  await expect(activity).toBeVisible()
  await expect(activity).toHaveAttribute('data-test-animated', 'true')
  await page.goto(`/projects/${projectId}?phase=__general__&general_consultant=1`)
  await expect(page.locator('#general-consultant')).toHaveAttribute('data-test-animated', 'true')
  await page.goto(`/projects/${projectId}?team=1`)
  const team = page.getByRole('dialog', { name: 'Echipa proiectului' })
  await expect(team).toBeVisible()
  await team.getByRole('button', { name: 'Închide' }).click()
  await expect(team).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Echipa proiectului/ })).toBeVisible()
})
