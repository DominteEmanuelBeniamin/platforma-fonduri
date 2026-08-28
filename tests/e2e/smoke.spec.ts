import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/**
 * Smoke peste dev server-ul pornit separat (`npm run dev`), cu conturi reale
 * din `.env.e2e.local`. Testele care scriu (upload) rulează numai cu
 * `E2E_WRITES=1`, fiindcă lasă fișiere și versiuni adevărate în proiect.
 */

const ENV_FILE = '.env.e2e.local'
const creds: Record<string, string> = fs.existsSync(ENV_FILE)
  ? Object.fromEntries(fs.readFileSync(ENV_FILE, 'utf8').split('\n')
      .filter(l => l.includes('=') && !l.trim().startsWith('#'))
      .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
  : {}

const PROJECT = creds.E2E_PROJECT_ID || ''
const WRITES = process.env.E2E_WRITES === '1'
const STAFF_READY = !!(PROJECT && creds.E2E_STAFF_EMAIL && creds.E2E_STAFF_PASSWORD)
const CLIENT_READY = !!(PROJECT && creds.E2E_CLIENT_EMAIL && creds.E2E_CLIENT_PASSWORD)

async function login(page: Page, who: 'CLIENT' | 'STAFF') {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.locator('input[type=email]').fill(creds[`E2E_${who}_EMAIL`])
  await page.locator('input[type=password]').fill(creds[`E2E_${who}_PASSWORD`])
  await page.getByRole('button', { name: 'Intră în cont' }).click()
  await page.waitForURL('/', { timeout: 25_000 })
  await page.waitForTimeout(1500)
}

/** Un PDF minim, ca upload-ul să treacă validarea fără să care un fixture în repo. */
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

/**
 * Nu fixa numele cererii: testele de upload chiar mută cererea din „De încărcat”
 * în „În verificare”, deci un nume scris în cod se evaporă după prima rulare.
 */
async function openFirstPendingRequest(page: Page) {
  await page.goto(`/projects/${PROJECT}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(5000)
  const rows = page.locator('button').filter({ hasText: 'De încărcat' })
  test.skip(await rows.count() === 0, 'clientul nu mai are nicio cerere „De încărcat” în proiect')
  const name = (await rows.first().innerText()).split('\n')[0].trim()
  await rows.first().click()
  await page.waitForTimeout(3500)
  return name
}

test('paginile atinse se încarcă fără erori de consolă', async ({ page }) => {
  test.skip(!STAFF_READY, `lipsesc proiectul sau credențialele staff din ${ENV_FILE}`)
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

  await login(page, 'STAFF')
  for (const url of ['/', '/notificari', `/projects/${PROJECT}`]) {
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(4000)
  }
  expect(errors).toEqual([])
})

test('un tip de fișier nepermis e oprit în client, fără să atingă serverul', async ({ page }) => {
  test.skip(!CLIENT_READY, `lipsesc proiectul sau credențialele client din ${ENV_FILE}`)
  const calls: string[] = []
  page.on('request', r => { if (r.url().includes('uploads/init')) calls.push(r.url()) })

  await login(page, 'CLIENT')
  await openFirstPendingRequest(page)
  await page.locator('input[type=file]:not([webkitdirectory])').first()
    .setInputFiles(badFile('smoke-e2e.xyz'))
  await page.waitForTimeout(1500)

  await expect(page.getByText('Tip de fișier nepermis').first()).toBeVisible()
  expect(calls, 'validarea nu are voie să ajungă la server').toEqual([])
})

test.describe('upload real', () => {
  test.skip(!WRITES, 'scrie date reale — rulează cu E2E_WRITES=1')

  test('clientul încarcă din modalul cererii', async ({ page }) => {
    test.skip(!CLIENT_READY, `lipsesc proiectul sau credențialele client din ${ENV_FILE}`)
    const steps: number[] = []
    page.on('response', r => {
      if (r.url().includes('uploads/init') || r.url().includes('uploads/complete')) steps.push(r.status())
    })

    await login(page, 'CLIENT')
    await openFirstPendingRequest(page)
    const dialog = page.locator('[role=dialog]')
    await expect(dialog).toBeVisible()
    await dialog.locator('input[type=file]:not([webkitdirectory])').first()
      .setInputFiles(samplePdf('smoke-e2e.pdf'))
    await dialog.getByRole('button', { name: /^Încarcă \(1\)$/ }).click()
    await page.waitForTimeout(12_000)

    expect(steps, 'init și complete trebuie să răspundă 200').toEqual([200, 200])
    await expect(page.getByText('smoke-e2e.pdf').first()).toBeVisible()
  })

  test('clientul încarcă din panoul paginii', async ({ page }) => {
    test.skip(!CLIENT_READY, `lipsesc proiectul sau credențialele client din ${ENV_FILE}`)
    const steps: number[] = []
    page.on('response', r => {
      if (r.url().includes('uploads/init') || r.url().includes('uploads/complete')) steps.push(r.status())
    })

    await login(page, 'CLIENT')
    await openFirstPendingRequest(page)
    await page.keyboard.press('Escape') // panoul din pagină, nu modalul
    await page.waitForTimeout(1500)
    await expect(page.locator('[role=dialog]')).toHaveCount(0)

    await page.locator('input[type=file]:not([webkitdirectory])').first()
      .setInputFiles(samplePdf('smoke-e2e.pdf'))
    await page.getByRole('button', { name: /^Încarcă \(1\)$/ }).first().click()
    await page.waitForTimeout(12_000)

    expect(steps).toEqual([200, 200])
  })
})

test('filtrul de categorii se poate folosi numai din tastatură', async ({ page }) => {
  test.skip(!STAFF_READY, `lipsesc proiectul sau credențialele staff din ${ENV_FILE}`)
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
  expect(await combo.getAttribute('aria-activedescendant'),
    'săgeata trebuie să mute opțiunea activă').not.toBe(first)

  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)

  await expect(combo).toHaveAttribute('aria-expanded', 'false')
  await expect(combo).toContainText('Publicări')
  expect(await combo.evaluate(el => el === document.activeElement),
    'focusul se întoarce pe control după alegere').toBe(true)

  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Escape')
  await expect(combo).toHaveAttribute('aria-expanded', 'false')
})
