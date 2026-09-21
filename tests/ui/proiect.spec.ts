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

  test('panoul arată toate fazele, cu numele întregi', async ({ page }) => {
    const randuri = page.locator('[data-rand]')
    const n = await randuri.count()
    test.skip(n === 0, 'proiectul nu are faze')

    // Niciun nume de fază nu e tăiat: `truncate` ar face scrollWidth > clientWidth.
    const taiate = await randuri.evaluateAll(rows =>
      rows.filter(r => {
        const nume = r.querySelector('span.text-sm.font-semibold') as HTMLElement | null
        return !!nume && nume.scrollWidth > nume.clientWidth + 1
      }).length)
    expect(taiate, 'numele fazelor nu au voie să fie trunchiate').toBe(0)
  })

  test('fazele cu nume aproape identice se pot deosebi', async ({ page }) => {
    const nume = await page.locator('[data-rand] span.text-sm.font-semibold').allTextContents()
    test.skip(nume.length === 0, 'proiectul nu are faze')
    const curatate = nume.map(t => t.trim())
    // Dacă două faze au același nume complet, e o problemă de date, nu de UI;
    // dar niciuna nu are voie să se termine în puncte de suspensie.
    expect(curatate.filter(t => t.endsWith('…') || t.endsWith('...'))).toEqual([])
  })

  test('plăcuțele de cerere au nume accesibil și minimul de 24px', async ({ page }) => {
    const placute = page.locator('[data-rand] button[data-pozitie]')
    const n = await placute.count()
    test.skip(n === 0, 'proiectul nu are cereri')

    const prima = placute.first()
    await expect(prima).toHaveAttribute('aria-label', /.+/)
    const cutie = await prima.boundingBox()
    expect(cutie!.width).toBeGreaterThanOrEqual(24)
    expect(cutie!.height).toBeGreaterThanOrEqual(24)

    // Fiecare plăcuță poartă un semn desenat, nu un pătrat gol.
    await expect(prima.locator('svg')).toHaveCount(1)
  })

  test('săgețile se plimbă în rând, Tab sare la rândul următor', async ({ page }) => {
    const placute = page.locator('[data-rand]:has(button[data-pozitie="1"]) button[data-pozitie]')
    test.skip(await placute.count() < 2, 'niciun rând cu cel puțin două cereri')

    await placute.nth(0).focus()
    await expect(placute.nth(0)).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(placute.nth(1)).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await expect(placute.nth(0)).toBeFocused()
    // Doar prima plăcuță din rând e în ordinea de tab.
    expect(await placute.nth(1).getAttribute('tabindex')).toBe('-1')
  })

  test('clic pe plăcuță deschide fișa cererii', async ({ page }) => {
    const placuta = page.locator('[data-rand] button[data-pozitie="0"]').first()
    test.skip(await placuta.count() === 0, 'proiectul nu are cereri')
    await placuta.click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 15_000 })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('vederea de detaliu ține fazele la îndemână, cu numele întregi', async ({ page }, info) => {
    const placuta = page.locator('[data-rand] button[data-pozitie="0"]').first()
    test.skip(await placuta.count() === 0, 'proiectul nu are cereri')
    await placuta.click()
    await page.waitForTimeout(1200)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(800)

    await expect(page.getByRole('button', { name: 'Panoul proiectului' })).toBeVisible()

    const panou = page.getByText('Toate fazele', { exact: true })
    if (info.project.name === 'telefon') {
      // Pe telefon panoul e sertar: se deschide la cerere, ca să nu mănânce
      // lățimea. Închis, nu trebuie nici măcar să fie în ordinea de tab.
      await expect(panou).toBeHidden()
      await page.getByRole('button', { name: /Toate fazele/ }).click()
      await expect(panou).toBeVisible()
    } else {
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
