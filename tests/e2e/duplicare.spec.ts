import { test, expect, type Page } from '@playwright/test'
import {
  phaseWithActivities,
  readEnvFile,
  restoreProject,
  serviceClient,
  snapshotProject,
  type ProjectSnapshot,
} from './helpers/project-state'

/**
 * Duplicarea fazelor și activităților (#15), prin interfață, peste dev server-ul
 * pornit separat (`npm run dev`) și conturile reale din `.env.e2e.local`.
 *
 * Testele care duplică chiar scriu în proiect, deci rulează numai cu
 * `E2E_WRITES=1` și își curăță singure urmele la final (copii, cereri, obiecte
 * din storage și ordinea fazelor), cu cheia de service din `.env.local`.
 */

const creds = readEnvFile('.env.e2e.local')
const PROJECT = creds.E2E_PROJECT_ID || '7f753afc-c107-4254-93d1-8259a050fc17'
const WRITES = process.env.E2E_WRITES === '1'

test.skip(!creds.E2E_STAFF_EMAIL, 'lipsește .env.e2e.local')

async function login(page: Page) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.locator('input[type=email]').fill(creds.E2E_STAFF_EMAIL)
  await page.locator('input[type=password]').fill(creds.E2E_STAFF_PASSWORD)
  await page.getByRole('button', { name: 'Intră în cont' }).click()
  await page.waitForURL('/', { timeout: 25_000 })
  await page.waitForTimeout(1500)
}

