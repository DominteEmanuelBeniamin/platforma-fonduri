import { test, expect } from '@playwright/test'
import { autentifica } from './helpers'

/**
 * Antetul lipit al paginilor din meniu (S-33, S-34) și fâșia de locație doar
 * pe nivelul 2, fără „Bonie” (S-05, S-32). Doar citire.
 */
test.describe('Antetul paginilor', () => {
  test('Șabloane: „Șablon nou” și căutarea rămân la vedere la derulare', async ({ page }, info) => {
    await autentifica(page, 'admin')
    await page.goto('/admin/templates', { waitUntil: 'networkidle' })
    await expect(page.getByRole('navigation', { name: 'Locație' })).toHaveCount(0)
    await expect(page.getByText('Gestionează', { exact: true })).toHaveCount(0)
    const nou = page.getByRole('button', { name: 'Șablon nou' })
    const cautare = page.getByLabel('Caută șabloane')
    await page.mouse.wheel(0, 2500)
    await page.waitForTimeout(400)
    test.skip(await page.evaluate(() => window.scrollY) < 300, 'lista e prea scurtă ca să derulezi')
    if (info.project.name === 'desktop') {
      await expect(nou).toBeInViewport()
      await expect(cautare).toBeInViewport()
      expect(Math.round((await page.locator('main header').first().boundingBox())!.y)).toBe(64)
    } else {
      // Pe telefon antetul derulează cu pagina (D5).
      await expect(nou).not.toBeInViewport()
    }
  })

  test('editorul de șablon: „Șabloane / <nume>”, cu „Șabloane” drum înapoi', async ({ page }) => {
    await autentifica(page, 'admin')
    await page.goto('/admin/templates', { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Șablon nou' }).click()
    const loc = page.getByRole('navigation', { name: 'Locație' })
    await expect(loc).toBeVisible()
    await expect(loc.getByText('Bonie')).toHaveCount(0)
    await expect(loc.locator('[aria-current="page"]')).toHaveText('Șablon nou')
    await loc.getByRole('button', { name: 'Șabloane' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Șabloane' })).toBeVisible()
  })

  for (const url of ['/admin/users', '/admin/proiecte', '/admin/audit', '/admin/statuses', '/notificari', '/my-requests']) {
    test(`${url}: fără fâșie de locație, cu titlul în antet`, async ({ page }) => {
      await autentifica(page, 'admin')
      await page.goto(url, { waitUntil: 'networkidle' })
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expect(page.getByRole('navigation', { name: 'Locație' })).toHaveCount(0)
    })
  }
})
