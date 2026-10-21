import { test, expect, type Page } from '@playwright/test'
import { autentifica, uiConfig } from './helpers'

/**
 * Interacțiunile din tabelul proiectului reparate după feedback-ul lui Sandu
 * (21 octombrie 2026). Doar citire: redenumirile se opresc în browser, înainte
 * de server, iar preferințele din `localStorage` se pun la loc.
 */
const { projectId } = uiConfig()

async function deschideProiectul(page: Page) {
  await page.goto(`/projects/${projectId}`, { waitUntil: 'networkidle' })
  await page.locator('main section[id^="phase-"]').first().waitFor()
}

test.describe('Tabelul proiectului: interacțiuni', () => {
  test.skip(!projectId, 'E2E_PROJECT_ID lipsește')

  test.beforeEach(async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'hover-ul și panoul lateral există doar cu maus, pe ecran lat')
    await autentifica(page, 'admin')
    await deschideProiectul(page)
  })

  test('S-09: „⋯” dispare după ce închizi meniul și pleci de pe rând; de la tastatură se vede', async ({ page }) => {
    const rows = page.locator('main [id^="activity-"]')
    const row = rows.filter({ has: page.getByRole('button', { name: /^Acțiuni pentru activitatea/ }) }).first()
    const menu = row.getByRole('button', { name: /^Acțiuni pentru activitatea/ })
    // Celula rândului care se ascunde: părintele rădăcinii meniului.
    const cell = menu.locator('xpath=../..')

    await row.hover()
    await menu.click()
    await expect(page.getByRole('menu')).toBeVisible()
    await menu.click()
    await expect(page.getByRole('menu')).toHaveCount(0)
    await rows.last().hover()
    await expect(cell).toHaveCSS('opacity', '0')

    // Escape după deschiderea de la tastatură lasă butonul la vedere.
    await page.mouse.move(0, 0)
    const deadline = row.getByRole('button', { name: /termen/i }).first()
    await deadline.focus()
    await page.keyboard.press('Tab')
    await expect(menu).toBeFocused()
    await expect(cell).toHaveCSS('opacity', '1')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menu')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).toBeFocused()
    await expect(cell).toHaveCSS('opacity', '1')
  })

  test('S-11: redenumirea se închide la clic în afară, la „Restrânge toate” și la altă fază', async ({ page }) => {
    const patches: unknown[] = []
    await page.route(`**/api/projects/${projectId}/phases/*`, async route => {
      if (route.request().method() !== 'PATCH') return route.continue()
      patches.push(route.request().postDataJSON())
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    })
    const groups = page.locator('main section[id^="phase-"]')
    const first = groups.first()
    const name = (await first.locator('h2').innerText()).trim()
    const startRename = async () => {
      await first.getByRole('button', { name: /^Acțiuni pentru faza/ }).click()
      await page.getByRole('menuitem', { name: 'Redenumește' }).click()
      const input = first.getByPlaceholder('Nume fază...')
      await expect(input).toBeFocused()
      return input
    }

    // (a) Un nume schimbat se salvează la clic în afară.
    let input = await startRename()
    await input.fill(`${name} — redenumită`)
    await groups.nth(1).locator('h2').click()
    await expect(input).toHaveCount(0)
    expect(patches).toEqual([{ name: `${name} — redenumită` }])

    // (b) Neschimbat, „Restrânge toate grupurile” îl închide fără să salveze.
    input = await startRename()
    await page.getByRole('button', { name: 'Restrânge toate grupurile' }).click()
    await expect(input).toHaveCount(0)
    await page.getByRole('button', { name: 'Extinde toate grupurile' }).click()
    await expect(first.getByPlaceholder('Nume fază...')).toHaveCount(0)

    // (c) Altă fază din panou, apoi înapoi: câmpul nu mai e deschis.
    input = await startRename()
    const panelPhases = page.locator('aside nav [data-tooltip*="în tabel"]')
    await panelPhases.nth(1).click()
    await panelPhases.nth(0).click()
    await expect(page.locator('main section[id^="phase-"]').first().getByPlaceholder('Nume fază...')).toHaveCount(0)

    // (d) Escape renunță, chiar cu numele schimbat.
    await page.getByRole('button', { name: 'Arată toate fazele' }).click()
    input = await startRename()
    await input.fill('Nu se salvează')
    await input.press('Escape')
    await expect(input).toHaveCount(0)
    expect(patches, 'doar redenumirea de la (a) a plecat spre server').toHaveLength(1)
  })

  test('S-13: „Arată și ce e finalizat” rămâne pe ecran după clic, cu o preferință veche', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('bonie:arata-finalizate', '1'))
    try {
      await deschideProiectul(page)
      const toggle = page.getByRole('checkbox', { name: /Arată și ce e finalizat/ })
      test.skip(await toggle.count() === 0, 'proiectul n-are nimic finalizat')
      await expect(toggle).toBeChecked()
      await toggle.click()
      await expect(toggle).toBeVisible()
      await expect(toggle).not.toBeChecked()
      await toggle.click()
      await expect(toggle).toBeChecked()
    } finally {
      await page.evaluate(() => localStorage.removeItem('bonie:arata-finalizate'))
    }
  })
})
