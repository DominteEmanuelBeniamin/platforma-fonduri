import { test, expect, type Page } from '@playwright/test'
import {
  cleanupCreated,
  createCreatedRegistry,
  createTemporaryProject,
  destroyTemporaryProject,
  e2eEnv,
  phaseWithActivities,
  protectSourceStoragePath,
  registerCreatedActivity,
  registerCreatedPhase,
  registerCreatedRequest,
  requireE2EConfig,
  serviceClient,
  storagePathsForPhase,
  verifyServerUsesFixture,
  type CreatedRegistry,
  type TemporaryProjectFixture,
} from './helpers/project-state'

/**
 * Duplicarea fazelor și activităților (#15), peste serverul din mediul E2E
 * dedicat. Fiecare test creează un proiect nou, cu un fixture mic și cunoscut.
 */
const CONFIG = requireE2EConfig(e2eEnv())
const admin = serviceClient()

async function login(page: Page) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.locator('input[type=email]').fill(CONFIG.staffEmail)
  await page.locator('input[type=password]').fill(CONFIG.staffPassword)
  await page.getByRole('button', { name: 'Intră în cont' }).click()
  await page.waitForURL('/', { timeout: 25_000 })
  await page.waitForTimeout(1500)
}

async function openPhasesView(page: Page, projectId: string) {
  await page.goto(`/projects/${projectId}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(6000)
  await page.getByRole('button', { name: 'Fazele proiectului' }).click()
  await page.waitForTimeout(1500)
}

async function firstPhaseName(page: Page) {
  const menu = page.getByRole('button', { name: /^Acțiuni pentru faza / }).first()
  const label = await menu.getAttribute('aria-label')
  if (!label) throw new Error('Nu s-a găsit faza fixture în interfață')
  return label.replace('Acțiuni pentru faza ', '')
}

async function expandPhaseInCenter(page: Page, phaseName: string) {
  const row = page.getByRole('button', { name: `Acțiuni pentru faza ${phaseName}`, exact: true })
    .first().locator('xpath=../..')
  const chevron = row.getByRole('button', { name: 'Extinde faza' })
  if (await chevron.count()) await chevron.click()
  await expect(page.getByRole('heading', { name: phaseName, exact: true })).toBeVisible({ timeout: 20_000 })
}

async function createFixture() {
  if (!admin) throw new Error('Clientul service E2E lipsește din configurația dedicată')
  const fixture = await createTemporaryProject(admin, CONFIG)
  try {
    await verifyServerUsesFixture(CONFIG, fixture.projectId)
    return fixture
  } catch (error) {
    await destroyTemporaryProject(admin, fixture).catch(cleanupError => {
      console.error('Cleanup fixture E2E eșuat:', cleanupError)
    })
    throw error
  }
}

test.describe('meniurile de duplicare', () => {
  let fixture: TemporaryProjectFixture | null = null

  test.beforeEach(async () => { fixture = await createFixture() })
  test.afterEach(async () => {
    const failures: unknown[] = []
    try {
      if (admin && fixture) await destroyTemporaryProject(admin, fixture)
    } catch (error) {
      failures.push(error)
    } finally {
      fixture = null
    }
    if (failures.length) throw new Error(failures.map(error => error instanceof Error ? error.message : String(error)).join('\n'))
  })

  test('meniul de acțiuni oferă redenumire și duplicare', async ({ page }) => {
    await login(page)
    await openPhasesView(page, fixture!.projectId)

    const phaseName = await firstPhaseName(page)
    await page.getByRole('button', { name: `Acțiuni pentru faza ${phaseName}`, exact: true }).first().click()

    await expect(page.getByRole('menuitem', { name: 'Redenumește' }).first()).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Duplică' }).first()).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('menuitem', { name: 'Duplică' })).toHaveCount(0)
  })

  test('meniul activității nu se taie la marginea cardului', async ({ page }) => {
    await login(page)
    await openPhasesView(page, fixture!.projectId)
    await expandPhaseInCenter(page, 'Fază E2E')

    await page.getByRole('button', { name: 'Acțiuni pentru activitatea Activitate E2E', exact: true })
      .last().click()

    await expect(page.getByRole('menu')).toBeVisible()
    const painted = await page.evaluate(() => {
      const menu = document.querySelector('[role="menu"]')
      if (!menu) return 'meniul a dispărut'
      const box = menu.getBoundingClientRect()
      const atCorner = document.elementFromPoint(box.left + box.width / 2, box.bottom - 4)
      return menu.contains(atCorner) ? 'meniu' : `tăiat de <${atCorner?.tagName.toLowerCase() ?? 'nimic'}>`
    })
    expect(painted).toBe('meniu')

    const background = await page.getByRole('menu').evaluate(el => getComputedStyle(el).backgroundColor)
    expect(background).toBe('rgb(255, 255, 255)')

    await page.keyboard.press('Escape')
    await expect(page.getByRole('menuitem')).toHaveCount(0)
  })
})

test.describe('duplicare cu scriere reală în proiect efemer', () => {
  let fixture: TemporaryProjectFixture | null = null
  let copies: CreatedRegistry | null = null

  test.beforeEach(async () => {
    fixture = await createFixture()
    copies = createCreatedRegistry(fixture.projectId)
    for (const path of await storagePathsForPhase(admin!, fixture.phaseId)) {
      protectSourceStoragePath(copies, path)
    }
  })

  test.afterEach(async () => {
    const failures: unknown[] = []
    try {
      if (admin && copies) await cleanupCreated(admin, copies)
    } catch (error) {
      failures.push(error)
    } finally {
      try {
        if (admin && fixture) await destroyTemporaryProject(admin, fixture)
      } catch (error) {
        failures.push(error)
      } finally {
        copies = null
        fixture = null
      }
    }
    if (failures.length) throw new Error(failures.map(error => error instanceof Error ? error.message : String(error)).join('\n'))
  })

  test('faza duplicată apare sub original, în pregătire, și intră în redenumire', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))

    await login(page)
    await openPhasesView(page, fixture!.projectId)
    const phaseName = await firstPhaseName(page)
    await expandPhaseInCenter(page, phaseName)

    await page.getByRole('button', { name: `Acțiuni pentru faza ${phaseName}`, exact: true }).last().click()
    const duplicateResponse = page.waitForResponse(response =>
      response.request().method() === 'POST'
      && response.url().includes(`/api/projects/${fixture!.projectId}/phases/`)
      && response.url().endsWith('/duplicate'))
    await page.getByRole('menuitem', { name: 'Duplică' }).first().click()
    const response = await duplicateResponse
    const body = await response.json()
    registerCreatedPhase(copies!, body.phase?.id)
    if (!response.ok()) throw new Error(JSON.stringify(body))

    const renameInput = page.getByPlaceholder('Nume fază...')
    await expect(renameInput).toBeVisible({ timeout: 30_000 })
    await expect(renameInput).toHaveValue(`${phaseName} (copie)`)

    await renameInput.fill('Fază redenumită de test')
    await renameInput.press('Enter')
    await expect(page.getByText('Fază redenumită de test', { exact: true }).first()).toBeVisible({ timeout: 20_000 })

    const copyId = [...copies!.phaseIds][0]
    const copy = await admin!.from('project_phases')
      .select('visibility, order_index, project_id').eq('id', copyId).single()
    if (copy.error) throw copy.error
    expect(copy.data?.visibility).toBe('draft')
    expect(copy.data?.project_id).toBe(fixture!.projectId)

    const source = await admin!.from('project_phases')
      .select('order_index').eq('id', fixture!.phaseId).single()
    if (source.error) throw source.error
    expect(copy.data?.order_index).toBe((source.data?.order_index ?? 0) + 1)
    expect(errors).toEqual([])
  })

  test('activitatea duplicată își ia cererile, dar nu și fișierele clientului', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    const target = await phaseWithActivities(admin!, fixture!.projectId)
    if (!target) throw new Error('Proiectul fixture nu are activitatea necesară')

    await login(page)
    await openPhasesView(page, fixture!.projectId)
    await expandPhaseInCenter(page, target.phaseName)

    const activityName = target.activity.name
    const sourceActivity = await admin!.from('project_activities')
      .select('deadline_at, assigned_to').eq('id', target.activity.id).single()
    if (sourceActivity.error) throw sourceActivity.error
    await page.getByRole('button', { name: `Acțiuni pentru activitatea ${activityName}`, exact: true }).last().click()
    const duplicateResponse = page.waitForResponse(response =>
      response.request().method() === 'POST'
      && response.url().includes(`/api/projects/${fixture!.projectId}/phases/${target.phaseId}/activities/`)
      && response.url().endsWith('/duplicate'))
    await page.getByRole('menuitem', { name: 'Duplică' }).first().click()
    const response = await duplicateResponse
    const body = await response.json()
    registerCreatedActivity(copies!, body.activity?.id, target.phaseId)
    if (!response.ok()) throw new Error(JSON.stringify(body))

    const renameInput = page.getByPlaceholder('Nume activitate...')
    await expect(renameInput).toBeVisible({ timeout: 30_000 })
    await expect(renameInput).toHaveValue(`${activityName} (copie)`)
    await renameInput.press('Escape')

    const copy = await admin!.from('project_activities')
      .select('id, visibility, deadline_at, assigned_to').eq('id', [...copies!.activityIds][0]).single()
    if (copy.error) throw copy.error
    expect(copy.data?.visibility).toBe('draft')
    expect(copy.data?.deadline_at).toBe(sourceActivity.data?.deadline_at)
    expect(copy.data?.assigned_to).toBe(sourceActivity.data?.assigned_to)

    const sourceRequests = await admin!.from('document_requirements')
      .select('id').eq('activity_id', target.activity.id).is('deleted_at', null)
    if (sourceRequests.error) throw sourceRequests.error
    const copyRequests = await admin!.from('document_requirements')
      .select('id').eq('activity_id', copy.data!.id).is('deleted_at', null)
    if (copyRequests.error) throw copyRequests.error
    expect(copyRequests.data?.length).toBe(sourceRequests.data?.length)

    for (const request of copyRequests.data ?? []) {
      registerCreatedRequest(copies!, request.id, copy.data!.id)
    }

    const copyFiles = await admin!.from('files')
      .select('id').in('requirement_id', (copyRequests.data ?? []).map(r => r.id))
    if (copyFiles.error) throw copyFiles.error
    expect(copyFiles.data?.length ?? 0).toBe(0)
    expect(errors).toEqual([])
  })
})
