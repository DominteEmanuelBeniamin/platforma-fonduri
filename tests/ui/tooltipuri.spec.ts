import { test, expect, type Page, type ElementHandle } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { autentifica, uiConfig, RUTE_APLICATIE, type Rol } from './helpers'

/**
 * Fiecare buton are tooltip (`components/ui/TooltipLayer.tsx`).
 *
 * Pe fiecare ecran, trece cu mausul peste fiecare element apăsabil vizibil —
 * buton, link, comutator, tab, plus orice are `title` sau `data-tooltip` — și
 * așteaptă tooltip-ul aplicației (`#sg-tooltip`), cu text. Nu ghicește din
 * atribute: verifică ce vede omul.
 *
 * Doar citire: se trece cu mausul, nu se apasă nimic. Dialogurile se deschid
 * (fișa unei cereri, formularul de cerere nouă) și se închid fără salvare.
 *
 * Doar pe desktop: pe touch tooltip-urile nu apar, prin construcție.
 *
 * Fiecare test își scrie rezultatul în `playwright-report/tooltipuri/rezultate/`
 * (Playwright repornește procesul după un test picat, deci memoria nu ajunge),
 * iar la final se construiește `raport.html` din toate, cu capturi. Golește
 * `playwright-report/tooltipuri/` înainte de o rulare nouă.
 * Rulare: `E2E_ENV_FILE=.env.e2e.localdb E2E_PROJECT_ID=<id> npx playwright
 * test --config playwright.ui.config.ts tests/ui/tooltipuri.spec.ts --project desktop`
 */

const { projectId } = uiConfig()
const OUT = path.join(process.cwd(), 'playwright-report', 'tooltipuri')
const SHOTS = path.join(OUT, 'capturi')
const REZULTATE = path.join(OUT, 'rezultate')

const CANDIDATI = 'button, a[href], [role="button"], [role="switch"], [role="tab"], [data-tooltip], [title]'

type Rezultat = {
  descriere: string
  tooltip: string | null
  stare: 'ok' | 'lipsă' | 'acoperit' | 'dezactivat'
}
type Ecran = {
  nume: string
  rol: Rol
  url: string
  elemente: Rezultat[]
  mostre: { fisier: string; element: string; tooltip: string }[]
  capturaLipsuri?: string
  durataMs: number
}
type Tastatura = { ecran: string; verificate: number; cuTooltip: number; probleme: string[] }
type Comportament = { regula: string; trece: boolean; detaliu: string }

function salveaza(nume: string, date: unknown) {
  fs.mkdirSync(REZULTATE, { recursive: true })
  fs.writeFileSync(path.join(REZULTATE, `${slug(nume)}.json`), JSON.stringify(date, null, 2))
}

function slug(text: string) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/**
 * Tooltip-ul aplicației, dacă se vede: textul lui; altfel `null`. Cu `al`,
 * doar dacă e chiar al acelui element (`data-tooltip-state="open"` pe el) —
 * nu unul rămas de la elementul de dinainte.
 */
async function tooltipVizibil(page: Page, timeout: number, al?: ElementHandle<HTMLElement>): Promise<string | null> {
  try {
    const handle = await page.waitForFunction((el) => {
      const tip = document.getElementById('sg-tooltip')
      if (!tip || tip.style.visibility !== 'visible' || !tip.textContent?.trim()) return null
      if (el && el.getAttribute('data-tooltip-state') !== 'open') return null
      return tip.textContent.trim()
    }, al ?? null, { timeout, polling: 25 })
    return (await handle.jsonValue()) as string
  } catch {
    return null
  }
}

/** Elementele de verificat: vizibile, nu în meniuri deschise, nu tooltip-ul însuși. */
async function candidati(page: Page, scope?: string): Promise<ElementHandle<HTMLElement>[]> {
  const toate = await page.$$(scope ? `${scope} :is(${CANDIDATI})` : CANDIDATI) as ElementHandle<HTMLElement>[]
  const pastrate: ElementHandle<HTMLElement>[] = []
  for (const el of toate) {
    const ok = await el.evaluate((node: HTMLElement) => {
      if (node.closest('#sg-tooltip, [role="menu"], [role="listbox"], .skip-link')) return false
      // Uneltele de dezvoltare Next.js (în shadow DOM) nu fac parte din aplicație.
      if (node.getRootNode() !== document) return false
      // Un candidat dinăuntrul altui candidat (iconița cu `title` dintr-un
      // buton) e același lucru pentru om: contează elementul exterior. Un rând
      // cu `data-tooltip` (activitățile din panou) nu ascunde butoanele din el.
      const parinte = node.parentElement?.closest('button, a[href], [role="button"], [role="switch"], [role="tab"], [title]')
      if (parinte) return false
      const r = node.getBoundingClientRect()
      const style = getComputedStyle(node)
      return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0
    })
    if (ok) pastrate.push(el)
  }
  return pastrate
}

