import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  createTemporaryProject,
  destroyTemporaryProject,
  e2eEnv,
  requireE2EConfig,
  serviceClient,
  verifyServerUsesFixture,
  type TemporaryProjectFixture,
} from './helpers/project-state'

/** Smoke E2E peste serverul din configurația dedicată, cu proiect efemer. */
const CONFIG = requireE2EConfig(e2eEnv())
const admin = serviceClient()

async function login(page: Page, who: 'CLIENT' | 'STAFF') {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.locator('input[type=email]').fill(who === 'CLIENT' ? CONFIG.clientEmail : CONFIG.staffEmail)
  await page.locator('input[type=password]').fill(who === 'CLIENT' ? CONFIG.clientPassword : CONFIG.staffPassword)
  await page.getByRole('button', { name: 'Intră în cont' }).click()
  await page.waitForURL('/', { timeout: 25_000 })
  await page.waitForTimeout(1500)
}

async function createFixture(): Promise<TemporaryProjectFixture> {
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

/** Un PDF minim, ca upload-ul să treacă validarea fără fixture în repo. */
function samplePdf(name: string) {
  const file = path.join(os.tmpdir(), name)
  fs.writeFileSync(file, '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')
  return file
}

function badFile(name: string) {
  const file = path.join(os.tmpdir(), name)
  fs.writeFileSync(file, 'nu sunt un tip permis\n')
  return file
}

async function openFirstPendingRequest(page: Page, projectId: string) {
  await page.goto(`/projects/${projectId}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(5000)
  const rows = page.locator('button').filter({ hasText: 'De încărcat' })
  if (await rows.count() === 0) throw new Error('Fixture-ul E2E nu are cerere „De încărcat”')
  const name = (await rows.first().innerText()).split('\n')[0].trim()
  await rows.first().click()
  await page.waitForTimeout(3500)
  return name
}

test.describe('smoke fără scriere de business', () => {
  let fixture: TemporaryProjectFixture | null = null
  test.beforeEach(async () => { fixture = await createFixture() })
  test.afterEach(async () => {
    try {
      if (admin && fixture) await destroyTemporaryProject(admin, fixture)
    } finally {
      fixture = null
    }
  })

  test('paginile atinse se încarcă fără erori de consolă', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

    await login(page, 'STAFF')
    for (const url of ['/', '/notificari', `/projects/${fixture!.projectId}`]) {
      await page.goto(url, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(4000)
    }
    expect(errors).toEqual([])
  })

  test('un tip de fișier nepermis e oprit în client, fără să atingă serverul', async ({ page }) => {
    const calls: string[] = []
    page.on('request', request => { if (request.url().includes('uploads/init')) calls.push(request.url()) })

    await login(page, 'CLIENT')
    await openFirstPendingRequest(page, fixture!.projectId)
    await page.locator('input[type=file]:not([webkitdirectory])').first()
      .setInputFiles(badFile(`smoke-e2e-${fixture!.projectId}.xyz`))
    await page.waitForTimeout(1500)

    await expect(page.getByText('Tip de fișier nepermis').first()).toBeVisible()
    expect(calls, 'validarea nu are voie să ajungă la server').toEqual([])
  })
})

test.describe('upload real pe proiect efemer', () => {
  let fixture: TemporaryProjectFixture | null = null
  test.beforeEach(async () => { fixture = await createFixture() })
  test.afterEach(async () => {
    try {
      if (admin && fixture) await destroyTemporaryProject(admin, fixture)
    } finally {
      fixture = null
    }
  })

  test('clientul încarcă din modalul cererii', async ({ page }) => {
    const steps: number[] = []
    page.on('response', response => {
      if (response.url().includes('uploads/init') || response.url().includes('uploads/complete')) steps.push(response.status())
    })

    await login(page, 'CLIENT')
    await openFirstPendingRequest(page, fixture!.projectId)
    const dialog = page.locator('[role=dialog]')
    await expect(dialog).toBeVisible()
    await dialog.locator('input[type=file]:not([webkitdirectory])').first()
      .setInputFiles(samplePdf(`smoke-e2e-${fixture!.projectId}.pdf`))
    await dialog.getByRole('button', { name: /^Încarcă \(1\)$/ }).click()
    await page.waitForTimeout(12_000)

    expect(steps, 'init și complete trebuie să răspundă 200').toEqual([200, 200])
    await expect(page.getByText(new RegExp(`smoke-e2e-${fixture!.projectId}\\.pdf`)).first()).toBeVisible()
  })

  test('clientul încarcă din panoul paginii', async ({ page }) => {
    const steps: number[] = []
    page.on('response', response => {
      if (response.url().includes('uploads/init') || response.url().includes('uploads/complete')) steps.push(response.status())
    })

    await login(page, 'CLIENT')
    await openFirstPendingRequest(page, fixture!.projectId)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(1500)
    await expect(page.locator('[role=dialog]')).toHaveCount(0)

    await page.locator('input[type=file]:not([webkitdirectory])').first()
      .setInputFiles(samplePdf(`smoke-e2e-panel-${fixture!.projectId}.pdf`))
    await page.getByRole('button', { name: /^Încarcă \(1\)$/ }).first().click()
    await page.waitForTimeout(12_000)

    expect(steps).toEqual([200, 200])
  })
})

test('filtrul de categorii se poate folosi numai din tastatură', async ({ page }) => {
  await login(page, 'STAFF')
  await page.goto('/notificari', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)

  const combo = page.getByRole('combobox', { name: 'Filtrează după categorie' })
  await combo.focus()
  await expect(combo).toHaveAttribute('aria-expanded', 'false')

  await page.keyboard.press('ArrowDown')
  await expect(combo).toHaveAttribute('aria-expanded', 'true')

  const first = await combo.getAttribute('aria-activedescendant')
  await page.keyboard.press('ArrowDown')
  expect(await combo.getAttribute('aria-activedescendant'), 'săgeata trebuie să mute opțiunea activă').not.toBe(first)

  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)

  await expect(combo).toHaveAttribute('aria-expanded', 'false')
  await expect(combo).toContainText('Publicări')
  expect(await combo.evaluate(el => el === document.activeElement), 'focusul se întoarce pe control după alegere').toBe(true)

  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Escape')
  await expect(combo).toHaveAttribute('aria-expanded', 'false')
})
