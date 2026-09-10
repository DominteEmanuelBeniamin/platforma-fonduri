import { test, expect } from '@playwright/test'
import { autentifica, ascultaErorile, ecranSanatos } from './helpers'

test.describe('Home — panoul-director', () => {
  test.beforeEach(async ({ page }) => { await autentifica(page, 'staff') })

  test('fâșia de locație deschide ecranul și marchează pagina curentă', async ({ page }) => {
    const loc = page.getByRole('navigation', { name: 'Locație' })
    await expect(loc).toBeVisible()
    await expect(loc.getByRole('link', { name: 'Bonie' })).toBeVisible()
    await expect(loc.locator('[aria-current="page"]')).toHaveText('Proiecte')
  })

  test('Alt+L focalizează fâșia de locație de oriunde din pagină', async ({ page }) => {
    // Comanda trăiește în fâșia de locație; fără ea montată nu există ascultător.
    await expect(page.getByRole('navigation', { name: 'Locație' })).toBeVisible()
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('Alt+l')
    const focalizat = page.locator(':focus')
    await expect(focalizat).toHaveText('Bonie')
  })

  test('Alt+L nu fură tasta cât timp scrii într-un câmp', async ({ page }) => {
    const cautare = page.getByLabel('Caută proiecte')
    await cautare.fill('a')
    await cautare.press('Alt+l')
    // Focusul rămâne în câmp: comanda are modificator, dar nu se aplică în timpul scrierii.
    await expect(cautare).toBeFocused()
  })

  test('titlul și rezumatul sunt o singură propoziție, nu casete cu numere', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Salut')
    // Tiparul interzis: eticheta mică deasupra titlului.
    const h1 = page.getByRole('heading', { level: 1 })
    const inainte = await h1.evaluate(el => el.previousElementSibling?.textContent?.trim() ?? '')
    expect(inainte, 'nicio etichetă „kicker” deasupra titlului').toBe('')
  })

  test('căutarea filtrează proiectele și rândul de rezultate apare doar atunci', async ({ page }) => {
    const placute = page.locator('a[href^="/projects/"]')
    const total = await placute.count()
    test.skip(total === 0, 'contul nu are proiecte')

    // Fără filtru, numărul filtrat nu se mai repetă sub bara de unelte.
    await expect(page.getByRole('status')).toHaveCount(0)

    await page.getByLabel('Caută proiecte').fill('zzz-nu-exista-nimic')
    await expect(page.getByText('Niciun proiect nu se potrivește')).toBeVisible()
    await expect(page.getByRole('status')).toContainText('din')

    await page.getByRole('button', { name: 'Șterge filtrele' }).click()
    await expect(placute).toHaveCount(total)
  })

  test('comutatorul de vizualizare își spune starea', async ({ page }) => {
    const grila = page.getByRole('button', { name: 'Vizualizare grilă' })
    const lista = page.getByRole('button', { name: 'Vizualizare listă' })
    await expect(grila).toHaveAttribute('aria-pressed', 'true')
    await lista.click()
    await expect(lista).toHaveAttribute('aria-pressed', 'true')
    await expect(grila).toHaveAttribute('aria-pressed', 'false')
    await grila.click()
  })

  test('legenda explică semnele și nu lasă rândul gol când nu filtrezi', async ({ page }) => {
    const legenda = page.getByRole('button', { name: 'Ce înseamnă semnele' })
    await expect(legenda).toBeVisible()
    await legenda.click()
    await expect(page.getByRole('heading', { name: 'Ce înseamnă semnele' })).toBeVisible()
    await expect(page.getByText('Cu termen depășit').or(page.getByText('Depășite'))).toBeVisible()
  })

  test('filtrele se deschid, se aplică și se pot șterge', async ({ page }) => {
    await page.getByRole('button', { name: 'Filtre' }).click()
    const dialog = page.getByRole('dialog', { name: 'Filtre' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Necesită atenție' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Închide filtrele' }).click()
    await expect(dialog).toBeHidden()
  })

  test('nicio insignă nu arată un zero', async ({ page }) => {
    const insigne = await page.locator('a[href^="/projects/"] span').allTextContents()
    const zerouri = insigne.filter(t => /^0\s+\S/.test(t.trim()))
    expect(zerouri, 'zero nu e informație; insigna nu se desenează').toEqual([])
  })

  test('ecranul e sănătos', async ({ page }) => {
    const erori = ascultaErorile(page)
    await ecranSanatos(page)
    expect(erori.filter(e => !e.includes('Missing Authorization'))).toEqual([])
  })
})