async function descriere(el: ElementHandle<HTMLElement>) {
  return el.evaluate((node: HTMLElement) => {
    const tag = node.tagName.toLowerCase()
    const role = node.getAttribute('role')
    const nume = node.getAttribute('aria-label') || node.innerText?.replace(/\s+/g, ' ').trim() || node.getAttribute('data-tooltip') || node.getAttribute('title') || node.getAttribute('data-tooltip-title') || '(fără text)'
    return `${tag}${role ? `[${role}]` : ''} „${nume.slice(0, 70)}”`
  })
}

/** Trece cu mausul peste fiecare element și notează ce tooltip apare. */
async function verificaEcran(page: Page, nume: string, rol: Rol, scope?: string) {
  const start = Date.now()
  await page.mouse.move(0, 0)
  const elemente = await candidati(page, scope)
  const ecran: Ecran = { nume, rol, url: page.url().replace(/^https?:\/\/[^/]+/, ''), elemente: [], mostre: [], durataMs: 0 }
  // Mostrele de captură: câteva elemente răspândite pe tot ecranul.
  const pas = Math.max(1, Math.floor(elemente.length / 6))
  const lipsuri: ElementHandle<HTMLElement>[] = []

  for (let i = 0; i < elemente.length; i++) {
    const el = elemente[i]
    let text: string | null = null
    let stare: Rezultat['stare'] = 'ok'
    let desc = '(detașat)'
    try {
      desc = await descriere(el)
      const dezactivat = await el.evaluate((node: HTMLElement) => (node as HTMLButtonElement).disabled === true)
      if (dezactivat) {
        // Chromium nu trimite evenimente de maus pe un buton dezactivat; ce se
        // poate verifica e că are de unde să-și ia explicația.
        const are = await el.evaluate((node: HTMLElement) => !!(node.getAttribute('data-tooltip') || node.getAttribute('title') || node.getAttribute('aria-label')))
        ecran.elemente.push({ descriere: desc, tooltip: null, stare: are ? 'dezactivat' : 'lipsă' })
        if (!are) lipsuri.push(el)
        continue
      }
      await el.evaluate((node: HTMLElement) => node.scrollIntoView({ block: 'center', inline: 'center' }))
      await page.waitForTimeout(40)
      await el.hover({ timeout: 2500 })
      text = await tooltipVizibil(page, 2200, el)
      stare = text ? 'ok' : 'lipsă'
    } catch {
      stare = 'acoperit'
    }
    ecran.elemente.push({ descriere: desc, tooltip: text, stare })
    if (stare === 'lipsă') lipsuri.push(el)

    if (stare === 'ok' && i % pas === 0 && ecran.mostre.length < 6) {
      const tip = await page.$('#sg-tooltip')
      const a = await el.boundingBox()
      const b = await tip?.boundingBox()
      if (a && b) {
        const x = Math.max(0, Math.min(a.x, b.x) - 24)
        const y = Math.max(0, Math.min(a.y, b.y) - 16)
        const w = Math.min(page.viewportSize()!.width - x, Math.max(a.x + a.width, b.x + b.width) - x + 24)
        const h = Math.min(page.viewportSize()!.height - y, Math.max(a.y + a.height, b.y + b.height) - y + 16)
        const fisier = `${slug(`${rol}-${nume}`)}-${ecran.mostre.length + 1}.png`
        await page.screenshot({ path: path.join(SHOTS, fisier), clip: { x, y, width: w, height: h } })
        ecran.mostre.push({ fisier, element: desc, tooltip: text! })
      }
    }
  }

  // Ce n-are tooltip, încercuit cu roșu pe o captură a întregului ecran.
  if (lipsuri.length > 0) {
    await page.mouse.move(0, 0)
    for (const el of lipsuri) {
      await el.evaluate((node: HTMLElement) => { node.style.outline = '3px solid #9B2C21'; node.style.outlineOffset = '2px' }).catch(() => {})
    }
    await lipsuri[0].evaluate((node: HTMLElement) => node.scrollIntoView({ block: 'center' })).catch(() => {})
    const fisier = `${slug(`${rol}-${nume}`)}-lipsuri.png`
    await page.screenshot({ path: path.join(SHOTS, fisier), fullPage: true })
    ecran.capturaLipsuri = fisier
  }

  ecran.durataMs = Date.now() - start
  salveaza(`ecran-${rol}-${nume}`, { tip: 'ecran', ...ecran })
  const lipsa = ecran.elemente.filter(e => e.stare === 'lipsă')
  expect.soft(lipsa.map(e => e.descriere), `${nume} (${rol}): elemente fără tooltip`).toEqual([])
  return ecran
}

