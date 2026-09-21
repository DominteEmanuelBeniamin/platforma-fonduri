import { expect, type Page } from '@playwright/test'
import { readEnvFile, E2E_ENV_FILE } from '../e2e/helpers/project-state'

/**
 * Configurația suitei de interfață.
 *
 * Separată de `requireE2EConfig`, care păzește testele cu scriere: acelea cer
 * o bază Supabase dedicată și două porți explicite (`E2E_WRITES`,
 * `E2E_TEST_PROJECT`), fiindcă șterg și rescriu date. Suita asta nu scrie
 * nimic — se autentifică, deschide ecrane și verifică ce se vede — deci are
 * nevoie doar de o adresă și de conturi.
 */
export type UIConfig = {
  baseUrl: string
  projectId: string | null
  roluri: Record<Rol, { email: string; password: string }>
}

export type Rol = 'admin' | 'staff' | 'client'

const CHEI_OBLIGATORII = [
  'E2E_BASE_URL',
  'E2E_ADMIN_EMAIL', 'E2E_ADMIN_PASSWORD',
  'E2E_STAFF_EMAIL', 'E2E_STAFF_PASSWORD',
  'E2E_CLIENT_EMAIL', 'E2E_CLIENT_PASSWORD',
] as const

export function uiConfig(): UIConfig {
  const env = { ...readEnvFile(E2E_ENV_FILE) }
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith('E2E_') && v) env[k] = v
  }
  const lipsa = CHEI_OBLIGATORII.filter(k => !env[k])
  if (lipsa.length > 0) {
    throw new Error(
      `Suita de interfață are nevoie de ${lipsa.join(', ')} în ${E2E_ENV_FILE}. ` +
      'Nu scrie nimic în bază, deci nu cere porțile E2E_WRITES / E2E_TEST_PROJECT.',
    )
  }
  return {
    baseUrl: env.E2E_BASE_URL,
    projectId: env.E2E_PROJECT_ID || null,
    roluri: {
      admin: { email: env.E2E_ADMIN_EMAIL, password: env.E2E_ADMIN_PASSWORD },
      staff: { email: env.E2E_STAFF_EMAIL, password: env.E2E_STAFF_PASSWORD },
      client: { email: env.E2E_CLIENT_EMAIL, password: env.E2E_CLIENT_PASSWORD },
    },
  }
}

/**
 * Toate ecranele aplicației, cu rolul care are voie să le deschidă.
 *
 * Sursă unică: aceeași listă e măturată de `sistem-de-design.spec.ts` (paletă,
 * font, ținte) și de `mobil.spec.ts` (sănătate pe telefon). Când apare o rută
 * nouă se adaugă aici o dată, și intră din prima în ambele suite — altfel un
 * ecran nou e verificat pe desktop și uitat pe telefon, exact inversul a ce
 * vrem.
 *
 * Rutele cu parametru (`/projects/[id]`, `/admin/users/[id]`,
 * `/preview/[kind]/[id]`) nu stau aici: au nevoie de un id găsit la rulare, așa
 * că fiecare suită și-l adaugă singură.
 */
export const RUTE_APLICATIE = [
  ['acasă', '/', 'staff'],
  ['cereri de documente', '/my-requests', 'staff'],
  ['calendar', '/calendar', 'staff'],
  ['chat', '/chat', 'staff'],
  ['notificări', '/notificari', 'staff'],
  ['proiect nou', '/projects/new', 'staff'],
  ['șabloane', '/admin', 'admin'],
  ['tablou de bord', '/admin/proiecte', 'admin'],
  ['utilizatori', '/admin/users', 'admin'],
  ['statusuri', '/admin/statuses', 'admin'],
  ['audit', '/admin/audit', 'admin'],
  ['șabloane (listă)', '/admin/templates', 'admin'],
] as const satisfies readonly (readonly [string, string, Rol])[]

/**
 * Intră în cont și așteaptă până când nu mai suntem pe pagina de login.
 *
 * Se completează formularul de fiecare dată, deși tiparul recomandat de
 * Playwright e `storageState`: o autentificare în proiectul de `setup`, salvată
 * pe disc și rejucată în restul testelor.
 *
 * Aici nu merge, și motivul e al backendului, nu al nostru. Supabase **rotește
 * refresh token-ul**: e de unică folosință. Prima suită de teste care îl
 * consumă îl invalidează pentru toate celelalte, iar clientul, când refresh-ul
 * îi eșuează, se deconectează singur în tăcere — pagina se randează normal, dar
 * fiecare cerere de date întoarce 401. Măsurat pe o rulare întreagă: 23 de
 * teste picate, toate cu 401 în consolă, față de una singură cu formularul.
 *
 * Un test care se pare că trece pe o sesiune moartă e mai rău decât unul lent.
 */