/** Pagina se deschide pe „Ce ai de făcut”; fazele stau pe cealaltă vedere. */
async function openPhasesView(page: Page) {
  await page.goto(`/projects/${PROJECT}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(6000)
  await page.getByRole('button', { name: 'Fazele proiectului' }).click()
  await page.waitForTimeout(1500)
}

/** Numele primei faze din bara laterală, ca testele să nu fixeze un nume. */
async function firstPhaseName(page: Page) {
  const menu = page.getByRole('button', { name: /^Acțiuni pentru faza / }).first()
  const label = await menu.getAttribute('aria-label')
  return label!.replace('Acțiuni pentru faza ', '')
}

async function expandPhaseInCenter(page: Page, phaseName: string) {
  const row = page.getByRole('button', { name: `Acțiuni pentru faza ${phaseName}`, exact: true })
    .first().locator('xpath=../..')
  const chevron = row.getByRole('button', { name: 'Extinde faza' })
  if (await chevron.count()) await chevron.click()
  await expect(page.getByRole('heading', { name: phaseName, exact: true })).toBeVisible({ timeout: 20_000 })
}

test('meniul de acțiuni oferă redenumire și duplicare', async ({ page }) => {
  await login(page)
  await openPhasesView(page)

  const phaseName = await firstPhaseName(page)
  await page.getByRole('button', { name: `Acțiuni pentru faza ${phaseName}`, exact: true }).first().click()

  await expect(page.getByRole('menuitem', { name: 'Redenumește' }).first()).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Duplică' }).first()).toBeVisible()

  // Escape închide meniul, fără să declanșeze nimic
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menuitem', { name: 'Duplică' })).toHaveCount(0)
})

test('meniul activității nu se taie la marginea cardului', async ({ page }) => {
  const admin = serviceClient()
  test.skip(!admin, 'lipsesc datele de service din .env.local, deci nu pot alege o fază cu activități')
  const target = await phaseWithActivities(admin!, PROJECT)
  test.skip(!target, 'proiectul de test nu are nicio fază cu activități')

  await login(page)
  await openPhasesView(page)
  await expandPhaseInCenter(page, target!.phaseName)

  await page.getByRole('button', { name: `Acțiuni pentru activitatea ${target!.activity.name}`, exact: true })
    .last().click()

  // Cardul activității are `overflow-hidden`, pentru colțurile rotunjite: dacă
  // meniul ar sta înăuntru, s-ar tăia la marginea cardului. Se vede doar prin
  // ce e chiar desenat în colțul de jos al meniului, nu din `toBeVisible`:
  // dreptunghiul unui element tăiat rămâne întreg.
  await expect(page.getByRole('menu')).toBeVisible()
  const painted = await page.evaluate(() => {
    const menu = document.querySelector('[role="menu"]')
    if (!menu) return 'meniul a dispărut'
    const box = menu.getBoundingClientRect()
    const atCorner = document.elementFromPoint(box.left + box.width / 2, box.bottom - 4)
    return menu.contains(atCorner) ? 'meniu' : `tăiat de <${atCorner?.tagName.toLowerCase() ?? 'nimic'}>`
  })
  expect(painted).toBe('meniu')

  // Token-urile `--p-*` stau pe `.project-scope`: în afara lui, fondul meniului
  // ar fi „culoare invalidă", adică transparent, cu rândul citindu-se prin el.
  const background = await page.getByRole('menu').evaluate(el => getComputedStyle(el).backgroundColor)
  expect(background).toBe('rgb(255, 255, 255)')

  await page.keyboard.press('Escape')
  await expect(page.getByRole('menuitem')).toHaveCount(0)
})

test.describe('duplicare cu scriere reală', () => {
  test.skip(!WRITES, 'necesită E2E_WRITES=1 — testele duplică în proiectul real')

  const admin = serviceClient()
  let snapshot: ProjectSnapshot | null = null

  test.beforeEach(async () => {
    test.skip(!admin, 'lipsesc datele de service din .env.local, deci nu pot curăța după test')
    snapshot = await snapshotProject(admin!, PROJECT)
  })

  test.afterEach(async () => {
    if (admin && snapshot) await restoreProject(admin, PROJECT, snapshot)
  })

  test('faza duplicată apare sub original, în pregătire, și intră în redenumire', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))

    await login(page)
    await openPhasesView(page)
    const phaseName = await firstPhaseName(page)
    await expandPhaseInCenter(page, phaseName)

    // meniul din antetul fazei, din panoul central
    await page.getByRole('button', { name: `Acțiuni pentru faza ${phaseName}`, exact: true }).last().click()
    await page.getByRole('menuitem', { name: 'Duplică' }).first().click()

    // copia intră direct în redenumire, cu numele „<nume> (copie)”
    const renameInput = page.getByPlaceholder('Nume fază...')
    await expect(renameInput).toBeVisible({ timeout: 30_000 })
    await expect(renameInput).toHaveValue(`${phaseName} (copie)`)

    await renameInput.fill('Fază redenumită de test')
    await renameInput.press('Enter')
    await expect(page.getByText('Fază redenumită de test', { exact: true }).first()).toBeVisible({ timeout: 20_000 })

    // copia rămâne ciornă: clientul n-o vede până la publicare
    const copy = await admin!.from('project_phases')
      .select('visibility, order_index, project_id').eq('name', 'Fază redenumită de test').single()
    expect(copy.data?.visibility).toBe('draft')

    const source = await admin!.from('project_phases')
      .select('order_index').eq('project_id', PROJECT).eq('name', phaseName).single()
    expect(copy.data?.order_index).toBe((source.data?.order_index ?? 0) + 1)

    expect(errors).toEqual([])
  })

  test('activitatea duplicată își ia cererile, dar nu și fișierele clientului', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))

    const target = await phaseWithActivities(admin!, PROJECT)
    test.skip(!target, 'proiectul de test nu are nicio fază cu activități')

    await login(page)
    await openPhasesView(page)
    await expandPhaseInCenter(page, target!.phaseName)

    const activityName = target!.activity.name
    await page.getByRole('button', { name: `Acțiuni pentru activitatea ${activityName}`, exact: true }).last().click()
    await page.getByRole('menuitem', { name: 'Duplică' }).first().click()

    const renameInput = page.getByPlaceholder('Nume activitate...')
    await expect(renameInput).toBeVisible({ timeout: 30_000 })
    await expect(renameInput).toHaveValue(`${activityName} (copie)`)
    await renameInput.press('Escape')

    // în baza de date: aceleași cereri, fără nicio versiune încărcată de client
    const copy = await admin!.from('project_activities')
      .select('id, visibility, deadline_at, assigned_to')
      .eq('phase_id', target!.phaseId).eq('name', `${activityName} (copie)`).single()
    expect(copy.data?.visibility).toBe('draft')

    const sourceRequests = await admin!.from('document_requirements')
      .select('id').eq('activity_id', target!.activity.id).is('deleted_at', null)
    const copyRequests = await admin!.from('document_requirements')
      .select('id').eq('activity_id', copy.data!.id).is('deleted_at', null)
    expect(copyRequests.data?.length).toBe(sourceRequests.data?.length)

    const copyFiles = await admin!.from('files')
      .select('id').in('requirement_id', (copyRequests.data ?? []).map(r => r.id))
    expect(copyFiles.data?.length ?? 0).toBe(0)

    expect(errors).toEqual([])
  })
})
