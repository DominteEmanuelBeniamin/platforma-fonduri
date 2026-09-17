import { test, expect } from '@playwright/test'
import { autentifica, uiConfig, elementeIesiteDinEcran, derulareOrizontala, tinteSubMinim } from './helpers'

const { projectId } = uiConfig()

/**
 * Lățimile la care se rupe macheta.
 *
 * Nu sunt telefoane, sunt **praguri**. Un bug de așezare nu apare pe „Pixel 7”,
 * apare la lățimea la care o regulă CSS se aprinde sau se stinge — de aceea
 * fiecare breakpoint Tailwind folosit în proiect e prins de două ori, cu un
 * pixel sub el și fix pe el. Restul lățimilor sunt cele reale: 320 e cel mai
 * îngust ecran care se mai vinde (și ținta de reflow din WCAG 1.4.10), 360 e
 * cea mai răspândită lățime de Android, 390 și 412 sunt iPhone-ul și Pixel-ul.
 *
 * Toate rulează într-un singur browser, într-un singur test per ecran. Un
 * proiect Playwright separat pentru fiecare lățime ar înmulți timpul de rulare
 * cu unsprezece ca să afle exact același lucru.
 */
const LATIMI = [320, 360, 390, 412, 639, 640, 767, 768, 1024, 1440] as const
const INALTIME = 900

test.describe('Macheta, la toate lățimile', () => {
  test.skip(({ isMobile }) => isMobile, 'măturarea își pune singură fereastra; pe proiectele de telefon ar fi o repetare')

  /**
   * Trece un ecran prin toate lățimile și adună ce se strică, în loc să cadă la
   * primul prag. Un raport cu toate lățimile deodată se repară dintr-o dată;
   * unul care se oprește la 320 te pune să rulezi de zece ori.
   */
  async function matura(page: import('@playwright/test').Page, ruta: string) {
    const stricate: string[] = []
    for (const latime of LATIMI) {
      await page.setViewportSize({ width: latime, height: INALTIME })
      // Fără pauză fixă: se așteaptă titlul, singurul semn că macheta s-a așezat.
      await expect(page.locator('h1').first()).toBeVisible({ timeout: 20_000 })

      const iesite = await elementeIesiteDinEcran(page)
      if (iesite.length > 0) stricate.push(`${latime}px → ${iesite.join(' | ')}`)
      if (await derulareOrizontala(page)) stricate.push(`${latime}px → corpul paginii derulează lateral`)
      if (await page.locator('h1').count() !== 1) stricate.push(`${latime}px → ${await page.locator('h1').count()} titluri de nivel 1`)
    }
    expect(stricate, `macheta lui ${ruta} pe lățimile ${LATIMI.join('/')}`).toEqual([])
  }

  test('acasă', async ({ page }) => {
    await autentifica(page, 'staff')
    await matura(page, '/')
  })

  test('tabloul de bord — cel mai lat tabel din aplicație', async ({ page }) => {
    await autentifica(page, 'admin')
    await page.goto('/admin/proiecte', { waitUntil: 'networkidle' })
    await matura(page, '/admin/proiecte')
  })

  test('utilizatori', async ({ page }) => {
    await autentifica(page, 'admin')
    await page.goto('/admin/users', { waitUntil: 'networkidle' })
    await matura(page, '/admin/users')
  })

  test('pagina proiectului — cel mai dens ecran', async ({ page }) => {
    test.skip(!projectId, 'E2E_PROJECT_ID lipsește din .env.e2e.local')
    await autentifica(page, 'staff')
    await page.goto(`/projects/${projectId}`, { waitUntil: 'networkidle' })
    await matura(page, `/projects/${projectId}`)
  })

  test('la 320px conținutul curge într-o coloană, fără derulare în două direcții', async ({ page }) => {
    // WCAG 1.4.10 (Reflow): la 320px echivalent, conținutul nu are voie să ceară
    // derulare pe ambele axe. E și criteriul care descrie ce se întâmplă când un
    // utilizator mărește pagina la 400% pe desktop, nu doar telefonul îngust.
    await autentifica(page, 'staff')
    await page.setViewportSize({ width: 320, height: 568 })
    await expect(page.locator('h1').first()).toBeVisible()

    expect(await derulareOrizontala(page), 'derulare pe a doua axă la 320px').toBe(false)
    expect(await elementeIesiteDinEcran(page), 'elemente ieșite din ecran la 320px').toEqual([])

    // Plăcuțele trec pe o coloană, cum scrie DESIGN.md: două plăcuțe alăturate
    // la 320px ar însemna 150px fiecare, sub măsura minimă de citit.
    const placute = page.locator('a[href^="/projects/"]')
    const n = await placute.count()
    if (n >= 2) {
      const [a, b] = [await placute.nth(0).boundingBox(), await placute.nth(1).boundingBox()]
      expect(b!.y, 'plăcuțele stau una sub alta, nu alături').toBeGreaterThan(a!.y + a!.height - 2)
    }
  })

  test('telefonul întors pe orizontală rămâne folosibil', async ({ page }) => {
    // 844×390: iPhone-ul în peisaj. Înălțimea de 390px e capcana — orice panou
    // cu `h-screen` și antet fix rămâne cu treizeci de pixeli pentru conținut.
    await autentifica(page, 'staff')
    await page.setViewportSize({ width: 844, height: 390 })
    await expect(page.locator('h1').first()).toBeVisible()

    expect(await derulareOrizontala(page)).toBe(false)
    expect(await elementeIesiteDinEcran(page)).toEqual([])
    expect(await tinteSubMinim(page), 'ținte sub 24×24 px în peisaj').toEqual([])

    // Navigarea rămâne la locul ei, nu mănâncă tot ecranul scund.
    const nav = page.getByRole('navigation', { name: 'Navigare principală' })
    const cutie = (await nav.boundingBox())!
    expect(cutie.height, 'bara de navigare nu ia mai mult de un sfert din înălțime').toBeLessThanOrEqual(390 * 0.25)
  })
})