export async function autentifica(page: Page, rol: Rol) {
  const { roluri } = uiConfig()
  const cont = roluri[rol]
  await page.goto('/login', { waitUntil: 'networkidle' })
  await page.fill('input[type="email"]', cont.email)
  await page.fill('input[type="password"]', cont.password)
  await page.getByRole('button', { name: /Intră în cont/ }).click()
  await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 30_000 })
  await page.waitForLoadState('networkidle')
}

/**
 * Ținte de atingere sub prag.
 *
 * Implicit 24×24 px, minimul WCAG 2.5.8 — pragul care se aplică peste tot.
 * Pe telefon se cere mai mult: DESIGN.md promite 44px, „pentru că acolo
 * lucrează degetul”, iar `mobil.spec.ts` cheamă funcția cu pragul acela.
 *
 * Linkul aflat inline într-o frază are excepție explicită în criteriu:
 * înălțimea lui e dată de interlinia textului din jur, nu de o decizie de
 * design. Restul controalelor n-au scuză.
 */
export async function tinteSubMinim(page: Page, prag = 24) {
  return page.evaluate((prag) => {
    const mici: string[] = []
    const selector = 'a[href],button,input,select,textarea,[role="button"],[role="tab"]'
    for (const el of Array.from(document.querySelectorAll(selector))) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      if (r.height >= prag && r.width >= prag) continue
      if (el.tagName === 'A' && getComputedStyle(el).display.startsWith('inline')) continue
      const nume = (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40)
      mici.push(`${el.tagName} ${Math.round(r.width)}×${Math.round(r.height)} „${nume}”`)
    }
    return mici
  }, prag)
}

/** Corpul paginii nu derulează niciodată lateral; ce e prea lat derulează în containerul lui. */
export async function derulareOrizontala(page: Page) {
  return page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
}

/** Fontul de semnalizare e găzduit local; `next/font/local` îi dă numele `signage`. */
export async function fontulAplicat(page: Page) {
  return page.evaluate(() => getComputedStyle(document.body).fontFamily)
}

/**
 * Culorile venite din foile de stil, care se abat de la paleta sistemului.
 *
 * Nu compară hex-uri: browserul emite `oklch()` pentru Tailwind v4 și `lab()`
 * pentru unele conversii, iar un detector pe `rgb()` — sau pe o listă de
 * hex-uri exacte — trece pe lângă exact culorile pe care le caută. Aici
 * culoarea se **rasterizează pe pânză**, ceea ce merge pentru orice spațiu, se
 * compune peste hârtia paginii (ca să conteze ce se vede, nu ce e scris) și se
 * compară cu paleta prin distanță în sRGB.
 *
 * Culorile puse inline din date sunt sărite: statusurile de proiect au
 * culoarea aleasă de administrator și stocată în bază, deci sunt conținut, nu
 * paletă scăpată. O scăpare reală vine dintr-o clasă, adică din foaia de stil.
 */
export async function culoriStraine(page: Page, prag = 70) {
  return page.evaluate(({ prag }) => {
    const PALETA = [
      '#f5f4f0', '#edebe5', '#ffffff', '#d9d6cd', '#b4afa2',
      '#16181c', '#4a4f57', '#6b7079',
      '#0e4c4a', '#e3ecea', '#0a3937',
      '#7a5b12', '#8e3b2a', '#5b3a63', '#4a5a24', '#2f4858',
      '#f2eddf', '#f4e6e2', '#ede7ef', '#ebeee2', '#e6eaed',
      '#1f6b3a', '#e4efe8', '#8a5a08', '#f4ebdc', '#9b2c21', '#f5e4e1', '#eae9e5',
      '#000000',
    ]
    const HARTIE = [245, 244, 240]

    const cv = document.createElement('canvas')
    cv.width = 1; cv.height = 1
    const ctx = cv.getContext('2d', { willReadFrequently: true })!

    /** Rasterizează orice culoare CSS, compusă peste hârtie. */
    const rgb = (val: string): [number, number, number] | null => {
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = `rgb(${HARTIE.join(',')})`
      ctx.fillRect(0, 0, 1, 1)
      const inainte = ctx.fillStyle
      ctx.fillStyle = val
      if (ctx.fillStyle === inainte && val !== `rgb(${HARTIE.join(', ')})`) {
        // Valoarea n-a fost acceptată de pânză; nu ghicim.
        if (!/^(rgb|#|oklch|lab|color|hsl)/i.test(val)) return null
      }
      ctx.fillRect(0, 0, 1, 1)
      const d = ctx.getImageData(0, 0, 1, 1).data
      return [d[0], d[1], d[2]]
    }

    const hex = ([r, g, b]: [number, number, number]) =>
      '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')

    const paletaRgb = PALETA.map(h => [
      parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16),
    ] as [number, number, number])

    const departe = (c: [number, number, number]) =>
      Math.min(...paletaRgb.map(p => Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2]))) > prag

    const straine = new Map<string, string>()
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const inline = (el.getAttribute('style') ?? '').toLowerCase()
      const st = getComputedStyle(el)
      const perechi: [string, string][] = [
        ['background', st.backgroundColor],
        ['color', st.color],
        ['border', st.borderTopColor],
      ]
      for (const [nume, val] of perechi) {
        if (!val || val === 'rgba(0, 0, 0, 0)' || val === 'transparent') continue
        if (inline.includes(nume)) continue // pus din date, nu din foaia de stil
        const c = rgb(val)
        if (!c || !departe(c)) continue
        const cheie = hex(c)
        if (!straine.has(cheie)) {
          straine.set(cheie, `${cheie} (${nume}) pe ${el.tagName}.${(el.className || '').toString().slice(0, 40)}`)
        }
      }
    }
    return Array.from(straine.values())
  }, { prag })
}

