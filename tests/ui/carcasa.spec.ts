import { test, expect } from '@playwright/test'
import { autentifica, ascultaErorile, ecranSanatos, fontulAplicat, derulareOrizontala } from './helpers'

test.describe('Carcasa aplicației', () => {
  test('pagina de login se deschide și e sănătoasă', async ({ page }) => {
    const erori = ascultaErorile(page)
    await page.goto('/login', { waitUntil: 'networkidle' })

    await expect(page.getByRole('heading', { name: 'Bonie', level: 1 })).toBeVisible()
    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(page.getByRole('button', { name: /Intră în cont/ })).toBeVisible()

    // Parola se poate arăta; butonul are nume, nu doar o pictogramă.
    const arata = page.getByRole('button', { name: 'Arată parola' })
    await expect(arata).toBeVisible()
    await arata.click()
    await expect(page.getByRole('button', { name: 'Ascunde parola' })).toBeVisible()

    expect(await derulareOrizontala(page)).toBe(false)
    expect(erori, 'erori de pagină pe login').toEqual([])
  })

  test('fontul de semnalizare e găzduit local și aplicat', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'networkidle' })
    // `next/font/local` redenumește familia; numele începe cu `signage`.
    expect(await fontulAplicat(page)).toMatch(/signage/i)

    // Nicio cerere către un CDN de fonturi: un 404 acolo a oprit odată livrarea.
    const cereriExterne: string[] = []
    page.on('request', r => {
      const u = r.url()
      if (/fonts\.(googleapis|gstatic)\.com/.test(u)) cereriExterne.push(u)
    })
    await page.reload({ waitUntil: 'networkidle' })
    expect(cereriExterne, 'fonturile nu au voie să vină din rețea').toEqual([])
  })

  test('săritul la conținut e primul element focusabil și duce la conținut', async ({ page }) => {
    await autentifica(page, 'staff')

    // Proprietatea care contează e ordinea documentului, nu de unde pornește
    // Tab-ul: browserul poate reține focusul de la navigarea precedentă.
    const primul = await page.evaluate(() => {
      const sel = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])'
      const el = document.querySelector(sel)
      return { clasa: (el?.className ?? '').toString(), text: el?.textContent?.trim() ?? '' }
    })
    expect(primul.clasa).toContain('skip-link')
    expect(primul.text).toBe('Sari la conținut')

    const salt = page.locator('a.skip-link')
    await salt.focus()
    // Ascuns până la focus, vizibil imediat ce ajunge pe el.
    await expect(salt).toBeInViewport()
    await salt.press('Enter')
    await expect(page.locator('#continut')).toBeVisible()
  })

  test('inelul de focus e vizibil și nu e suprimat', async ({ page }) => {
    await autentifica(page, 'staff')
    await page.goto('/', { waitUntil: 'networkidle' })
    // `:focus-visible` se aprinde la tastatură, nu la `.focus()` din cod —
    // exact distincția pe care se bazează regula din `globals.css`.
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    // `transition-colors` animează și `outline-color`; citit imediat, stilul
    // calculat e valoarea de la jumătatea tranziției, nu cea finală.
    await page.waitForTimeout(300)
    const contur = await page.locator(':focus').evaluate(el => {
      const s = getComputedStyle(el)
      return { style: s.outlineStyle, width: s.outlineWidth, color: s.outlineColor, offset: s.outlineOffset }
    })
    // Nu e destul să nu fie `none`: fără regula noastră, Chromium pune inelul
    // lui implicit și testul ar trece pe un `outline: none` în CSS.
    expect(contur.style, 'focusul nu are voie să fie suprimat').toBe('solid')
    expect(parseFloat(contur.width), 'inel de cel puțin 2px').toBeGreaterThanOrEqual(2)
    expect(parseFloat(contur.offset), 'decalaj, ca inelul să nu fie acoperit (2.4.11)').toBeGreaterThanOrEqual(2)
    // Petrolul sistemului, nu albastrul browserului. Se compară cu token-ul viu:
    // compilatorul trece culoarea prin alt spațiu, deci un hex scris de mână în
    // test ar fi o a doua sursă de adevăr, care se abate.
    const accent = await page.evaluate(() => {
      const s = document.createElement('span')
      s.style.color = 'var(--sg-accent)'
      document.body.appendChild(s)
      const c = getComputedStyle(s).color
      s.remove()
      return c
    })
    expect(contur.color, 'inelul poartă accentul sistemului').toBe(accent)
  })

  for (const [rol, vizibile, ascunse] of [
    ['admin', ['Proiecte', 'Chat', 'Calendar', 'Șabloane', 'Tablou de bord', 'Utilizatori', 'Audit'], []],
    ['staff', ['Proiecte', 'Chat', 'Calendar', 'Șabloane'], ['Utilizatori', 'Audit', 'Tablou de bord']],
    ['client', ['Proiecte'], ['Chat', 'Calendar', 'Șabloane', 'Utilizatori', 'Audit']],
  ] as const) {
    test(`navigarea arată doar ce are voie rolul ${rol}`, async ({ page }) => {
      await autentifica(page, rol)
      const nav = page.getByRole('navigation', { name: 'Navigare principală' })
      for (const eticheta of vizibile) {
        await expect(nav.getByRole('link', { name: eticheta, exact: true })).toBeVisible()
      }
      for (const eticheta of ascunse) {
        await expect(nav.getByRole('link', { name: eticheta, exact: true })).toHaveCount(0)
      }
    })
  }

  test('deconectarea duce înapoi la login', async ({ page }) => {
    await autentifica(page, 'staff')
    await page.getByRole('button', { name: 'Deconectare' }).click()
    await page.waitForURL(/\/login/, { timeout: 30_000 })
    await expect(page.getByRole('button', { name: /Intră în cont/ })).toBeVisible()
  })

  test('ecranul principal e sănătos', async ({ page }) => {
    await autentifica(page, 'staff')
    await ecranSanatos(page)
  })
})
