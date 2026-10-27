import { test, expect } from './fixtures'
import { pdf, q, seedProject, seedTemplate, sql, sqlJson, tag } from './support'
import { ProjectTablePage } from '../pages/ProjectTablePage'
import { TemplatesListPage } from '../pages/TemplatesListPage'
import { TemplateEditorPage } from '../pages/TemplateEditorPage'
import { AssigneePicker } from '../pages/AssigneePicker'
import { DatePickerPanel, dayString, midNextMonth, todayIn } from '../pages/DatePicker'
import { ClientUploadDialog } from '../pages/ClientUploadDialog'
import type { Locator, Page } from '@playwright/test'
import type { Team } from './fixtures'

/**
 * Flux 12 — telefon (390×844) și tabletă (768×1024), cu atingere. Rulează doar
 * în proiectele cu atingere (vezi playwright.pr122.config.ts). Tabelul e pe fișe,
 * fără derulare laterală; țintele au cel puțin 44px (DESIGN.md: „Ținte de
 * atingere de 44px pe telefon”); în editor mânerele de tras lipsesc, iar
 * reordonarea merge din „⋯”; calendarul, alegătorul și încărcarea se folosesc
 * cu degetul; antetul paginilor nu se lipește pe telefon (D5).
 */

function seed(team: Team) {
  return seedProject({
    label: 'atingere',
    client: team.client,
    members: [team.senior, team.junior],
    phases: [{
      name: 'Pe teren',
      activities: [
        { name: 'Măsurători', assignedTo: team.senior.id, deadline: '2030-08-08T00:00:00.000Z', requests: [{ name: 'Releveu' }] },
        { name: 'Fără termen', assignedTo: team.senior.id, visibility: 'draft' },
      ],
    }],
  })
}

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 'pagina derulează lateral').toBeLessThanOrEqual(1)
}

/** Elementele apăsabile vizibile dintr-o zonă, mai mici de 44×44. */
async function smallTargets(scope: Locator) {
  return scope.evaluateAll(roots => roots.flatMap(root => [...root.querySelectorAll<HTMLElement>('button, a[href], [role="button"], input[type="checkbox"], select')]
    .filter(el => {
      const r = el.getBoundingClientRect()
      const s = getComputedStyle(el)
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.opacity !== '0'
    })
    .filter(el => { const r = el.getBoundingClientRect(); return r.width < 44 || r.height < 44 })
    .map(el => { const r = el.getBoundingClientRect(); return `${(el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 50)} ${Math.round(r.width)}×${Math.round(r.height)}` })))
}

