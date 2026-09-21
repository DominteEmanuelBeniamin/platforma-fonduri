import { test, expect } from '@playwright/test'
import {
  autentifica, uiConfig, ascultaErorile,
  tinteSubMinim, elementeIesiteDinEcran, campuriCareFacZoom,
  controaleAscunseDeHover, incapePeEcran, derulareOrizontala,
  RUTE_APLICATIE,
} from './helpers'

const { projectId } = uiConfig()

/**
 * Pragurile sunt ale foilor de stil, nu ale testului: Tailwind deschide `sm:`
 * la 640px și `md:` la 768px, iar aplicația își schimbă macheta exact acolo —
 * sub 640px notificările sunt foaie de jos, sub 768px panoul de faze e sertar
 * și chatul arată o singură coloană. Un test care ghicește altă lățime ar cădea
 * pe tabletă fără să fie nimic stricat.
 */
const SM = 640
const MD = 768

/**
 * Suita de telefon.
 *
 * Rulează doar pe proiectele cu ecran tactil (`telefon`, `tableta`, `iphone`),
 * fiindcă tot ce se verifică aici — degetul, sertarele, foile de jos — n-are
 * înțeles cu un maus și 1440px. Ce ține de simple lățimi stă separat, în
 * `adaptiv.spec.ts`: acolo un singur browser mătură toate breakpoint-urile, în
 * loc să pornim câte un proiect pentru fiecare.
 */
