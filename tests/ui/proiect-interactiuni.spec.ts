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

  test('S-01: sumarul spune „Total”, iar cu grupul strâns antetul coloanelor rămâne', async ({ page }) => {
    const withRows = page.locator('main section[id^="phase-"]').filter({ has: page.locator('[id^="activity-"]') }).first()
    const group = page.locator(`#${await withRows.getAttribute('id')}`)
    await expect(group.getByText(/^Total:?$/)).toBeVisible()
    await page.getByRole('button', { name: 'Restrânge toate grupurile' }).click()
    await expect(group.locator('[id^="activity-"]')).toHaveCount(0)
    await expect(group.getByText('Status', { exact: true })).toBeVisible()
    await expect(group.getByText('Documente', { exact: true })).toBeVisible()
    await expect(group.locator('[role="img"][data-tooltip^="Activitățile pe stări:"]')).toHaveCount(1)
  })

  test('S-04: la cereri, „Vizibil clientului” e ultima coloană, ca la activități', async ({ page }) => {
    await page.getByRole('button', { name: /^Extinde activitatea/ }).first().click()
    const header = page.locator('main [id^="activity-"] div[aria-hidden="true"]').filter({ hasText: 'Cerere' }).first()
    await expect(header).toBeVisible()
    const labels = (await header.locator('span').allInnerTexts()).map(t => t.trim()).filter(Boolean)
    // Aceeași ordine ca la activități: Încărcat sub Documente, Termen sub Termen.
    expect(labels).toEqual(['Cerere', 'Status', 'Încărcat', 'Termen', 'Vizibil clientului'])
  })

  test('S-07: pe calculator nu există butonul „Panoul fazelor” din bara de sus', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Toate fazele: reordonare, activități, echipă' })).toBeHidden()
    await expect(page.getByRole('button', { name: 'Strânge panoul fazelor' })).toBeVisible()
  })

  test('S-03: ochiul „Vizibil clientului” are tooltip și o țintă de cel puțin 24 px', async ({ page }) => {
    const eye = page.locator('main [id^="activity-"] [data-tooltip^="Vizibil clientului"]').first()
    const box = await eye.boundingBox()
    expect(box!.width).toBeGreaterThanOrEqual(24)
    expect(box!.height).toBeGreaterThanOrEqual(24)
    await page.mouse.move(box!.x + 3, box!.y + 3)
    await expect(page.locator('#sg-tooltip')).toHaveText(/Vizibil clientului/, { timeout: 3000 })
  })

  test('S-12/S-18: cererile au „⋯”, iar toate „⋯” au tooltip scurt și nume lung', async ({ page }) => {
    await page.getByRole('button', { name: /^Extinde activitatea/ }).first().click()
    const request = page.locator('main [id^="request-"]').first()
    await expect(request.getByRole('button', { name: /^Acțiuni pentru cererea/ })).toHaveAttribute('data-tooltip', 'Acțiuni cerere')
    await expect(request.getByRole('button', { name: 'Șterge din proiect' })).toHaveCount(0)
    const tooltips = await page.locator('button[aria-haspopup="menu"]').evaluateAll(els =>
      els.map(el => el.getAttribute('data-tooltip') ?? ''))
    expect(tooltips.length).toBeGreaterThan(3)
    for (const t of tooltips) expect(t, 'tooltip-ul „⋯” nu poartă numele elementului').toMatch(/^(Acțiuni( fază| activitate| cerere| document)?|Mai multe acțiuni)$/)
  })
})

