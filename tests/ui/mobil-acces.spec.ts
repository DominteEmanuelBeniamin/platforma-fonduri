import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { autentifica, uiConfig, RUTE_APLICATIE } from './helpers'

const { projectId } = uiConfig()

/**
 * Accesibilitatea, verificată cu motorul standard.
 *
 * Suita de până acum verifică regulile *noastre* — 44px pentru deget, 16px ca
 * iOS să nu sară la zoom, nimic ascuns după hover. Sunt reguli bune, dar scrise
 * de noi, deci acoperă doar ce ne-am amintit să scriem. axe-core aduce cealaltă
 * jumătate: catalogul WCAG, întreținut de oameni care fac numai asta —
 * contrast, nume accesibile, ordinea titlurilor, atribute ARIA valide.
 *
 * Rulează pe proiectele de telefon fiindcă acolo se schimbă răspunsurile:
 * contrastul e același, dar la 412px se randează alte componente (sertare,
 * foi de jos, meniuri de acțiuni), iar acelea au propriile lor probleme de
 * nume și de rol.
 */

/**
 * Ce se cere: nivelurile A și AA din WCAG 2.0/2.1/2.2, plus regulile de bune
 * practici ale motorului. Nu AAA — nu e nivelul la care se angajează nimeni.
 */
const ETICHETE = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']

/**
 * Reguli lăsate deoparte, fiecare cu motivul ei.
 *
 * Lista e scurtă intenționat și fiecare rând e o datorie, nu o scutire: dacă
 * excludem o regulă fără motiv, testul devine decor. Se adaugă un rând doar
 * când motivul se poate scrie într-o propoziție.
 */
const SARITE: string[] = [
  // Dublura cu propriul nostru prag: `tinteSubMinim` cere 44px pe telefon,
  // adică mai mult decât cere axe (24px). Ce trece la noi trece și acolo, iar
  // un raport dublu ar arăta aceeași problemă de două ori.
  'target-size',
]

/**
 * Datoria de accesibilitate găsită la prima rulare a scanării.
 *
 * Fiecare rând e un ecran care **acum** are încălcări reale, cu ce anume a
 * găsit motorul. Nu sunt scutiri: `test.fail()` ține testul în suită fără s-o
 * înroșească, dar în clipa în care cineva repară ecranul, Playwright raportează
 * „a trecut deși era așteptat să pice” — adică te obligă să ștergi rândul.
 * Lista se scurtează singură; nu putrezește.
 *
 * Nu se marchează cu selectorul exact, ci cu ecranul: selectorii axe conțin
 * `nth-child`, care se schimbă cu datele din bază. Prețul e că o încălcare
 * *nouă* pe un ecran deja marcat nu se vede până nu se repară cele vechi.
 */
const DATORIE: Record<string, string> = {
  '/': 'heading-order: plăcuța de proiect are `h3` direct sub `h1`, fără `h2` între ele',
  '/calendar': 'color-contrast: capetele de zi (`.uppercase.tracking-wide`) sub pragul AA',
  '/projects/new': 'select-name: `<select>`-ul din formular n-are nume accesibil',
  '/admin/statuses': 'button-name: butoanele de editare și ștergere de pe rândul de status sunt doar pictograme',
  '/admin/audit': 'button-name: cele trei filtre `role="combobox"` n-au nume accesibil',
  '/admin/templates': 'heading-order + color-contrast pe plăcuțe + scrollable-region-focusable: fâșiile care derulează orizontal nu se pot atinge din tastatură',
  // Cheia e cu parametru: id-ul vine din `.env.e2e.local`, deci ruta reală
  // diferă de la o bază la alta.
  '/projects/:id': 'landmark-no-duplicate-main: `app/projects/[id]/page.tsx:1143` pune un al doilea `<main>` înăuntrul celui din `app/layout.tsx:50`',
}

/**
 * Datorie care apare abia de la `md:` (768px) în sus.
 *
 * Chatul își montează a doua coloană doar peste prag (`hidden md:flex`), iar
 * `<main>`-ul dublu e chiar în ea. Pe telefon ecranul e curat, pe tabletă nu —
 * deci marcajul trebuie să depindă de lățime, altfel proiectul `telefon` ar
 * raporta „a trecut deși era așteptat să pice”.
 */