test.describe('Pe telefon', () => {
  test.skip(({ isMobile }) => !isMobile, 'rulează doar pe proiectele cu ecran tactil')

  // ─── Temelia ──────────────────────────────────────────────────────────────

  test('pagina se declară pe lățimea aparatului și lasă zoom-ul liber', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'networkidle' })
    const viewport = await page.locator('meta[name="viewport"]').getAttribute('content')

    // Fără `width=device-width`, telefonul randează pagina la 980px și o
    // micșorează: totul devine ilizibil dintr-o dată, pe toate ecranele. Eticheta
    // vine implicit de la Next, adică nu e scrisă nicăieri în cod — exact genul
    // de temelie care dispare fără să observe nimeni.
    expect(viewport, 'lățimea aparatului, nu 980px').toContain('width=device-width')

    // `user-scalable=no` și `maximum-scale=1` opresc mărirea cu două degete.
    // WCAG 1.4.4 cere 200%; pe un ecran de telefon, zoom-ul e proteza cu care
    // citește o parte din utilizatori.
    expect(viewport, 'mărirea rămâne la îndemână (WCAG 1.4.4)').not.toMatch(/user-scalable\s*=\s*no|maximum-scale/)
  })

  // ─── Navigarea ────────────────────────────────────────────────────────────

  test('fâșia de navigare derulează în ea însăși, nu împinge pagina', async ({ page }) => {
    // Adminul are cele mai multe etaje — șapte plăcuțe care nu încap nicicum
    // pe 412px. E cazul în care fâșia chiar trebuie să deruleze.
    await autentifica(page, 'admin')
    const nav = page.getByRole('navigation', { name: 'Navigare principală' })
    await expect(nav).toBeVisible()

    const derulator = nav.locator('.no-scrollbar')
    const overflow = await derulator.evaluate(el => getComputedStyle(el).overflowX)
    expect(overflow, 'ce e prea lat derulează în containerul lui (DESIGN.md)').toMatch(/auto|scroll/)

    expect(await elementeIesiteDinEcran(page), 'nimic nu iese pe sub marginea dreaptă').toEqual([])
  })

  test('etajul curent se aduce singur în dreptul ochiului', async ({ page }) => {
    await autentifica(page, 'admin')
    // „Audit” e ultima plăcuță din fâșie: pe telefon stă în afara ecranului
    // până când efectul din `Navbar` o derulează la vedere. Fără el, ești pe o
    // pagină al cărei nume nu se vede nicăieri.
    await page.goto('/admin/audit', { waitUntil: 'networkidle' })
    const activ = page.getByRole('navigation', { name: 'Navigare principală' }).locator('[data-active="true"]')
    await expect(activ).toHaveText(/Audit/)
    await expect(activ).toBeInViewport()
  })

  test('navigarea rămâne lipită sus după ce derulezi', async ({ page }) => {
    await autentifica(page, 'staff')
    await page.evaluate(() => window.scrollTo(0, 1500))
    // `sticky top-0`: pe un ecran de telefon, o bară care fuge la derulare te
    // obligă să urci înapoi pentru fiecare schimbare de etaj.
    await expect(page.getByRole('navigation', { name: 'Navigare principală' })).toBeInViewport()
  })

  test('nimic nu se ascunde în spatele unui meniu hamburger', async ({ page }) => {
    await autentifica(page, 'staff')
    // DESIGN.md e explicit: „Nimic nu se ascunde în spatele unui meniu
    // hamburger”. Verificarea e dublă — nu există un asemenea buton, iar
    // linkurile chiar sunt pe pagină, nu doar în DOM.
    await expect(page.getByRole('button', { name: /meniu|menu|hamburger|deschide navigarea/i })).toHaveCount(0)
    const nav = page.getByRole('navigation', { name: 'Navigare principală' })
    for (const eticheta of ['Proiecte', 'Chat', 'Calendar', 'Șabloane']) {
      await expect(nav.getByRole('link', { name: eticheta, exact: true })).toBeVisible()
    }
  })

  // ─── Degetul ──────────────────────────────────────────────────────────────

  test('fiecare control are cei 44px promiși degetului', async ({ page }) => {
    await autentifica(page, 'staff')
    // 24×24 e minimul WCAG 2.5.8 și se verifică peste tot, în `ecranSanatos`.
    // Aici se cere pragul propriu al sistemului: DESIGN.md scrie 44px pe
    // telefon, „pentru că acolo lucrează degetul”.
    expect(await tinteSubMinim(page, 44), 'ținte sub 44px pe telefon (DESIGN.md)').toEqual([])
  })

  test('niciun control nu se ascunde după hover', async ({ page }) => {
    await autentifica(page, 'staff')

    // Suprafețele se deschid, nu se vizitează. Tiparul nu stă pe pagina de
    // start: e în panoul de faze (mânerele de tras, meniul fazei), în firul de
    // chat (meniul mesajului) — locuri care pe telefon sunt închise până le
    // ceri. Un test care doar încarcă rutele trece fără să fi văzut niciunul.
    const rele: string[] = []
    const aduna = async (unde: string) => {
      for (const control of await controaleAscunseDeHover(page)) rele.push(`${unde}: ${control}`)
    }

    await expect(page.locator('h1').first()).toBeVisible({ timeout: 20_000 })
    await aduna('acasă')

    if (projectId) {
      await page.goto(`/projects/${projectId}`, { waitUntil: 'networkidle' })
      await page.getByRole('button', { name: /Toate fazele/ }).tap()
      await expect(page.getByText('Toate fazele', { exact: true })).toBeVisible()
      await aduna('panoul de faze')
    }

    await page.goto('/chat', { waitUntil: 'networkidle' })
    const conversatii = page.locator('aside button').filter({ hasNot: page.locator('input') })
    if (await conversatii.count() > 0) {
      await conversatii.first().tap()
      await expect(page.getByPlaceholder(/Scrie/)).toBeVisible({ timeout: 20_000 })
      await aduna('firul de chat')
    }

    expect(
      rele,
      'pe telefon nu există „a trece cu mausul peste”: ce e la opacitate 0 e de neatins',
    ).toEqual([])
  })

  test('intri în cont doar cu atingeri', async ({ page }) => {
    const { roluri } = uiConfig()
    await page.goto('/login', { waitUntil: 'networkidle' })
    // `tap()` trimite touchstart → touchend → click, nu doar click: dacă un
    // control ascultă `onMouseDown`, aici se vede, nu în producție.
    await page.getByLabel('Email').tap()
    await page.getByLabel('Email').fill(roluri.staff.email)
    await page.getByLabel(/Parol/).fill(roluri.staff.password)
    await page.getByRole('button', { name: /Intră în cont/ }).tap()
    await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 30_000 })
    await expect(page.getByRole('navigation', { name: 'Navigare principală' })).toBeVisible()
  })

  // ─── Formularele ──────────────────────────────────────────────────────────

  test('niciun câmp nu face iPhone-ul să sară la zoom', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'networkidle' })
    expect(await campuriCareFacZoom(page), 'câmpuri sub 16px pe login').toEqual([])

    await autentifica(page, 'staff')
    await expect(page.locator('h1').first()).toBeVisible()
    expect(await campuriCareFacZoom(page), 'câmpuri sub 16px pe ecranul principal').toEqual([])
  })

  test('câmpurile de login cer tastatura potrivită', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'networkidle' })
    // Pe telefon tipul câmpului alege tastatura: `type="email"` aduce @ și
    // punctul, `autocomplete` aduce parola din seif. Fără ele, autentificarea
    // se scrie literă cu literă.
    await expect(page.getByLabel('Email')).toHaveAttribute('type', 'email')
    await expect(page.getByLabel('Email')).toHaveAttribute('autocomplete', 'username')
    await expect(page.getByLabel(/Parol/)).toHaveAttribute('autocomplete', 'current-password')
  })

  // ─── Suprafețele care plutesc ─────────────────────────────────────────────

  test('notificările se deschid ca foaie lipită de marginea de jos', async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) >= SM, 'peste 640px clopoțelul e panou în colț, nu foaie de jos')
    await autentifica(page, 'staff')

    await page.getByRole('button', { name: /Notificări|notificări necitite/ }).tap()
    const foaie = page.getByRole('dialog', { name: 'Notificări' })
    await expect(foaie).toBeVisible()

    const cutie = (await foaie.boundingBox())!
    const h = viewport!.height
    // Foaie de jos înseamnă: prinsă de marginea inferioară și lată cât ecranul.
    // Un panou de 28rem lipit sus-dreapta ar trece de `toBeVisible`, dar pe
    // telefon ar sta sub degetul mare, cu jumătate în afara ecranului.
    expect(Math.round(cutie.y + cutie.height), 'prinsă de marginea de jos').toBeGreaterThanOrEqual(h - 2)
    expect(cutie.width, 'lată cât ecranul').toBeGreaterThanOrEqual(viewport!.width - 2)
    expect(cutie.height, 'nu mai mult de 80dvh').toBeLessThanOrEqual(h * 0.81)

    await page.getByRole('button', { name: 'Închide notificările' }).tap()
    await expect(foaie).toBeHidden()
  })

  test('dialogul de filtre încape întreg pe ecran', async ({ page }) => {
    await autentifica(page, 'staff')
    await page.getByRole('button', { name: 'Filtre' }).tap()
    const dialog = page.getByRole('dialog', { name: 'Filtre' })
    await expect(dialog).toBeVisible()

    const { incape, motiv } = await incapePeEcran(page, '[role="dialog"]')
    expect(incape, `dialogul ${motiv}`).toBe(true)
    // Cu dialogul deschis, pagina de dedesubt tot n-are voie să plece lateral.
    expect(await derulareOrizontala(page)).toBe(false)

    await dialog.getByRole('button', { name: 'Închide filtrele' }).tap()
    await expect(dialog).toBeHidden()
  })

  // ─── Machetele care se schimbă la 768px ───────────────────────────────────

  test('sertarul de faze se deschide la atingere și se închide de pe fundal', async ({ page, viewport }) => {
    test.skip(!projectId, 'E2E_PROJECT_ID lipsește din .env.e2e.local')
    test.skip((viewport?.width ?? 0) >= MD, 'de la 768px panoul e coloană fixă, nu sertar')

    await autentifica(page, 'staff')
    await page.goto(`/projects/${projectId}`, { waitUntil: 'networkidle' })

    const panou = page.getByText('Toate fazele', { exact: true })
    // Închis din start: pe 412px un panou de 320px ar mânca tot ecranul.
    await expect(panou).toBeHidden()

    await page.getByRole('button', { name: /Toate fazele/ }).tap()
    await expect(panou).toBeVisible()

    // 85vw: fâșia rămasă din pagina de dedesubt e ce-ți spune că sertarul e
    // sertar, nu un ecran nou din care nu știi cum ieși.
    const cutie = (await page.locator('aside').first().boundingBox())!
    expect(cutie.width, 'sertarul lasă pagina să se vadă pe margine').toBeLessThanOrEqual(viewport!.width * 0.86)

    // Atingerea pe fundal e drumul de ieșire pe care îl încearcă toată lumea.
    await page.touchscreen.tap(viewport!.width - 8, Math.round(viewport!.height / 2))
    await expect(panou).toBeHidden()
  })

  test('chatul trece de la listă la conversație și înapoi', async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) >= MD, 'de la 768px lista și conversația stau alături')

    await autentifica(page, 'staff')
    await page.goto('/chat', { waitUntil: 'networkidle' })

    const lista = page.getByRole('heading', { name: 'Chat', level: 1 })
    await expect(lista).toBeVisible()

    const conversatii = page.locator('aside button').filter({ hasNot: page.locator('input') })
    const n = await conversatii.count()
    test.skip(n === 0, 'contul nu are conversații')

    await conversatii.first().tap()
    // Master/detail pe o coloană: lista se dă la o parte, altfel ai două
    // panouri de 200px unul lângă altul, niciunul folosibil.
    await expect(lista).toBeHidden()

    // Drumul înapoi trebuie să aibă nume: pe telefon e singura ieșire din
    // conversație, iar un cititor de ecran care anunță „buton” nu e o ieșire.
    const inapoi = page.getByRole('button', { name: /Înapoi|Conversații|Lista/i })
    await expect(inapoi, 'butonul de întoarcere are nume accesibil').toBeVisible()
    await inapoi.tap()
    await expect(lista).toBeVisible()
  })

  test('tabelul de administrare derulează în containerul lui', async ({ page }) => {
    await autentifica(page, 'admin')
    await page.goto('/admin/proiecte', { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { name: 'Tablou de bord', level: 1 })).toBeVisible()

    // Un tabel de nouă coloane nu încape pe telefon și nici n-ar trebui: unele
    // coloane se ascund la `sm:`/`md:`, iar restul derulează în containerul
    // propriu. Ce nu are voie e să plece corpul paginii cu el.
    const container = page.locator('div.overflow-x-auto:has(table)').first()
    await expect(container).toBeVisible()
    expect(await elementeIesiteDinEcran(page), 'tabelul rămâne în containerul lui').toEqual([])
  })

  // ─── Ecrane sănătoase, pe telefon ─────────────────────────────────────────

  /**
   * Toate ecranele, nu o mână de ele.
   *
   * Lista vine din `RUTE_APLICATIE`, aceeași pe care o mătură și suita de
   * design: o rută nouă intră automat și în verificarea de telefon. Înainte
   * erau cinci ecrane alese cu mâna, iar restul — tabloul de bord, auditul,
   * șabloanele, proiectul nou — erau văzute doar la 1440px.
   */
  for (const [nume, ruta, rol] of [
    ...RUTE_APLICATIE,
    ...(projectId ? [['pagina proiectului', `/projects/${projectId}`, 'staff'] as const] : []),
  ]) {
    test(`${nume}: ecran sănătos pe telefon`, async ({ page }) => {
      /**
       * DATORIE — pagina proiectului, de la 768px în sus.
       *
       * Pe tabletă coloana de faze ia 320px din lățime și strânge conținutul:
       * plăcuțele de activitate și de cerere ajung la 14–16px lățime, sub
       * minimul de 24×24 din WCAG 2.5.8. Pe telefon panoul e sertar, deci
       * lățimea rămâne întreagă și aceleași plăcuțe trec — de asta marcajul
       * ține cont de lățime.
       */
      if (ruta.startsWith('/projects/') && ruta !== '/projects/new'
        && (page.viewportSize()?.width ?? 0) >= MD) {
        test.fail(true, 'plăcuțe de 14–16px lățime când coloana de faze strânge conținutul')
      }
      const erori = ascultaErorile(page)
      await autentifica(page, rol)
      await page.goto(ruta, { waitUntil: 'networkidle' })
      await expect(page.locator('h1').first()).toBeVisible({ timeout: 20_000 })

      expect(await elementeIesiteDinEcran(page), 'elemente ieșite din ecran').toEqual([])
      expect(await campuriCareFacZoom(page), 'câmpuri care fac iOS să sară la zoom').toEqual([])
      expect(await tinteSubMinim(page), 'ținte sub 24×24 px (WCAG 2.5.8)').toEqual([])
      expect(erori.filter(e => !e.includes('Missing Authorization') && !e.includes('404'))).toEqual([])
    })
  }
})
