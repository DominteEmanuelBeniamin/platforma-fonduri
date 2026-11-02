import { test, expect } from '@playwright/test'
import { autentifica } from './helpers'

test('account password validates as you type and keeps the error until valid', async ({ page }) => {
  await autentifica(page, 'admin')
  await page.goto('/cont')
  const password = page.getByLabel('Parola nouă', { exact: true })
  const error = page.locator('#parola-noua-eroare')
  let posts = 0
  await page.route('**/api/me/password', async route => {
    posts++
    await route.abort()
  })
  await expect(error).toHaveCount(0)
  await password.fill('12345678901')
  await expect(password).toHaveAttribute('aria-invalid', 'true')
  await expect(password).toHaveCSS('border-color', 'rgb(155, 44, 33)')
  await expect(error).toContainText('cel puțin 12 caractere')
  await expect(password).toHaveAccessibleDescription(/cel puțin 12 caractere/)
  await page.getByLabel('Parola actuală', { exact: true }).fill('anything')
  await expect(error).toBeVisible()
  await password.fill('123456789012')
  await expect(error).toHaveCount(0)
  await expect(password).not.toHaveAttribute('aria-invalid', 'true')
  await password.fill('ș'.repeat(37))
  await expect(error).toBeVisible()
  await password.fill('ș'.repeat(36))
  await expect(error).toHaveCount(0)
  await password.fill('')
  await expect(error).toBeVisible()
  expect(posts).toBe(0)
})
