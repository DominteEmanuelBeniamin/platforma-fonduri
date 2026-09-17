import { test, expect } from '@playwright/test'
import {
  autentifica, uiConfig, ascultaErorile,
  tinteSubMinim, derulareOrizontala, culoriStraine, fontulAplicat,
  RUTE_APLICATIE as RUTE,
} from './helpers'

const { projectId } = uiConfig()

/**
 * Paleta programului de semnalizare, din `app/globals.css`. Orice culoare
 * desenată în afara ei e o scăpare — fie o clasă Tailwind rămasă, fie un hex
 * scris direct în cod, cum erau culorile din modulul Drive.
 */
const PALETA = new Set([
  '#f5f4f0', '#edebe5', '#ffffff', '#d9d6cd', '#b4afa2',
  '#16181c', '#4a4f57', '#6b7079',
  '#0e4c4a', '#e3ecea', '#0a3937',
  '#7a5b12', '#8e3b2a', '#5b3a63', '#4a5a24', '#2f4858',
  '#f2eddf', '#f4e6e2', '#ede7ef', '#ebeee2', '#e6eaed',
  '#1f6b3a', '#e4efe8', '#8a5a08', '#f4ebdc', '#9b2c21', '#f5e4e1', '#eae9e5',
  '#000000',
])


test.describe('Sistemul de design, pe toate rutele', () => {
  for (const [nume, ruta, rol] of RUTE) {
    test(`${nume}`, async ({ page }) => {
      const erori = ascultaErorile(page)
      await autentifica(page, rol)
      await page.goto(ruta, { waitUntil: 'networkidle' })
      await page.waitForTimeout(1500)

      expect(await fontulAplicat(page), 'fontul de semnalizare').toMatch(/signage/i)
      expect(await derulareOrizontala(page), 'derulare orizontală a corpului').toBe(false)
      expect(await tinteSubMinim(page), 'ținte sub 24×24 px').toEqual([])
      expect(await page.locator('h1').count(), 'exact un titlu de nivel 1').toBe(1)

      expect(await culoriStraine(page), 'culori din afara paletei, venite din foaia de stil').toEqual([])

      expect(
        erori.filter(e => !e.includes('Missing Authorization') && !e.includes('404')),
        'erori de pagină',
      ).toEqual([])
    })
  }

  test('pagina proiectului', async ({ page }) => {
    test.skip(!projectId, 'E2E_PROJECT_ID lipsește')
    const erori = ascultaErorile(page)
    await autentifica(page, 'staff')
    await page.goto(`/projects/${projectId}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)

    expect(await derulareOrizontala(page)).toBe(false)
    expect(await tinteSubMinim(page)).toEqual([])
    expect(await culoriStraine(page), 'culori din afara paletei').toEqual([])
    expect(erori.filter(e => !e.includes('Missing Authorization'))).toEqual([])
  })

  test('scrimul de dialog întunecă, nu acoperă', async ({ page }) => {
    await autentifica(page, 'staff')
    await page.getByRole('button', { name: 'Filtre' }).click()
    const scrim = page.locator('[role="dialog"]').locator('xpath=preceding-sibling::div[1]')
    await expect(scrim).toBeVisible()
    const fundal = await scrim.evaluate(el => getComputedStyle(el).backgroundColor)
    // Trebuie să fie translucid: harta de paletă a înghițit odată opacitatea
    // și scrimurile deveniseră negru opac.
    expect(fundal, 'scrimul trebuie să fie translucid').toMatch(/rgba?\([^)]*0\.\d+\)/)
  })

  test('culoarea nu poartă niciodată singură informația', async ({ page }) => {
    await autentifica(page, 'staff')
    await page.waitForTimeout(1500)
    // Fiecare insignă de stare are text pe lângă culoare.
    const fara = await page.evaluate(() => {
      const rele: string[] = []
      for (const el of Array.from(document.querySelectorAll('a[href^="/projects/"] span'))) {
        const s = getComputedStyle(el)
        const areFond = s.backgroundColor !== 'rgba(0, 0, 0, 0)'
        const areText = (el.textContent ?? '').trim().length > 0
        if (areFond && !areText && el.querySelectorAll('svg').length === 0) {
          rele.push(el.className.toString().slice(0, 50))
        }
      }
      return rele
    })
    expect(fara, 'pete de culoare fără cuvânt și fără iconiță').toEqual([])
  })
})