/** Un ecran sănătos: un singur h1, fără derulare laterală, fără ținte sub minim. */
export async function ecranSanatos(page: Page) {
  // Titlul e ultimul lucru care apare după ce se așază datele; fără așteptare
  // testul ar măsura ecranul de încărcare.
  await page.locator('h1').first().waitFor({ state: 'visible', timeout: 20_000 })
  expect(await derulareOrizontala(page), 'corpul paginii derulează orizontal').toBe(false)
  expect(await tinteSubMinim(page), 'ținte sub 24×24 px (WCAG 2.5.8)').toEqual([])
  expect(await page.locator('h1').count(), 'exact un titlu de nivel 1').toBe(1)
}

/** Colectează erorile de pagină și de consolă pe durata unui test. */
export function ascultaErorile(page: Page) {
  const erori: string[] = []
  page.on('pageerror', e => erori.push(`pageerror: ${e.message}`))
  page.on('console', m => { if (m.type() === 'error') erori.push(`console: ${m.text()}`) })
  return erori
}

/**
 * Elementele care ies în afara ecranului pe dreapta, fără un container care
 * să le țină.
 *
 * `derulareOrizontala` de mai sus întreabă doar dacă documentul derulează —
 * dar `app/layout.tsx` pune `overflow-x-hidden` pe `html` și pe `body`, deci
 * ce iese e **tăiat**, nu semnalat. Pe desktop nu se vede nimic; pe telefon
 * jumătate dintr-un buton dispare sub marginea dreaptă. De asta funcția asta
 * numește vinovatul, în loc să răspundă doar cu da/nu.
 *
 * Ce derulează în propriul container e în regulă — e chiar tiparul cerut de
 * DESIGN.md („ce e prea lat derulează în propriul container”), așa că un
 * strămoș cu `overflow-x` scroll/auto/hidden scuză elementul. Marginea din
 * stânga nu se verifică deloc: sertarele închise stau legitim la `-100%`.
 */
export async function elementeIesiteDinEcran(page: Page) {
  return page.evaluate(() => {
    const latime = document.documentElement.clientWidth
    const vinovati = new Map<string, string>()
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      if (r.right <= latime + 1) continue

      let stramos = el.parentElement
      let tinut = false
      while (stramos && stramos !== document.body) {
        const ox = getComputedStyle(stramos).overflowX
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') { tinut = true; break }
        stramos = stramos.parentElement
      }
      if (tinut) continue

      const clasa = (el.className || '').toString().slice(0, 50)
      const cheie = `${el.tagName}.${clasa}`
      if (!vinovati.has(cheie)) {
        vinovati.set(cheie, `${cheie} — iese cu ${Math.round(r.right - latime)}px peste marginea de ${latime}px`)
      }
    }
    return Array.from(vinovati.values())
  })
}

/**
 * Câmpurile care fac Safari-ul de pe iPhone să sară la zoom când le atingi.
 *
 * Regula e a motorului, nu a noastră: sub 16px, iOS mărește pagina la focus
 * ca să poți citi ce scrii, și n-o mai dă înapoi. Utilizatorul rămâne cu
 * macheta descentrată și cu bara de unelte pe jumătate în afara ecranului.
 * Singura apărare e ca fontul câmpului să fie de cel puțin 16px.
 *
 * Se sar tipurile care nu primesc text: la ele nu apare tastatură, deci nici
 * zoom.
 */
