import { test, expect } from '@playwright/test'
import { autentifica, ascultaErorile, ecranSanatos } from './helpers'

test.describe('Ecranele de administrare', () => {
  test.beforeEach(async ({ page }) => { await autentifica(page, 'admin') })

  test('utilizatorii: lista e pagina, formularul stă într-un panou', async ({ page }) => {
    await page.goto('/admin/users', { waitUntil: 'networkidle' })

    await expect(page.getByRole('heading', { name: 'Utilizatori', level: 1 })).toBeVisible()
    // Lista se vede fără să derulezi: formularul nu mai stă deasupra ei.
    await expect(page.getByLabel('Caută utilizatori')).toBeVisible()
    await expect(page.locator('select[id^="rol-"]').first()).toBeVisible()

    // Nicio casetă „Total utilizatori": cifrele stau în propoziția de sub titlu.
    await expect(page.getByText(/conturi? ·/)).toBeVisible()

    const adauga = page.getByRole('button', { name: /Adaugă utilizator/ }).first()
    await adauga.click()
    const panou = page.getByRole('dialog', { name: 'Adaugă utilizator' })
    await expect(panou).toBeVisible()
    // Tipul de cont e un grup de butoane radio normale, nu trei carduri uriașe.
    await expect(panou.getByRole('radio', { name: 'Client (firmă)' })).toBeVisible()
    await expect(panou.getByRole('radio', { name: 'Consultant' })).toBeVisible()
    await expect(panou.getByRole('radio', { name: 'Administrator' })).toBeVisible()
    // Ajutorul e text vizibil, nu tooltip la hover.
    await panou.getByRole('radio', { name: 'Client (firmă)' }).check()
    await expect(panou.getByText('Ex.: RO12345678')).toBeVisible()
    await panou.getByRole('button', { name: 'Închide panoul' }).click()
    await expect(panou).toBeHidden()
  })

  test('utilizatorii: căutarea și filtrul după rol funcționează', async ({ page }) => {
    await page.goto('/admin/users', { waitUntil: 'networkidle' })
    const randuri = page.locator('select[id^="rol-"]')
    const total = await randuri.count()
    test.skip(total === 0, 'nu există utilizatori')

    await page.getByRole('button', { name: 'Consultant', exact: true }).click()
    const dupaFiltru = await randuri.count()
    expect(dupaFiltru).toBeLessThanOrEqual(total)

    await page.getByRole('button', { name: 'Toate', exact: true }).click()
    await expect(randuri).toHaveCount(total)

    await page.getByLabel('Caută utilizatori').fill('zzz-nu-exista')
    await expect(page.getByText('Niciun utilizator nu se potrivește')).toBeVisible()
  })

  test('tabloul de bord e un registru, nu un card', async ({ page }) => {
    await page.goto('/admin/proiecte', { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { name: 'Tablou de bord', level: 1 })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Locație' })).toBeVisible()

    // Capetele de coloană sunt butoane de sortare, cu stare anunțată.
    // Se caută în `th`: „Proiecte” din comutatorul de vedere ar prinde altfel.
    const proiect = page.locator('th').getByRole('button', { name: 'Proiect', exact: true })
    await expect(proiect).toBeVisible()
    await proiect.click()
    await expect(page.locator('th[aria-sort]:not([aria-sort="none"])')).toHaveCount(1)

    // Comutatorul Proiecte / Consultanți își spune starea.
    const consultanti = page.getByRole('button', { name: 'Consultanți', exact: true })
    await expect(consultanti).toHaveAttribute('aria-pressed', 'false')
    await consultanti.click()
    await expect(consultanti).toHaveAttribute('aria-pressed', 'true')
  })

  test('șabloanele: cifrele într-o propoziție, fazele într-o listă', async ({ page }) => {
    await page.goto('/admin', { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { name: 'Șabloane', level: 1 })).toBeVisible()
    await expect(page.getByText(/\d+ (șablon|șabloane) · \d+ (fază|faze) · \d+/)).toBeVisible()
    // Acțiunile au urcat în fâșia de locație.
    await expect(page.getByRole('link', { name: /Șablon nou/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /Proiect nou/ })).toBeVisible()
  })

  test('statusurile: listă pe linii, cu ordinea salvabilă', async ({ page }) => {
    await page.goto('/admin/statuses', { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { name: 'Statusuri', level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: /Status nou/ })).toBeVisible()
  })

  test('jurnalul de audit nu are etichetă deasupra titlului', async ({ page }) => {
    await page.goto('/admin/audit', { waitUntil: 'networkidle' })
    const h1 = page.getByRole('heading', { name: /Jurnal de audit/, level: 1 })
    await expect(h1).toBeVisible()
    const inainte = await h1.evaluate(el => el.previousElementSibling?.textContent?.trim() ?? '')
    expect(inainte, 'eticheta „ADMINISTRARE" a fost scoasă').toBe('')
    // Cifrele stau în propoziția de sub titlu, nu în patru casete.
    await expect(page.getByText(/acțiuni înregistrate|ordine cronologică/)).toBeVisible()
  })

  for (const [nume, ruta] of [
    ['utilizatori', '/admin/users'],
    ['tablou de bord', '/admin/proiecte'],
    ['șabloane', '/admin'],
    ['statusuri', '/admin/statuses'],
    ['audit', '/admin/audit'],
  ] as const) {
    test(`${nume}: ecran sănătos`, async ({ page }) => {
      const erori = ascultaErorile(page)
      await page.goto(ruta, { waitUntil: 'networkidle' })
      await page.waitForTimeout(1200)
      await ecranSanatos(page)
      expect(erori.filter(e => !e.includes('Missing Authorization'))).toEqual([])
    })
  }
})