test.describe('Flux 12 — telefon și tabletă', () => {
  test('tabelul proiectului e pe fișe, fără derulare laterală, cu ținte de cel puțin 44px', async ({ team, as, seeds }) => {
    const project = await seed(team)
    seeds.projects.add(project.id)
    const table = new ProjectTablePage(await as(team.senior))
    await table.goto(project.id)
    const id = project.activities.get('Măsurători')!

    expect((await table.tableContainer.boundingBox())!.width).toBeLessThan(800)
    await expect(table.group('Pe teren').locator('div[aria-hidden="true"]').filter({ hasText: 'Responsabil' })).toBeHidden()
    const name = (await table.activityLine(id).getByText('Măsurători', { exact: true }).boundingBox())!
    const status = (await table.activityStatus(id).boundingBox())!
    expect(status.y, 'pe fișă, starea stă sub nume').toBeGreaterThanOrEqual(name.y + name.height - 1)
    await noHorizontalScroll(table.page)
    // Pe touch, „⋯” e la vedere fără hover.
    await expect(table.actionMenu('Acțiuni pentru activitatea Măsurători')).toBeVisible()
    expect(await table.actionMenu('Acțiuni pentru activitatea Măsurători').evaluate(el => getComputedStyle(el.parentElement!.parentElement!).opacity)).toBe('1')

    await table.expandActivity(id, 'Măsurători')
    await noHorizontalScroll(table.page)
    expect(await smallTargets(table.group('Pe teren')), 'ținte sub 44px în tabel').toEqual([])
  })

  test('alegătorul și calendarul se folosesc cu degetul și încap în ecran', async ({ team, as, seeds }) => {
    const project = await seed(team)
    seeds.projects.add(project.id)
    const table = new ProjectTablePage(await as(team.senior))
    await table.goto(project.id)
    const page = table.page
    const viewport = page.viewportSize()!
    const id = project.activities.get('Fără termen')!

    const picker = AssigneePicker.inside(page, table.activityLine(id))
    await picker.trigger.tap()
    await expect(picker.listbox).toBeVisible()
    const panel = (await picker.listbox.locator('xpath=..').boundingBox())!
    expect(panel.x).toBeGreaterThanOrEqual(0)
    expect(panel.x + panel.width).toBeLessThanOrEqual(viewport.width)
    await picker.option(team.junior.fullName).tap()
    await expect(picker.listbox).toHaveCount(0)
    await picker.expectShows(team.junior.fullName)
    await expect.poll(() => sql(`select assigned_to from project_activities where id=${q(id)}`)).toBe(team.junior.id)

    const target = midNextMonth(todayIn('Europe/Bucharest'))
    await table.activityLine(id).getByRole('button', { name: 'Adaugă termen pentru Fără termen' }).tap()
    const calendar = DatePickerPanel.named(page, 'Termen limită pentru Fără termen')
    await calendar.expectOpen()
    await calendar.expectInside()
    await calendar.goToMonth(target)
    await calendar.dayButton(target).tap()
    await expect(calendar.root).toHaveCount(0)
    await expect.poll(() => sql(`select to_char(deadline_at at time zone 'Europe/Bucharest', 'YYYY-MM-DD') from project_activities where id=${q(id)}`)).toBe(dayString(target))
    await noHorizontalScroll(page)
  })

  test('clientul încarcă din dialog cu degetul; folderul e anunțat ca indisponibil', async ({ team, as, seeds }) => {
    const project = await seed(team)
    seeds.projects.add(project.id)
    const client = new ProjectTablePage(await as(team.client))
    await client.goto(project.id)
    const page = client.page
    const id = project.activities.get('Măsurători')!
    const requestId = project.requests.get('Releveu')!
    await client.activity(id).getByRole('button', { name: 'Extinde activitatea Măsurători' }).tap()
    await expect(client.request(requestId).getByText('Folder indisponibil pe mobil')).toBeVisible()
    await ClientUploadDialog.opener(page, requestId).tap()
    const dialog = new ClientUploadDialog(page, 'Releveu')
    await dialog.expectOpen()
    await expect(dialog.root.getByText('Folder indisponibil pe mobil')).toBeVisible()
    const box = (await dialog.root.boundingBox())!
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width)
    const chooser = page.waitForEvent('filechooser')
    await dialog.choose.tap()
    await (await chooser).setFiles(pdf('releveu.pdf'))
    await dialog.upload.tap()
    await expect(dialog.root).toHaveCount(0)
    expect(sqlJson(`select json_agg(original_name) from files where requirement_id=${q(requestId)}`)).toEqual(['releveu.pdf'])
    await noHorizontalScroll(page)
  })

  test('în editor nu există mânere de tras; reordonarea merge din „⋯”, cu ținte de 44px', async ({ team, as, seeds }) => {
    const template = await seedTemplate({ label: `atingere ${tag()}`, phases: [{ name: 'Prima', activities: [{ name: 'A1', requests: ['D1'] }] }, { name: 'A doua', activities: [{ name: 'A2' }] }] })
    seeds.templates.add(template.id)
    const page = await as(team.admin)
    const list = new TemplatesListPage(page)
    const editor = new TemplateEditorPage(page)
    await list.goto()
    await list.menuButton(template.name).tap()
    await page.getByRole('menuitem', { name: 'Editează', exact: true }).tap()
    await editor.expectOpen()
    await editor.expandEverything()

    await expect(editor.phasesSection.locator('span[draggable="true"]').first()).toBeAttached()
    for (const handle of await editor.phasesSection.locator('span[draggable="true"]').all()) await expect(handle).toBeHidden()
    expect(await smallTargets(editor.phasesSection), 'ținte sub 44px în editor').toEqual([])

    await editor.menuButton('faza', 'A doua').tap()
    await page.getByRole('menuitem', { name: 'Mută sus', exact: true }).tap()
    await expect(page.getByRole('heading', { level: 3 })).toHaveText(['A doua', 'Prima'])
    await editor.save.tap()
    await expect(editor.heading).toHaveCount(0)
    expect(sqlJson(`select json_agg(name order by order_index) from template_phases where template_id=${q(template.id)} and is_active`)).toEqual(['A doua', 'Prima'])
    await noHorizontalScroll(page)
  })

  test('antetul paginilor din meniu: lipit pe tabletă, nu și pe telefon', async ({ team, as }) => {
    const page = await as(team.admin)
    await page.goto('/admin/users')
    const heading = page.getByRole('heading', { level: 1, name: 'Utilizatori' })
    await expect(heading).toBeVisible()
    const header = page.locator('header').filter({ has: heading })
    const start = (await header.boundingBox())!
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(page.viewportSize()!.height + 600)
    // Fără rotiță pe WebKit mobil: pagina se derulează până la ultimul rând, ca la un swipe.
    await page.getByRole('main').getByRole('button').filter({ visible: true }).last().scrollIntoViewIfNeeded()
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(start.y + start.height)
    // Derulat dincolo de antet: lipit, stă la 64px (sub meniu); nelipit, a ieșit pe sus.
    const y = Math.round((await header.boundingBox())!.y)
    expect(y === 64 ? 'lipit' : y < 0 ? 'derulat odată cu pagina' : `y=${y}`, 'D5: lipit de la 768px (md) în sus, nu pe telefon')
      .toBe(page.viewportSize()!.width >= 768 ? 'lipit' : 'derulat odată cu pagina')
    await noHorizontalScroll(page)
  })
})
