import { test, expect } from './fixtures'
import { seedProject } from './support'
import { ProjectTablePage } from '../pages/ProjectTablePage'
import type { Locator, Page } from '@playwright/test'
import type { Team } from './fixtures'

/**
 * Flux 10 — comportamentul tooltip-urilor (`components/ui/TooltipLayer.tsx`),
 * nu inventarul lor (acela e în tests/ui/tooltipuri.spec.ts). Timpul e al
 * ceasului paginii (`page.clock`), oprit și mutat de test: apare după exact o
 * secundă, fără animație; imediat la focus de la tastatură; Escape îl închide;
 * mausul poate trece pe el (WCAG 1.4.13); urmează elementul la derulare; nu
 * apare la atingere; în panoul fazelor stă în dreapta.
 */

const SEARCH_TIP = 'Caută în proiect: faze, activități, cereri  ·  tasta /'

function seed(team: Team) {
  return seedProject({
    label: 'tooltip',
    client: team.client,
    members: [team.senior],
    phases: Array.from({ length: 4 }, (_, p) => ({
      name: `Faza ${p + 1}`,
      activities: Array.from({ length: 5 }, (_, a) => ({ name: `Activitate ${p + 1}.${a + 1}`, assignedTo: team.senior.id, deadline: '2030-07-07T00:00:00.000Z' })),
    })),
  })
}

/** Pagina proiectului cu ceasul oprit: timerele tooltip-ului merg doar când le mută testul. */
async function openWithClock(page: Page, projectId: string) {
  await page.clock.install()
  const table = new ProjectTablePage(page)
  await table.goto(projectId)
  await page.clock.pauseAt(Date.now() + 60_000)
  return table
}

const tip = (page: Page) => page.locator('#sg-tooltip')

async function box(locator: Locator) {
  const b = await locator.boundingBox()
  if (!b) throw new Error('elementul nu are poziție')
  return b
}

test.describe('Flux 10 — comportamentul tooltip-urilor', () => {
  test('apare după exact o secundă, fără animație, și se închide cu Escape', async ({ team, as, seeds }) => {
    const project = await seed(team)
    seeds.projects.add(project.id)
    const page = await as(team.senior)
    const table = await openWithClock(page, project.id)
    const search = page.getByRole('button', { name: 'Caută în proiect' })

    await search.hover()
    await page.clock.runFor(990)
    await expect(tip(page), 'tooltip-ul a apărut înainte de o secundă').toHaveCount(0)
    await page.clock.runFor(20)
    await expect(tip(page)).toHaveText(SEARCH_TIP)
    await expect(search).toHaveAttribute('data-tooltip-state', 'open')
    // Fără fade: opac din primul cadru, fără tranziție sau animație.
    expect(await tip(page).evaluate(el => {
      const style = getComputedStyle(el)
      return { opacity: style.opacity, animation: style.animationName, transition: style.transitionDuration }
    })).toEqual({ opacity: '1', animation: 'none', transition: '0s' })
    // Deasupra butonului, fără să-l acopere.
    const t = await box(tip(page))
    const b = await box(search)
    expect(t.y + t.height <= b.y || t.y >= b.y + b.height, 'tooltip-ul acoperă butonul').toBe(true)

    await page.keyboard.press('Escape')
    await expect(tip(page)).toHaveCount(0)
    await expect(table.page.getByRole('dialog')).toHaveCount(0)
  })

  test('la focus de la tastatură apare imediat; Escape îl închide fără să închidă altceva', async ({ team, as, seeds }) => {
    const project = await seed(team)
    seeds.projects.add(project.id)
    const page = await as(team.senior)
    await openWithClock(page, project.id)
    const search = page.getByRole('button', { name: 'Caută în proiect' })

    // De la începutul paginii, cu Tab, până la butonul de căutare.
    await page.mouse.click(2, 300)
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab')
      if (await search.evaluate(el => el === document.activeElement)) break
    }
    await expect(search).toBeFocused()
    await page.clock.runFor(1)
    await expect(tip(page)).toHaveText(SEARCH_TIP)
    await page.keyboard.press('Escape')
    await expect(tip(page)).toHaveCount(0)
    await expect(search).toBeFocused()
  })

  test('mausul poate trece pe tooltip fără să-l piardă; plecat de pe amândouă, dispare', async ({ team, as, seeds }) => {
    const project = await seed(team)
    seeds.projects.add(project.id)
    const page = await as(team.senior)
    await openWithClock(page, project.id)
    const search = page.getByRole('button', { name: 'Caută în proiect' })

    await search.hover()
    await page.clock.runFor(1001)
    await expect(tip(page)).toBeVisible()
    const t = await box(tip(page))
    await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 6 })
    await page.clock.runFor(800)
    await expect(tip(page), 'tooltip-ul a dispărut sub maus (WCAG 1.4.13)').toHaveText(SEARCH_TIP)
    await page.mouse.move(t.x + t.width / 2, t.y + t.height + 300, { steps: 6 })
    await page.clock.runFor(200)
    await expect(tip(page)).toHaveCount(0)
  })

  test('urmează elementul la derulare cât focusul e pe el', async ({ team, as, seeds }) => {
    const project = await seed(team)
    seeds.projects.add(project.id)
    const page = await as(team.senior)
    const table = await openWithClock(page, project.id)
    const deadline = table.activityLine(project.activities.get('Activitate 2.3')!).getByRole('button', { name: /^Schimbă termenul pentru / })

    await page.mouse.click(2, 300)
    await deadline.focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    await expect(deadline).toBeFocused()
    await page.clock.runFor(1)
    await expect(tip(page)).toHaveText('Schimbă termenul')
    const before = { tip: await box(tip(page)), el: await box(deadline) }
    await page.mouse.wheel(0, 150)
    await expect.poll(async () => Math.round((await box(deadline)).y), { message: 'pagina nu s-a derulat' }).toBeLessThan(Math.round(before.el.y) - 50)
    await expect.poll(async () => Math.round((await box(tip(page))).y - (await box(deadline)).y), { message: 'tooltip-ul nu urmează elementul' })
      .toBe(Math.round(before.tip.y - before.el.y))
  })

  test('în panoul fazelor tooltip-ul stă în dreapta rândului, nu peste faza vecină', async ({ team, as, seeds }) => {
    const project = await seed(team)
    seeds.projects.add(project.id)
    const page = await as(team.senior)
    const table = await openWithClock(page, project.id)
    const row = table.sidebarPhase('Faza 2')
    await row.hover()
    await page.clock.runFor(1001)
    await expect(tip(page)).toHaveText('Clic: o arată singură în tabel.')
    const t = await box(tip(page))
    const r = await box(row)
    expect(t.x, 'tooltip-ul nu stă în dreapta rândului').toBeGreaterThanOrEqual(r.x + r.width)
    expect(Math.abs((t.y + t.height / 2) - (r.y + r.height / 2)), 'tooltip-ul nu e centrat pe rând').toBeLessThan(2)
  })

  test('la atingere nu apare', async ({ team, newContext, seeds }) => {
    const project = await seed(team)
    seeds.projects.add(project.id)
    const context = await newContext({ storageState: await team.statePath(team.senior), hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    const table = await openWithClock(page, project.id)
    const status = table.activityStatus(project.activities.get('Activitate 1.1')!)
    await status.tap()
    await page.clock.runFor(3000)
    await expect(tip(page)).toHaveCount(0)
    await page.getByRole('button', { name: 'Caută în proiect' }).tap()
    await page.clock.runFor(3000)
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(tip(page)).toHaveCount(0)
  })
})