test.describe('Tooltip-uri pe toate butoanele', () => {
  test.beforeAll(() => fs.mkdirSync(SHOTS, { recursive: true }))
  test.skip(({ isMobile }) => isMobile, 'Tooltip-urile apar doar cu maus; pe touch nu există hover.')
  test.describe.configure({ timeout: 15 * 60_000 })

  for (const [nume, ruta, rol] of RUTE_APLICATIE) {
    test(`${nume} (${rol})`, async ({ page }) => {
      await autentifica(page, rol)
      await page.goto(ruta, { waitUntil: 'networkidle' })
      await page.waitForTimeout(1200)
      await verificaEcran(page, nume, rol)
    })
  }

  test('pagina proiectului, ca echipă — cu o activitate deschisă', async ({ page }) => {
    test.skip(!projectId, 'E2E_PROJECT_ID lipsește')
    await autentifica(page, 'staff')
    await page.goto(`/projects/${projectId}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    await page.getByRole('button', { name: /^Extinde activitatea/ }).first().click()
    await page.waitForTimeout(600)
    await verificaEcran(page, 'pagina proiectului', 'staff')
  })

  test('pagina proiectului, ca admin', async ({ page }) => {
    test.skip(!projectId, 'E2E_PROJECT_ID lipsește')
    await autentifica(page, 'admin')
    await page.goto(`/projects/${projectId}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    await verificaEcran(page, 'pagina proiectului', 'admin')
  })

  test('pagina proiectului, ca client — cu o activitate deschisă', async ({ page }) => {
    test.skip(!projectId, 'E2E_PROJECT_ID lipsește')
    await autentifica(page, 'client')
    await page.goto(`/projects/${projectId}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    await page.getByRole('button', { name: /^Extinde activitatea/ }).first().click()
    await page.waitForTimeout(600)
    await verificaEcran(page, 'pagina proiectului', 'client')
  })

  test('acasă, ca client', async ({ page }) => {
    await autentifica(page, 'client')
    await page.goto('/', { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    await verificaEcran(page, 'acasă', 'client')
  })

  test('fișa unei cereri (dialog)', async ({ page }) => {
    test.skip(!projectId, 'E2E_PROJECT_ID lipsește')
    await autentifica(page, 'staff')
    await page.goto(`/projects/${projectId}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    await page.getByRole('button', { name: /^Extinde activitatea/ }).first().click()
    await page.locator('main [id^="request-"] h3').first().click()
    await page.getByRole('dialog').first().waitFor()
    await page.waitForTimeout(800)
    await verificaEcran(page, 'fișa cererii', 'staff', '[role="dialog"]')
    await page.keyboard.press('Escape')
  })

  test('formularul „Cerere de document nouă” (dialog)', async ({ page }) => {
    test.skip(!projectId, 'E2E_PROJECT_ID lipsește')
    await autentifica(page, 'staff')
    await page.goto(`/projects/${projectId}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    await page.getByRole('button', { name: /^Extinde activitatea/ }).first().click()
    await page.getByRole('button', { name: 'Adaugă cerere de document nouă' }).first().click()
    await page.getByRole('dialog', { name: 'Cerere de document nouă' }).waitFor()
    await page.waitForTimeout(600)
    await verificaEcran(page, 'formular cerere nouă', 'staff', '[role="dialog"]')
    await page.keyboard.press('Escape')
  })

  test('de la tastatură: tooltip-ul apare la focus, ca la maus', async ({ page }) => {
    test.skip(!projectId, 'E2E_PROJECT_ID lipsește')
    await autentifica(page, 'staff')
    await page.goto(`/projects/${projectId}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    const probleme: string[] = []
    let verificate = 0
    let cuTooltip = 0
    // De la începutul paginii, primele 30 de opriri ale lui Tab.
    await page.locator('body').click({ position: { x: 5, y: 5 } })
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab')
      await page.waitForTimeout(60)
      const activ = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        if (!el || el === document.body) return null
        const candidat = el.closest('button, a[href], [role="button"], [role="switch"], [role="tab"], [data-tooltip], [title]')
        return candidat ? (el.getAttribute('aria-label') || el.innerText || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 60) : null
      })
      if (!activ) continue
      verificate++
      const text = await tooltipVizibil(page, 1200)
      if (text) cuTooltip++
      else probleme.push(activ)
    }
    salveaza('tastatura', { tip: 'tastatura', ecran: 'pagina proiectului (Tab)', verificate, cuTooltip, probleme })
    expect.soft(probleme, 'elemente focalizate fără tooltip').toEqual([])
  })

  test('comportament: Escape îl închide, mausul poate trece pe el, întârzierea', async ({ page }) => {
    test.skip(!projectId, 'E2E_PROJECT_ID lipsește')
    await autentifica(page, 'staff')
    await page.goto(`/projects/${projectId}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    const cautare = page.getByRole('button', { name: 'Caută în proiect' })
    const comportament: Comportament[] = []

    // Întârzierea (D6): nu apare la 0,7 s, apare până la 2 s.
    await page.mouse.move(0, 0)
    await page.waitForTimeout(700)
    await cautare.hover()
    const devreme = await tooltipVizibil(page, 700)
    const dupa = await tooltipVizibil(page, 1300)
    comportament.push({ regula: 'Apare după o secundă, nu mai devreme', trece: !devreme && !!dupa, detaliu: `la 0,7 s: ${devreme ? 'da' : 'nu'}; până la 2 s: ${dupa ?? '—'}` })

    // Escape îl închide (WCAG 1.4.13 — se poate închide).
    await page.keyboard.press('Escape')
    const dupaEscape = await tooltipVizibil(page, 300)
    comportament.push({ regula: 'Escape îl închide (WCAG 1.4.13)', trece: !dupaEscape, detaliu: dupaEscape ? `încă vizibil: ${dupaEscape}` : 'ascuns' })

    // Mausul poate trece de pe buton pe tooltip fără să-l piardă (WCAG 1.4.13).
    await page.mouse.move(0, 0)
    await page.waitForTimeout(500)
    await cautare.hover()
    await tooltipVizibil(page, 2200)
    const tip = await page.locator('#sg-tooltip').boundingBox()
    if (tip) await page.mouse.move(tip.x + tip.width / 2, tip.y + tip.height / 2, { steps: 4 })
    await page.waitForTimeout(400)
    const pePropriu = await tooltipVizibil(page, 300)
    comportament.push({ regula: 'Mausul poate trece pe tooltip fără să dispară (WCAG 1.4.13)', trece: !!pePropriu, detaliu: pePropriu ? 'rămâne vizibil' : 'a dispărut' })

    // Plecat de pe ambele, dispare.
    await page.mouse.move(5, 5)
    await page.waitForTimeout(400)
    const plecat = await tooltipVizibil(page, 300)
    comportament.push({ regula: 'Dispare când mausul pleacă', trece: !plecat, detaliu: plecat ? 'rămâne' : 'ascuns' })

    // Descrie elementul pentru cititoarele de ecran cât se vede.
    await cautare.hover()
    await tooltipVizibil(page, 2200)
    const descris = await cautare.getAttribute('aria-describedby')
    comportament.push({ regula: 'Butonul e descris de tooltip (aria-describedby) cât se vede', trece: !!descris?.includes('sg-tooltip'), detaliu: descris ?? '—' })

    salveaza('comportament', { tip: 'comportament', reguli: comportament })
    for (const c of comportament) expect.soft(c.trece, c.regula).toBe(true)
  })

  test('panoul fazelor: o plimbare peste faze nu aprinde tooltip-uri, iar tooltip-ul stă în dreapta', async ({ page }) => {
    test.skip(!projectId, 'E2E_PROJECT_ID lipsește')
    await autentifica(page, 'staff')
    await page.goto(`/projects/${projectId}`, { waitUntil: 'networkidle' })
    const faze = page.locator('aside nav [data-tooltip-side="right"][data-tooltip*="în tabel"]')
    test.skip(await faze.count() < 4, 'prea puține faze')
    // S-15: trei faze la rând, la 300 ms una de alta: niciun tooltip.
    await page.mouse.move(0, 0)
    for (let i = 0; i < 3; i++) {
      await faze.nth(i).hover()
      await page.waitForTimeout(300)
      expect(await tooltipVizibil(page, 50), `tooltip aprins pe faza ${i + 1}`).toBeNull()
    }
    // S-14: oprit pe o fază, tooltip-ul nu acoperă faza următoare.
    await faze.nth(1).hover()
    expect(await tooltipVizibil(page, 2200)).not.toBeNull()
    const tip = (await page.locator('#sg-tooltip').boundingBox())!
    const urmatoarea = (await faze.nth(2).boundingBox())!
    const peste = tip.x < urmatoarea.x + urmatoarea.width && tip.x + tip.width > urmatoarea.x
      && tip.y < urmatoarea.y + urmatoarea.height && tip.y + tip.height > urmatoarea.y
    expect(peste, 'tooltip-ul fazei acoperă faza următoare').toBe(false)
  })

  test.afterAll(() => {
    if (!fs.existsSync(REZULTATE)) return
    const toate = fs.readdirSync(REZULTATE).filter(f => f.endsWith('.json')).sort()
      .map(f => JSON.parse(fs.readFileSync(path.join(REZULTATE, f), 'utf8')))
    const raport: Ecran[] = toate.filter(r => r.tip === 'ecran')
    const tastatura: Tastatura[] = toate.filter(r => r.tip === 'tastatura')
    const comportament: Comportament[] = toate.filter(r => r.tip === 'comportament').flatMap(r => r.reguli)
    fs.writeFileSync(path.join(OUT, 'raport.json'), JSON.stringify({ raport, tastatura, comportament }, null, 2))
    fs.writeFileSync(path.join(OUT, 'raport.html'), randeaza(raport, tastatura, comportament))
  })
})

function esc(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function randeaza(raport: Ecran[], tastatura: Tastatura[], comportament: Comportament[]): string {
  const total = raport.reduce((n, e) => n + e.elemente.length, 0)
  const ok = raport.reduce((n, e) => n + e.elemente.filter(x => x.stare === 'ok').length, 0)
  const lipsa = raport.reduce((n, e) => n + e.elemente.filter(x => x.stare === 'lipsă').length, 0)
  const acoperite = raport.reduce((n, e) => n + e.elemente.filter(x => x.stare === 'acoperit').length, 0)
  const dezactivate = raport.reduce((n, e) => n + e.elemente.filter(x => x.stare === 'dezactivat').length, 0)
  const data = new Date().toLocaleString('ro-RO')
  const ecrane = raport.map(e => {
    const n = (s: Rezultat['stare']) => e.elemente.filter(x => x.stare === s).length
    const lipsuri = e.elemente.filter(x => x.stare === 'lipsă' || x.stare === 'acoperit')
    return `
    <section>
      <h2>${esc(e.nume)} <span class="rol">${e.rol}</span> <span class="${n('lipsă') ? 'rau' : 'bun'}">${n('lipsă') ? `${n('lipsă')} fără tooltip` : 'toate au tooltip'}</span></h2>
      <p class="meta">${esc(e.url)} · ${e.elemente.length} elemente verificate · ${n('ok')} cu tooltip · ${n('acoperit')} acoperite · ${n('dezactivat')} dezactivate · ${(e.durataMs / 1000).toFixed(0)} s</p>
      ${lipsuri.length ? `<table><tr><th>Element</th><th>Problemă</th></tr>${lipsuri.map(x => `<tr><td>${esc(x.descriere)}</td><td>${x.stare === 'lipsă' ? 'fără tooltip' : 'acoperit de alt element la hover'}</td></tr>`).join('')}</table>` : ''}
      ${e.capturaLipsuri ? `<p><a href="capturi/${e.capturaLipsuri}">Captură cu elementele fără tooltip încercuite</a></p>` : ''}
      <div class="mostre">${e.mostre.map(m => `<figure><img src="capturi/${m.fisier}" alt=""><figcaption>${esc(m.element)}<br><b>${esc(m.tooltip)}</b></figcaption></figure>`).join('')}</div>
      <details><summary>Toate elementele (${e.elemente.length})</summary>
        <table><tr><th>Element</th><th>Tooltip</th><th>Stare</th></tr>${e.elemente.map(x => `<tr><td>${esc(x.descriere)}</td><td>${esc(x.tooltip ?? '—')}</td><td class="${x.stare === 'ok' ? 'bun' : x.stare === 'lipsă' ? 'rau' : ''}">${x.stare}</td></tr>`).join('')}</table>
      </details>
    </section>`
  }).join('')
  return `<!doctype html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Raport tooltip-uri</title>
<style>
  body { font: 14px/1.5 system-ui, sans-serif; background: #F5F4F0; color: #16181C; margin: 0; padding: 24px 16px; }
  main { max-width: 1100px; margin: 0 auto; }
  h1 { font-size: 26px; margin: 0 0 4px; } h2 { font-size: 17px; margin: 0 0 4px; }
  section { background: #fff; border: 1px solid #D9D6CD; border-radius: 3px; padding: 16px 18px; margin: 14px 0; }
  .meta { color: #4A4F57; margin: 0 0 10px; font-size: 13px; }
  .rol { font-size: 12px; font-weight: 600; color: #4A4F57; background: #EDEBE5; padding: 1px 6px; border-radius: 2px; }
  .bun { color: #1F6B3A; font-weight: 600; } .rau { color: #9B2C21; font-weight: 600; }
  h2 .bun, h2 .rau { font-size: 13px; margin-left: 6px; }
  .rezumat { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 16px 0; }
  .rezumat div { background: #fff; border: 1px solid #D9D6CD; border-radius: 3px; padding: 10px 12px; }
  .rezumat b { display: block; font-size: 22px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; margin: 8px 0; }
  th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid #EDEBE5; vertical-align: top; }
  th { color: #4A4F57; font-weight: 600; }
  .mostre { display: flex; flex-wrap: wrap; gap: 12px; margin: 10px 0; }
  figure { margin: 0; max-width: 340px; } figure img { max-width: 100%; border: 1px solid #D9D6CD; border-radius: 2px; }
  figcaption { font-size: 12px; color: #4A4F57; margin-top: 4px; }
  details summary { cursor: pointer; color: #0E4C4A; font-weight: 600; margin-top: 6px; }
</style></head><body><main>
<h1>Raport tooltip-uri</h1>
<p class="meta">Generat ${esc(data)} · Playwright, Chromium desktop 1440×900 · fiecare element apăsabil vizibil, verificat cu mausul</p>
<div class="rezumat">
  <div><b>${raport.length}</b>ecrane</div>
  <div><b>${total}</b>elemente verificate</div>
  <div><b class="bun">${ok}</b>cu tooltip</div>
  <div><b class="${lipsa ? 'rau' : 'bun'}">${lipsa}</b>fără tooltip</div>
  <div><b>${acoperite}</b>acoperite la hover</div>
  <div><b>${dezactivate}</b>dezactivate (verificate din atribute)</div>
</div>
${comportament.length ? `<section><h2>Comportament</h2><table><tr><th>Regulă</th><th>Rezultat</th><th>Detaliu</th></tr>${comportament.map(c => `<tr><td>${esc(c.regula)}</td><td class="${c.trece ? 'bun' : 'rau'}">${c.trece ? 'trece' : 'pică'}</td><td>${esc(c.detaliu)}</td></tr>`).join('')}</table></section>` : ''}
${tastatura.map(t => `<section><h2>Tastatură — ${esc(t.ecran)}</h2><p class="meta">${t.verificate} opriri de Tab pe elemente apăsabile · ${t.cuTooltip} cu tooltip</p>${t.probleme.length ? `<table><tr><th>Fără tooltip la focus</th></tr>${t.probleme.map(p => `<tr><td>${esc(p)}</td></tr>`).join('')}</table>` : '<p class="bun">Toate au tooltip la focus.</p>'}</section>`).join('')}
${ecrane}
</main></body></html>`
}