const DATORIE_DE_LA_768: Record<string, string> = {
  '/chat': 'landmark-no-duplicate-main: `app/chat/page.tsx:393` pune un al doilea `<main>` în coloana care apare de la 768px',
}

/** Datoria ecranului, ținând cont că pagina proiectului are id în rută. */
const datoriaLui = (ruta: string) =>
  DATORIE[ruta] ?? (ruta.startsWith('/projects/') && ruta !== '/projects/new'
    ? DATORIE['/projects/:id']
    : undefined)

/** Un rând citibil pentru fiecare încălcare, cu locul din pagină. */
function raport(incalcari: { id: string; impact?: string | null; help: string; nodes: { target: unknown[] }[] }[]) {
  return incalcari.flatMap(v =>
    v.nodes.slice(0, 3).map(n => `[${v.impact ?? 'n/a'}] ${v.id}: ${v.help} → ${String(n.target[0])}`),
  )
}

test.describe('Accesibilitatea pe telefon (axe-core)', () => {
  test.skip(({ isMobile }) => !isMobile, 'rulează doar pe proiectele cu ecran tactil')

  for (const [nume, ruta, rol] of [
    ...RUTE_APLICATIE,
    ...(projectId ? [['pagina proiectului', `/projects/${projectId}`, 'staff'] as const] : []),
  ]) {
    test(`${nume}: fără încălcări WCAG A/AA`, async ({ page }) => {
      const datorie = datoriaLui(ruta)
      if (datorie) test.fail(true, datorie)
      if (DATORIE_DE_LA_768[ruta] && (page.viewportSize()?.width ?? 0) >= 768) {
        test.fail(true, DATORIE_DE_LA_768[ruta])
      }
      await autentifica(page, rol)
      await page.goto(ruta, { waitUntil: 'networkidle' })
      await expect(page.locator('h1').first()).toBeVisible({ timeout: 20_000 })

      const rezultat = await new AxeBuilder({ page })
        .withTags(ETICHETE)
        .disableRules(SARITE)
        .analyze()

      expect(raport(rezultat.violations), `încălcări pe ${ruta}`).toEqual([])
    })
  }

  /**
   * Suprafețele care se deschid nu sunt prinse de măturarea de mai sus: axe
   * vede doar ce e în DOM în clipa scanării, iar sertarul și foaia de jos sunt
   * închise pe telefon până le ceri. Sunt și locurile cele mai expuse — o
   * fereastră modală fără nume, fără focus mutat înăuntru și fără ieșire din
   * tastatură e chiar tiparul pe care îl caută criteriile.
   */
  test('suprafețele care se deschid au și ele nume și rol', async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) >= 640, 'sub 640px se deschid ca foi de jos; mai sus sunt panouri')
    // Aceeași încălcare ca pe pagina de start — plăcuțele de proiect se văd și
    // prin dialogul de filtre, deci `h3` sub `h1` apare și aici. Se stinge
    // odată cu rândul `'/'` din `DATORIE`.
    test.fail(true, 'heading-order pe plăcuțele de proiect, vizibile prin dialogul de filtre')
    await autentifica(page, 'staff')

    const scaneaza = async (unde: string) => {
      const r = await new AxeBuilder({ page }).withTags(ETICHETE).disableRules(SARITE).analyze()
      return raport(r.violations).map(l => `${unde}: ${l}`)
    }

    const rele: string[] = []

    await page.getByRole('button', { name: /Notificări|notificări necitite/ }).tap()
    await expect(page.getByRole('dialog', { name: 'Notificări' })).toBeVisible()
    rele.push(...await scaneaza('foaia de notificări'))
    await page.getByRole('button', { name: 'Închide notificările' }).tap()

    await page.getByRole('button', { name: 'Filtre' }).tap()
    await expect(page.getByRole('dialog', { name: 'Filtre' })).toBeVisible()
    rele.push(...await scaneaza('dialogul de filtre'))

    expect(rele).toEqual([])
  })
})
