import { test, expect } from '@playwright/test'
import {
  autentifica, uiConfig, ascultaErorile,
  elementeIesiteDinEcran, derulareOrizontala, glisa,
} from './helpers'

const { projectId } = uiConfig()

/**
 * Condițiile în care chiar se ține telefonul în mână.
 *
 * `mobil.spec.ts` verifică macheta pe un telefon ideal: rețea de fibră, ecran
 * întreg, aparatul ținut drept, nicio tastatură pe ecran. Niciuna dintre
 * ipoteze nu ține pe teren. Fișierul ăsta scoate exact ipotezele, una câte una,
 * fiindcă acolo se rupe aplicația în realitate — nu la 412px lățime.
 *
 * Stau separat de `mobil.spec.ts` pentru că se plătesc scump: fiecare își
 * strică deliberat mediul (rețea limitată, fereastră schimbată, media emulată)
 * și nu vrei să tragi costul ăsta peste toate testele de machetă.
 */
test.describe('Telefonul, în condiții reale', () => {
  test.skip(({ isMobile }) => !isMobile, 'rulează doar pe proiectele cu ecran tactil')

  // ─── Rețeaua ──────────────────────────────────────────────────────────────

  test('pe 3G lent ecranul nu rămâne alb și ajunge la conținut', async ({ page, browserName }) => {
    // Limitarea de rețea nu e în API-ul Playwright; se cere prin CDP, deci
    // există doar în Chromium. Pe WebKit testul n-are cum să existe.
    test.skip(browserName !== 'chromium', 'limitarea de rețea vine din CDP (doar Chromium)')
    test.setTimeout(120_000)

    await autentifica(page, 'staff')
    const erori = ascultaErorile(page)

    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Network.enable')
    // 3G „bun”, cifrele din panoul de rețea al Chrome: 400 kbps în jos,
    // 400ms dus-întors. E rețeaua din tren și de pe șantier, adică exact
    // locurile din care se deschide aplicația asta.
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 400,
      downloadThroughput: (400 * 1024) / 8,
      uploadThroughput: (400 * 1024) / 8,
    })

    await page.goto('/notificari', { waitUntil: 'commit' })

    // Întâi: ceva pe ecran cât se așteaptă datele. Un ecran alb timp de zece
    // secunde e citit ca aplicație stricată, iar pe telefon omul închide fila.
    await expect(
      page.locator('h1, [role="status"], [aria-busy="true"], .animate-spin').first(),
      'un semn de viață înainte de date',
    ).toBeVisible({ timeout: 20_000 })

    // Apoi: chiar ajunge la conținut, nu rămâne agățat în încărcare.
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 60_000 })

    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
    })
    expect(erori.filter(e => !e.includes('Missing Authorization') && !e.includes('404'))).toEqual([])
  })

  test('o cerere de date căzută nu dărâmă ecranul', async ({ page }) => {
    await autentifica(page, 'staff')

    /**
     * Se taie cererile de date, nu toată rețeaua.
     *
     * `context.setOffline(true)` pare varianta evidentă, dar măsoară altceva:
     * pe un `<Link>` fără date în cache, routerul Next cade înapoi pe o
     * navigare întreagă, care offline nu ajunge la server — și rămâi cu
     * `chrome-error://chromewebdata`, pagina browserului. Verificat: ecran alb,
     * `document.body.innerText` gol. Aplicația nici măcar nu rulează acolo,
     * deci n-are ce testa; ar fi un test pe care niciun cod al nostru nu-l
     * poate trece.
     *
     * Ce ține de noi sunt cererile *noastre* de date. Blocate exact ele,
     * carcasa rămâne în picioare și se vede dacă un `fetch` picat e prins sau
     * urcă până sus și albește ecranul.
     */
    await page.route(/\/api\/|supabase\.co\//, route => route.abort('internetdisconnected'))
    const erori = ascultaErorile(page)

    await page.getByRole('navigation', { name: 'Navigare principală' })
      .getByRole('link', { name: 'Calendar', exact: true }).click()
    await expect(page).toHaveURL(/\/calendar/)

    // Nu se cere ca datele să apară — n-au de unde. Se cere ca ecranul să
    // rămână un ecran: carcasa la locul ei, un titlu, nicio excepție netratată.
    await expect(page.getByRole('navigation', { name: 'Navigare principală' })).toBeVisible()
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 20_000 })
    expect(
      erori.filter(e => e.startsWith('pageerror')),
      'o cerere picată nu are voie să arunce o excepție netratată',
    ).toEqual([])
  })

  // ─── Aparatul întors în mână ──────────────────────────────────────────────

  test('rotirea în timpul folosirii nu lasă nimic în afara ecranului', async ({ page, viewport }) => {
    test.skip(!viewport, 'proiectul nu are fereastră fixă')
    await autentifica(page, 'staff')

    const portret = { ...viewport! }
    const peisaj = { width: portret.height, height: portret.width }

    // Rotirea nu e „altă lățime”, e o **schimbare la cald**: macheta deja
    // așezată trebuie să se reașeze. `adaptiv.spec.ts` pornește de fiecare dată
    // de la o fereastră curată, deci nu prinde niciodată cazul ăsta.
    for (const [nume, dim] of [['peisaj', peisaj], ['înapoi în portret', portret]] as const) {
      await page.setViewportSize(dim)
      await expect(page.locator('h1').first()).toBeVisible({ timeout: 20_000 })
      expect(await elementeIesiteDinEcran(page), `după rotire în ${nume}`).toEqual([])
      expect(await derulareOrizontala(page), `derulare laterală în ${nume}`).toBe(false)
    }
  })

  test('sertarul de faze rămâne întreg dacă rotești cu el deschis', async ({ page, viewport }) => {
    test.skip(!projectId, 'E2E_PROJECT_ID lipsește din .env.e2e.local')
    test.skip((viewport?.width ?? 0) >= 768, 'de la 768px panoul e coloană fixă, nu sertar')

    await autentifica(page, 'staff')
    await page.goto(`/projects/${projectId}`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: /Toate fazele/ }).tap()
    await expect(page.getByText('Toate fazele', { exact: true })).toBeVisible()

    // Un sertar poziționat în procente din lățime se rupe la rotire dacă
    // lățimea a fost calculată o dată, la deschidere.
    await page.setViewportSize({ width: viewport!.height, height: viewport!.width })
    await expect(page.getByText('Toate fazele', { exact: true })).toBeVisible()

    const cutie = (await page.locator('aside').first().boundingBox())!
    expect(cutie.x, 'sertarul nu fuge în afara ecranului la rotire').toBeGreaterThanOrEqual(-1)
    expect(cutie.width, 'sertarul lasă în continuare pagina să se vadă pe margine')
      .toBeLessThanOrEqual(viewport!.height * 0.86)
    expect(await derulareOrizontala(page)).toBe(false)
  })

  // ─── Tastatura care urcă peste jumătate de ecran ──────────────────────────

  test('cu tastatura pe ecran, câmpul de scris rămâne la îndemână', async ({ page, viewport }) => {
    test.skip(!viewport, 'proiectul nu are fereastră fixă')
    /**
     * BUG CUNOSCUT — `app/chat/page.tsx:209`.
     *
     * Containerul chatului e `h-[calc(100vh-88px)] min-h-[600px]
     * overflow-hidden`. Când tastatura urcă, fereastra vizibilă scade la 461px,
     * dar `min-h-[600px]` ține macheta la 600px, iar `overflow-hidden` taie ce
     * trece de ea. Măsurat: câmpul ajunge la y=630 într-o fereastră de 461px,
     * iar `document.scrollHeight === clientHeight` — pagina nu derulează, deci
     * nu există niciun gest prin care să ajungi la el. Scrii pe nevăzute.
     *
     * În plus `100vh` e greșit pe telefon: e fereastra *fără* bara browserului,
     * deci containerul e mai înalt decât ecranul chiar și fără tastatură.
     * `100dvh` e unitatea potrivită.
     *
     * `test.fail()` ține testul în suită fără s-o înroșească, și o înroșește
     * exact când cineva repară — semn că se poate scoate marcajul.
     */
    test.fail(true, 'app/chat/page.tsx:209 — min-h-[600px] + overflow-hidden ascunde câmpul sub tastatură')
    await autentifica(page, 'staff')
    await page.goto('/chat', { waitUntil: 'networkidle' })

    const conversatii = page.locator('aside button').filter({ hasNot: page.locator('input') })
    test.skip(await conversatii.count() === 0, 'contul nu are conversații')
    await conversatii.first().tap()

    const camp = page.getByPlaceholder(/Scrie un mesaj/)
    await expect(camp).toBeVisible({ timeout: 20_000 })

    /**
     * Tastatura nu se poate desena din Playwright, dar efectul ei asupra
     * machetei se poate: fereastra vizibilă devine mai scundă. Tastatura
     * Android ia în jur de 45% din înălțime, deci rămâne ~55%.
     *
     * Ce se cere e minimul absolut: câmpul în care tocmai scrii să fie pe
     * ecran. Dacă nu e, scrii pe nevăzute — și niciun buton de trimitere nu se
     * poate atinge.
     */
    await page.setViewportSize({ width: viewport!.width, height: Math.round(viewport!.height * 0.55) })
    await expect(camp, 'câmpul de scris a ieșit sub tastatură').toBeInViewport()
  })

  // ─── Textul mărit de utilizator ───────────────────────────────────────────

  test('spațierea mărită a textului nu taie nimic (WCAG 1.4.12)', async ({ page }) => {
    await autentifica(page, 'staff')

    /**
     * Valorile sunt chiar cele din criteriu, nu inventate: interlinie 1.5,
     * spațiu între litere 0.12em, între cuvinte 0.16em, între paragrafe 2em.
     * Sunt setările pe care le pun pe telefon oamenii cu dislexie sau cu vedere
     * slabă, prin extensie sau prin setările sistemului.
     *
     * Criteriul nu cere ca ecranul să arate la fel — cere să nu se piardă
     * conținut sau funcție. De asta se verifică doar ce se pierde: text tăiat
     * de container și elemente ieșite din ecran.
     */
    await page.addStyleTag({ content: `
      * {
        line-height: 1.5 !important;
        letter-spacing: 0.12em !important;
        word-spacing: 0.16em !important;
      }
      p, li, h1, h2, h3 { margin-bottom: 2em !important; }
    ` })
    await expect(page.locator('h1').first()).toBeVisible()

    expect(await elementeIesiteDinEcran(page), 'elemente ieșite din ecran cu text spațiat').toEqual([])
    expect(await derulareOrizontala(page), 'derulare laterală cu text spațiat').toBe(false)

    // Textul tăiat de propriul container: `overflow: hidden` pe o casetă cu
    // înălțime fixă e locul unde dispare rândul al doilea.
    const taiate = await page.evaluate(() => {
      const rele: string[] = []
      for (const el of Array.from(document.querySelectorAll('h1,h2,h3,p,button,a,label,td,th'))) {
        if (el.children.length > 0) continue
        const st = getComputedStyle(el)
        if (st.overflow === 'visible' && st.overflowY === 'visible') continue
        if (st.textOverflow === 'ellipsis' || st.whiteSpace === 'nowrap') continue // tăiere voită
        if (el.scrollHeight > el.clientHeight + 2) {
          rele.push(`${el.tagName} „${(el.textContent || '').trim().slice(0, 30)}” — ${el.scrollHeight}px în ${el.clientHeight}px`)
        }
      }
      return rele
    })
    expect(taiate, 'text tăiat de containerul lui').toEqual([])
  })

  // ─── Mișcarea ─────────────────────────────────────────────────────────────

  test('cine cere mai puțină mișcare chiar o primește', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await autentifica(page, 'staff')
    await expect(page.locator('h1').first()).toBeVisible()

    // `globals.css` are regula; ce se verifică aici e că ajunge la toate
    // elementele. O animație pusă inline, sau una cu specificitate mai mare,
    // trece pe lângă ea — iar pentru cine are rău de mișcare, o singură
    // suprafață care încă alunecă e destul.
    const raman = await page.evaluate(() => {
      const rele: string[] = []
      for (const el of Array.from(document.querySelectorAll('*'))) {
        const st = getComputedStyle(el)
        const durate = [st.transitionDuration, st.animationDuration]
          .flatMap(d => (d || '').split(',').map(x => parseFloat(x.trim()) || 0))
        if (Math.max(0, ...durate) <= 0.05) continue
        rele.push(`${el.tagName}.${(el.className || '').toString().slice(0, 40)}`)
      }
      return Array.from(new Set(rele))
    })
    expect(raman, 'elemente care se mai mișcă deși s-a cerut mai puțină mișcare').toEqual([])
  })

  // ─── Degetul care trage ───────────────────────────────────────────────────

  test('fâșia de navigare se plimbă cu degetul, nu doar cu mausul', async ({ page, viewport, browserName }) => {
    test.skip(!viewport, 'proiectul nu are fereastră fixă')
    test.skip(browserName !== 'chromium', 'gestul de glisare se trimite prin CDP (doar Chromium)')
    await autentifica(page, 'admin')

    const derulator = page.getByRole('navigation', { name: 'Navigare principală' }).locator('.no-scrollbar')
    const lat = await derulator.evaluate(el => el.scrollWidth > el.clientWidth + 1)
    test.skip(!lat, 'la lățimea asta fâșia încape întreagă, n-are ce derula')

    const cutie = (await derulator.boundingBox())!
    const y = Math.round(cutie.y + cutie.height / 2)
    const inainte = await derulator.evaluate(el => el.scrollLeft)

    // Nu `mouse.wheel` și nici `scrollBy` din JavaScript: pe telefon nu există
    // rotiță, iar o derulare pusă la cale din cod merge chiar și pe o suprafață
    // cu `touch-action: none` — adică ar trece exact peste bug-ul căutat.
    // `glisa` trimite atingerea prin CDP, deci e degetul adevărat.
    await glisa(page, { x: Math.round(cutie.x + cutie.width - 24), y }, { dx: -160, dy: 0 })
    await expect.poll(() => derulator.evaluate(el => el.scrollLeft), {
      message: 'fâșia nu s-a mișcat sub deget',
    }).toBeGreaterThan(inainte)

    const dupa = await derulator.evaluate(el => el.scrollLeft)
    expect(dupa, 'fâșia chiar se derulează').toBeGreaterThan(inainte)

    // Ce contează la capăt: plimbarea fâșiei nu ia pagina cu ea.
    expect(await derulareOrizontala(page), 'pagina a plecat lateral odată cu fâșia').toBe(false)
  })
})
