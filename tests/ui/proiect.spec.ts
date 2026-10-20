import { test, expect } from '@playwright/test'
import { autentifica, uiConfig, ascultaErorile, ecranSanatos, derulareOrizontala } from './helpers'

const { projectId } = uiConfig()

test.describe('Pagina proiectului', () => {
  test.skip(!projectId, 'E2E_PROJECT_ID lipsește din .env.e2e.local')

  test.beforeEach(async ({ page }) => {
    await autentifica(page, 'staff')
    await page.goto(`/projects/${projectId}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
  })

  test('are o singură bară de navigare, nu două', async ({ page }) => {
    // Antetul propriu al paginii a fost înlocuit cu fâșia de locație.
    await expect(page.getByRole('navigation', { name: 'Locație' })).toHaveCount(1)
    await expect(page.getByRole('navigation', { name: 'Navigare principală' })).toHaveCount(1)
    const loc = page.getByRole('navigation', { name: 'Locație' })
    await expect(loc.getByRole('link', { name: 'Proiecte' })).toBeVisible()
  })

  test('tabelul arată toate fazele ca grupuri, cu numele întregi', async ({ page }) => {
    const titluri = page.locator('main section[id^="phase-"] h2')
    const n = await titluri.count()
    test.skip(n === 0, 'proiectul nu are faze')

    // Niciun nume de fază nu e tăiat: `truncate` ar face scrollWidth > clientWidth.
    const taiate = await titluri.evaluateAll(els =>
      els.filter(el => (el as HTMLElement).scrollWidth > (el as HTMLElement).clientWidth + 1).length)
    expect(taiate, 'numele fazelor nu au voie să fie trunchiate').toBe(0)
    const nume = (await titluri.allTextContents()).map(t => t.trim())
    expect(nume.filter(t => t.endsWith('…') || t.endsWith('...'))).toEqual([])
  })

  test('starea unei activități are culoare, iconiță și cuvânt', async ({ page }) => {
    const rand = page.locator('main [id^="activity-"]').first()
    test.skip(await rand.count() === 0, 'proiectul nu are activități')
    // Celula de stare e plină, ca în monday, dar nu se sprijină doar pe culoare.
    const stare = rand.locator('span.whitespace-nowrap').filter({ has: page.locator('svg') }).first()
    await expect(stare).toBeVisible()
    await expect(stare).toHaveText(/\S/)
  })

  test('săgeata deschide cererile ca sub-rânduri, iar clic pe una deschide fișa', async ({ page }) => {
    const sageata = page.getByRole('button', { name: /^Extinde activitatea/ }).first()
    test.skip(await sageata.count() === 0, 'proiectul nu are activități')
    await sageata.click()
    const cerere = page.locator('main [id^="request-"]').first()
    test.skip(await cerere.count() === 0, 'activitatea n-are cereri')
    await expect(cerere).toBeVisible()
    await cerere.locator('h3').click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 15_000 })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('„Restrânge toate grupurile” lasă doar titlurile și sumarele', async ({ page }) => {
    const buton = page.getByRole('button', { name: 'Restrânge toate grupurile' })
    test.skip(await buton.count() === 0, 'proiectul nu are faze')
    await buton.click()
    await expect(page.locator('main [id^="activity-"]')).toHaveCount(0)
    await page.getByRole('button', { name: 'Extinde toate grupurile' }).click()
    await expect(page.locator('main [id^="activity-"]').first()).toBeVisible()
  })

  test('vederea de detaliu ține fazele la îndemână, cu numele întregi', async ({ page }, info) => {
    await expect(page.getByRole('button', { name: 'Tabel principal' })).toBeVisible()

    const panou = page.getByText('Toate fazele', { exact: true })
    if (info.project.name === 'telefon') {
      // Pe telefon panoul e sertar: se deschide la cerere, ca să nu mănânce
      // lățimea. Închis, nu trebuie nici măcar să fie în ordinea de tab.
      await expect(panou).toBeHidden()
      await page.getByRole('button', { name: /Toate fazele/ }).click()
      await expect(panou).toBeVisible()
    } else {
      // Pe calculator se strânge și se redeschide, ca în monday.
      await expect(panou).toBeVisible()
      await page.getByRole('button', { name: 'Strânge panoul fazelor' }).click()
      await expect(panou).toBeHidden()
      await page.getByRole('button', { name: 'Arată panoul fazelor' }).click()
      await expect(panou).toBeVisible()
    }

    expect(await derulareOrizontala(page)).toBe(false)
  })

  test('taburile proiectului sunt toate acolo', async ({ page }) => {
    for (const eticheta of [/Faze/, /Documente/, /Calendar/]) {
      await expect(page.getByRole('button', { name: eticheta }).first()).toBeVisible()
    }
  })

  test('chatul de proiect se deschide și randează mesaje', async ({ page }) => {
    await page.getByRole('button', { name: /^Chat/ }).first().click()
    await page.waitForTimeout(2000)
    await expect(page.getByPlaceholder(/Scrie un mesaj/)).toBeVisible()
  })

  test('ecranul e sănătos', async ({ page }) => {
    const erori = ascultaErorile(page)
    await ecranSanatos(page)
    expect(erori.filter(e => !e.includes('Missing Authorization'))).toEqual([])
  })
})