test.describe('Tabelul proiectului: feedback-ul din 22 octombrie', () => {
  test.skip(!projectId, 'E2E_PROJECT_ID lipsește')

  test.beforeEach(async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'coloanele și bara lipită există doar pe ecran lat')
    await autentifica(page, 'admin')
    await deschideProiectul(page)
  })

  test('termenele, stările și documentele cererilor stau sub cele ale activității', async ({ page }) => {
    const row = page.locator('main [id^="activity-"]').filter({ has: page.locator('[id^="request-"]') }).first()
      .or(page.locator('main [id^="activity-"]').first())
    await row.first().getByRole('button', { name: /^Extinde activitatea/ }).click()
    const activity = page.locator('main [id^="activity-"]').filter({ has: page.locator('[id^="request-"]') }).first()
    const centru = async (loc: import('@playwright/test').Locator) => { const b = (await loc.boundingBox())!; return b.x + b.width / 2 }
    const header = activity.locator('xpath=ancestor::section[1]').locator('div[aria-hidden="true"]').first()
    const subheader = activity.locator('div[aria-hidden="true"]').filter({ hasText: 'Cerere' }).first()
    for (const [sus, jos] of [['Status', 'Status'], ['Documente', 'Încărcat'], ['Termen', 'Termen'], ['Vizibil clientului', 'Vizibil clientului']]) {
      const a = await centru(header.getByText(sus, { exact: true }))
      const b = await centru(subheader.getByText(jos, { exact: true }))
      expect(Math.abs(a - b), `„${jos}” sub „${sus}”`).toBeLessThan(2)
    }
  })

  test('„Cereri generale” arată doar cererile, fără documentele trimise', async ({ page }) => {
    await page.locator('aside nav').getByText('Cereri generale', { exact: true }).click()
    await expect(page.locator('main section#phase-__trimise__')).toHaveCount(0)
    await page.locator('aside nav').getByText('Documente trimise clientului', { exact: true }).click()
    await expect(page.locator('main section#phase-__trimise__')).toBeVisible()
  })

  test('altă vedere pornește de sus, iar „Chat” stă în bara lipită', async ({ page }) => {
    await page.mouse.wheel(0, 2000)
    await page.waitForTimeout(300)
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(500)
    await page.getByRole('button', { name: /^Ce ai de făcut/ }).click()
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(5)
    await page.getByRole('button', { name: /^Tabel principal/ }).click()
    await page.mouse.wheel(0, 2000)
    await page.waitForTimeout(300)
    const chat = page.getByRole('button', { name: /^Chat/ })
    await expect(chat).toBeInViewport()
  })
})

test.describe('Tabelul proiectului: documentele trimise, separat de cererile generale (S-20)', () => {
  test.skip(!projectId, 'E2E_PROJECT_ID lipsește')

  for (const [rol, titlu] of [['admin', 'Documente trimise clientului'], ['client', 'Documente de la consultant']] as const) {
    test(`ca ${rol}: „${titlu}” e grup separat, fără fundal verde`, async ({ page }) => {
      await autentifica(page, rol)
      await deschideProiectul(page)
      const sent = page.locator('main section#phase-__trimise__')
      const general = page.locator('main section[id^="phase-"]').filter({ has: page.getByRole('heading', { name: 'Cereri generale' }) })
      await expect(sent.getByRole('heading', { name: titlu })).toBeVisible()
      // Titlul echipei nu ajunge la client (Z-05).
      if (rol === 'client') await expect(page.getByText('Documente trimise clientului')).toHaveCount(0)
      // Cererile generale nu mai conțin documentele trimise.
      await expect(general.locator('[id^="request-"]').filter({ has: page.getByText('Trimis la') })).toHaveCount(0)
      const fundaluri = await sent.locator('*').evaluateAll(els => {
        const probe = document.createElement('div')
        probe.style.background = 'var(--sg-ok-soft)'
        document.body.append(probe)
        const ok = getComputedStyle(probe).backgroundColor
        probe.remove()
        return els.filter(el => getComputedStyle(el).backgroundColor === ok).length
      })
      expect(fundaluri, 'verdele e semnal de stare, nu decor').toBe(0)
      if (rol === 'admin') await expect(sent.getByRole('button', { name: 'Trimite documente' })).toBeVisible()
      else await expect(page.getByRole('button', { name: 'Trimite documente' })).toHaveCount(0)
    })
  }
})