export async function campuriCareFacZoom(page: Page) {
  return page.evaluate(() => {
    const FARA_TASTATURA = ['hidden', 'checkbox', 'radio', 'range', 'color', 'file', 'submit', 'button', 'reset', 'image']
    const mici: string[] = []
    for (const el of Array.from(document.querySelectorAll('input,select,textarea'))) {
      const tip = (el as HTMLInputElement).type ?? ''
      if (FARA_TASTATURA.includes(tip)) continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      const fs = parseFloat(getComputedStyle(el).fontSize)
      if (fs >= 16) continue
      const nume = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.id || '').trim().slice(0, 40)
      mici.push(`${el.tagName}[${tip}] ${fs}px „${nume}”`)
    }
    return mici
  })
}

/**
 * Controalele pe care degetul nu le poate scoate la iveală.
 *
 * Tiparul `opacity-0 group-hover:opacity-100` ascunde o acțiune până treci cu
 * mausul peste rând. Pe telefon nu există „a trece peste”: butonul rămâne
 * invizibil, deși e acolo și primește atingerea — atingi ceva ce nu vezi, sau
 * nu ajungi niciodată la el.
 *
 * Codul nostru știe deja răspunsul corect în două locuri — `FlatDriveFilesView`
 * scrie `opacity-100 … sm:opacity-0 sm:group-hover:opacity-100`, iar
 * `ProjectPhasesSidebar` scrie `md:opacity-0 md:group-hover:opacity-100`:
 * vizibil pe ecran mic, ascuns doar acolo unde există maus. Testul cere tiparul
 * ăsta peste tot.
 *
 * Opacitatea se înmulțește pe lanțul de strămoși, deci se citește tot lanțul,
 * nu doar elementul. `[draggable]` intră în selector fiindcă mânerele de
 * reordonare din panoul de faze sunt `<span draggable>`, nu butoane: fără el
 * testul trecea peste exact locul unde tiparul e cel mai des.
 */
export async function controaleAscunseDeHover(page: Page) {
  return page.evaluate(() => {
    const rele = new Map<string, string>()
    const selector = 'a[href],button,input,select,textarea,[role="button"],[role="menuitem"],[draggable="true"]'
    for (const el of Array.from(document.querySelectorAll(selector))) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue

      let opacitate = 1
      let n: Element | null = el
      while (n && n !== document.documentElement) {
        opacitate *= parseFloat(getComputedStyle(n).opacity || '1')
        n = n.parentElement
      }
      if (opacitate > 0.05) continue

      const clasa = (el.className || '').toString().slice(0, 60)
      const nume = (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30)
      const cheie = `${el.tagName}.${clasa}`
      if (!rele.has(cheie)) rele.set(cheie, `${el.tagName} „${nume}” — ${clasa}`)
    }
    return Array.from(rele.values())
  })
}

/**
 * Cutia unui element, raportată la fereastră.
 *
 * Un dialog care începe sub marginea de jos, sau o foaie care depășește
 * lățimea, se citește greu dintr-un `boundingBox()` brut: trebuie comparat de
 * fiecare dată cu `viewportSize()`. Aici se face o singură dată.
 */
export async function incapePeEcran(page: Page, selector: string) {
  const cutie = await page.locator(selector).first().boundingBox()
  const fereastra = page.viewportSize()
  if (!cutie || !fereastra) return { incape: false, motiv: 'element sau fereastră lipsă' }
  const abateri: string[] = []
  if (cutie.x < -1) abateri.push(`iese ${Math.round(-cutie.x)}px în stânga`)
  if (cutie.x + cutie.width > fereastra.width + 1) abateri.push(`iese ${Math.round(cutie.x + cutie.width - fereastra.width)}px în dreapta`)
  if (cutie.y + cutie.height > fereastra.height + 1) abateri.push(`iese ${Math.round(cutie.y + cutie.height - fereastra.height)}px sub margine`)
  return { incape: abateri.length === 0, motiv: abateri.join(', ') }
}

/**
 * Un gest de glisare adevărat, cu deget, nu un `scrollBy` din JavaScript.
 *
 * `page.touchscreen` știe doar `tap()`, iar `mouse` nu emite deloc evenimente
 * de atingere: o derulare pusă la cale din JavaScript ar trece chiar și pe o
 * suprafață cu `touch-action: none`, adică exact bug-ul pe care îl căutăm.
 * Secvența de mai jos e trimisă prin CDP, deci e intrare reală — dar din
 * același motiv merge numai în Chromium.
 */
export async function glisa(
  page: Page,
  de_la: { x: number; y: number },
  cu: { dx: number; dy: number },
  pasi = 10,
) {
  const cdp = await page.context().newCDPSession(page)
  const punct = (i: number) => [{
    x: de_la.x + (cu.dx * i) / pasi,
    y: de_la.y + (cu.dy * i) / pasi,
  }]
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: punct(0) })
  for (let i = 1; i <= pasi; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: punct(i) })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
}
