import { test, expect } from './fixtures'
import { seedProject, seedTemplate, tag } from './support'
import { TemplatesListPage } from '../pages/TemplatesListPage'
import { TemplateEditorPage } from '../pages/TemplateEditorPage'
import type { Page } from '@playwright/test'

/**
 * Flux 11 — navigarea: meniul de sus și antetul paginilor din meniu rămân
 * lipite la derulare și nu acoperă ce e sub ele (nici focusul de la tastatură,
 * WCAG 2.4.11); fâșia de locație apare doar pe nivelul 2, fără „Bonie”, iar
 * linkurile ei duc unde trebuie.
 */

const MENU_PAGES: { url: string; title: string | RegExp; role: 'admin' }[] = [
  { url: '/', title: /^Salut/, role: 'admin' },
  { url: '/admin/templates', title: 'Șabloane', role: 'admin' },
  { url: '/admin/users', title: 'Utilizatori', role: 'admin' },
  { url: '/admin/audit', title: /Audit|Jurnal/, role: 'admin' },
  { url: '/admin/proiecte', title: /Proiecte|Tablou/, role: 'admin' },
]

const navbar = (page: Page) => page.getByRole('navigation', { name: 'Navigare principală' })
const strip = (page: Page) => page.getByRole('navigation', { name: 'Locație' })

/** Elementul cu focus e vizibil: în centrul lui nu stă alt element (meniul sau antetul lipit). */
async function focusedObscuredBy(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (!el || el === document.body) return null
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    if (!hit) return `${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 40)} în afara ecranului`
    if (el.contains(hit) || hit.contains(el)) return null
    const cover = hit.closest('nav, header, [class*="sticky"]') ?? hit
    return `${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 40)} acoperit de <${cover.tagName.toLowerCase()} ${cover.getAttribute('aria-label') ?? ''}>`
  })
}

test.describe('Flux 11 — navigarea', () => {
  for (const { url, title, role } of MENU_PAGES) {
    test(`${url}: fără fâșie de locație; meniul și antetul rămân lipite la derulare`, async ({ team, as }) => {
      // Un ecran de laptop mic: pagina are ce derula și cu datele locale.
      const page = await as(team[role], { viewport: { width: 1280, height: 520 } })
      await page.goto(url)
      const heading = page.getByRole('heading', { level: 1, name: title })
      await expect(heading).toBeVisible()
      await expect(strip(page)).toHaveCount(0)
      await expect(page.getByRole('main').getByRole('link', { name: 'Bonie', exact: true })).toHaveCount(0)

      const header = page.locator('header').filter({ has: heading })
      const start = (await header.boundingBox())!
      // Conținutul (tabele, liste) vine după titlu: se derulează după ce pagina e destul de înaltă.
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight), { message: 'pagina e prea scurtă ca să se deruleze' })
        .toBeGreaterThan(520 + start.y + start.height + 100)
      await page.mouse.move(640, 400)
      await page.mouse.wheel(0, 1500)
      // Derulat mai mult decât până la marginea de jos a antetului: nelipit, ar fi ieșit din ecran.
      await expect.poll(() => page.evaluate(() => window.scrollY), { message: 'pagina nu derulează destul ca să se vadă dacă antetul e lipit' }).toBeGreaterThan(start.y + start.height)
      await expect.poll(async () => (await navbar(page).boundingBox())!.y, { message: 'meniul de sus nu stă lipit' }).toBe(0)
      await expect(navbar(page)).toBeInViewport()
      await expect.poll(async () => (await header.boundingBox())!.y, { message: 'antetul paginii nu stă lipit sub meniu' }).toBe(64)
      await expect(header).toHaveAttribute('data-stuck', 'true')
    })
  }

  for (const url of ['/', '/admin/templates', '/admin/users']) {
    test(`${url}: focusul mutat în sus cu Shift+Tab nu ajunge sub meniul sau antetul lipit`, async ({ team, as }) => {
      const page = await as(team.admin)
      await page.goto(url)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await page.mouse.click(2, 400)
      await page.keyboard.press('End')
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300)
      for (let i = 0; i < 25; i++) {
        await page.keyboard.press('Shift+Tab')
        // WebKit poate termina derularea pentru focus după evenimentul de tastatură.
        await expect.poll(() => focusedObscuredBy(page), {
          message: 'element cu focus ascuns sub barele lipite',
          timeout: 1000,
        }).toBeNull()
      }
    })
  }

  test('fâșia de locație apare doar pe nivelul 2, fără „Bonie”, cu linkurile spre pagina de deasupra', async ({ team, as, seeds }) => {
    const project = await seedProject({ label: 'fasie', client: team.client, members: [team.senior], phases: [{ name: 'Faza' }] })
    seeds.projects.add(project.id)
    const template = await seedTemplate({ label: `fasie ${tag()}`, phases: [{ name: 'Faza' }] })
    seeds.templates.add(template.id)
    const page = await as(team.admin)

    const cases = [
      { open: `/projects/${project.id}`, segments: ['Proiecte', project.title], back: 'Proiecte', to: '/' },
      { open: '/projects/new', segments: ['Proiecte', 'Dosar nou'], back: 'Proiecte', to: '/' },
      { open: `/admin/users/${team.junior.id}`, segments: ['Utilizatori', team.junior.fullName], back: 'Utilizatori', to: '/admin/users' },
    ]
    for (const c of cases) {
      await page.goto(c.open)
      await expect(strip(page).getByRole('listitem')).toHaveCount(c.segments.length)
      // Despărțitorul „/” stă în același `li`, ascuns cititoarelor de ecran.
      expect((await strip(page).getByRole('listitem').allInnerTexts()).map(t => t.replace(/^\/\s*/, '').trim())).toEqual(c.segments)
      await expect(strip(page)).not.toContainText('Bonie')
      const current = strip(page).getByRole('listitem').last()
      await expect(current.getByRole('link')).toHaveCount(0)
      await expect(current.locator('[aria-current="page"]')).toHaveText(c.segments[c.segments.length - 1])
      const back = strip(page).getByRole('link', { name: c.back, exact: true })
      await expect(back).toHaveAttribute('data-tooltip', `Înapoi la ${c.back}`)
      await back.click()
      await expect(page).toHaveURL(url => url.pathname === c.to)
    }

    // Editorul de șablon: „Șabloane / <nume>”, cu „Șabloane” drum înapoi în listă.
    const list = new TemplatesListPage(page)
    const editor = new TemplateEditorPage(page)
    await list.goto()
    await list.action(template.name, 'Editează')
    await expect(strip(page)).toBeVisible()
    expect((await strip(page).getByRole('listitem').allInnerTexts()).map(t => t.replace(/^\/\s*/, '').trim())).toEqual(['Șabloane', template.name])
    await strip(page).getByRole('button', { name: 'Șabloane', exact: true }).click()
    await expect(editor.heading).toHaveCount(0)
    await expect(list.heading).toBeVisible()
    await expect(strip(page)).toHaveCount(0)
  })
})
