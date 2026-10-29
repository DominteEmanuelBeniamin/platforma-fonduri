import { test, expect } from './fixtures'
import { q, seedProject, sql } from './support'
import { ProjectTablePage } from '../pages/ProjectTablePage'
import { DatePickerPanel, addDays, dayString, midNextMonth, todayIn, type Day } from '../pages/DatePicker'
import type { Team } from './fixtures'

/**
 * Flux 8 — termenul ales din calendar (`components/ui/DatePicker.tsx`) în
 * tabel, în panoul fazelor, în fișa cererii și în formularul de cerere nouă:
 * ziua aleasă se salvează pe loc, e aceeași în bază (și seara târziu, în fusul
 * București), calendarul încape în ecran și în dialog, merge de la tastatură,
 * iar termenul se poate șterge unde e voie.
 */

const ZONE = 'Europe/Bucharest'
const PUBLISHED_DEADLINE = '2030-05-05T00:00:00.000Z'

/** Ziua termenului, citită din bază în fusul utilizatorului. */
const savedDay = (table: string, id: string) =>
  sql(`select coalesce(to_char(deadline_at at time zone '${ZONE}', 'YYYY-MM-DD'), '') from ${table} where id=${q(id)}`)

/** Ce scrie celula de termen pentru o zi din anul curent: „15 nov.”. */
const shortLabel = (day: Day) => new Date(Date.UTC(day.y, day.m - 1, day.d, 12)).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', timeZone: ZONE })

function seed(team: Team) {
  return seedProject({
    label: 'termene',
    client: team.client,
    members: [team.senior],
    phases: [{
      name: 'Termene',
      activities: [
        { name: 'Fără termen încă', visibility: 'draft' },
        { name: 'Ciornă cu termen', visibility: 'draft', deadline: '2030-04-04T00:00:00.000Z' },
        { name: 'Publicată cu termen', assignedTo: team.senior.id, deadline: PUBLISHED_DEADLINE, requests: [{ name: 'Cerere cu termen', deadline: PUBLISHED_DEADLINE }] },
      ],
    }],
  })
}

test.describe('Flux 8 — termenul ales din calendar', () => {
  test('în tabel: ziua aleasă se salvează pe loc, fără alt buton; merge și de la tastatură', async ({ team, as, seeds }) => {
    const project = await seed(team)
    seeds.projects.add(project.id)
    const table = new ProjectTablePage(await as(team.senior))
    await table.goto(project.id)
    const empty = project.activities.get('Fără termen încă')!
    const target = midNextMonth(todayIn(ZONE))

    await table.activityLine(empty).getByRole('button', { name: 'Adaugă termen pentru Fără termen încă' }).click()
    const panel = DatePickerPanel.named(table.page, 'Termen limită pentru Fără termen încă')
    await panel.expectOpen()
    await panel.expectInside()
    await panel.pick(target)
    await expect(panel.root).toHaveCount(0)
    await expect(table.activityLine(empty).getByRole('button', { name: `Schimbă termenul pentru Fără termen încă: ${shortLabel(target)}` })).toBeVisible()
    await expect.poll(() => savedDay('project_activities', empty)).toBe(dayString(target))

    // Tastatura: Enter deschide cu focusul pe ziua aleasă, → mută o zi, Enter salvează, Escape renunță.
    const published = project.activities.get('Publicată cu termen')!
    const button = table.activityLine(published).getByRole('button', { name: /^Schimbă termenul pentru Publicată cu termen/ })
    await button.focus()
    await table.page.keyboard.press('Enter')
    const keyboardPanel = DatePickerPanel.named(table.page, 'Termen limită pentru Publicată cu termen')
    await expect(keyboardPanel.dayButton({ y: 2030, m: 5, d: 5 })).toBeFocused()
    await table.page.keyboard.press('Escape')
    await expect(keyboardPanel.root).toHaveCount(0)
    await expect(button).toBeFocused()
    expect(savedDay('project_activities', published)).toBe('2030-05-05')
    await table.page.keyboard.press('Enter')
    await expect(keyboardPanel.dayButton({ y: 2030, m: 5, d: 5 })).toBeFocused()
    await table.page.keyboard.press('ArrowRight')
    await table.page.keyboard.press('Enter')
    await expect(keyboardPanel.root).toHaveCount(0)
    await expect.poll(() => savedDay('project_activities', published)).toBe('2030-05-06')
    // Pe o activitate publică tabelul nu oferă ștergerea termenului.
    await button.click()
    await keyboardPanel.expectOpen()
    await expect(keyboardPanel.clear).toHaveCount(0)
  })

  test('în panoul fazelor: se alege și, pe o activitate în pregătire, se șterge; pe una publică, nu', async ({ team, as, seeds }) => {
    const project = await seed(team)
    seeds.projects.add(project.id)
    const table = new ProjectTablePage(await as(team.senior))
    await table.goto(project.id)
    const draft = project.activities.get('Ciornă cu termen')!
    const target = midNextMonth(todayIn(ZONE))
    const panel = DatePickerPanel.named(table.page, 'Termen limită')
    const row = table.sidebar.locator('[data-tooltip-side="right"]').filter({ hasText: 'Ciornă cu termen' })

    await table.sidebarPhase('Termene').getByRole('button', { name: 'Extinde faza' }).click()
    await row.getByRole('button', { name: /termen .* — modifică$/ }).click()
    await panel.expectOpen()
    await panel.expectInside()
    await panel.pick(target)
    await expect(panel.root).toHaveCount(0)
    await expect.poll(() => savedDay('project_activities', draft)).toBe(dayString(target))

    await row.getByRole('button', { name: /termen .* — modifică$/ }).click()
    await panel.clear.click()
    await expect(panel.root).toHaveCount(0)
    await expect.poll(() => savedDay('project_activities', draft)).toBe('')
    await expect(row.getByRole('button', { name: 'Setează termen' })).toBeAttached()

    const published = table.sidebar.locator('[data-tooltip-side="right"]').filter({ hasText: 'Publicată cu termen' })
    await published.getByRole('button', { name: /termen .* — modifică$/ }).click()
    await panel.expectOpen()
    await expect(panel.clear).toHaveCount(0)
  })

  test('în fișa cererii și în formularul de cerere nouă: calendarul nu e tăiat, ziua ajunge în bază', async ({ team, as, seeds }) => {
    const project = await seed(team)
    seeds.projects.add(project.id)
    const table = new ProjectTablePage(await as(team.senior))
    await table.goto(project.id)
    const page = table.page
    const published = project.activities.get('Publicată cu termen')!
    const requestId = project.requests.get('Cerere cu termen')!
    const target = midNextMonth(todayIn(ZONE))

    // Fișa cererii: calendarul plutește în dialog, întreg în ecran.
    await table.expandActivity(published, 'Publicată cu termen')
    await table.request(requestId).getByRole('heading', { name: 'Cerere cu termen' }).click()
    const sheet = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Cerere cu termen' }) })
    await expect(sheet).toBeVisible()
    await sheet.getByRole('button', { name: 'Modifică', exact: true }).first().click()
    const sheetPanel = DatePickerPanel.named(page, 'Termen limită')
    await sheetPanel.expectOpen()
    await sheetPanel.expectInside()
    await sheetPanel.pick(target)
    await expect(sheetPanel.root).toHaveCount(0)
    await expect.poll(() => savedDay('document_requirements', requestId)).toBe(dayString(target))
    await expect(sheet).toContainText(`Termen limită: ${target.d} ${new Date(Date.UTC(target.y, target.m - 1, target.d, 12)).toLocaleDateString('ro-RO', { month: 'long', timeZone: ZONE })} ${target.y}`)
    await page.keyboard.press('Escape')

    // Formularul de cerere nouă: calendarul se deschide sub câmp, în formular.
    const draft = project.activities.get('Fără termen încă')!
    await table.expandActivity(draft, 'Fără termen încă')
    await table.activity(draft).getByRole('button', { name: 'Adaugă cerere de document nouă' }).click()
    const form = page.getByRole('dialog', { name: 'Cerere de document nouă' })
    await expect(form).toBeVisible()
    await form.locator('input[type="text"]').first().fill('Certificat de urbanism')
    const field = form.locator('#request-deadline')
    await field.click()
    const formPanel = new DatePickerPanel(page, form.getByRole('dialog', { name: 'Termen limită' }))
    await formPanel.expectOpen()
    const fieldBox = (await field.boundingBox())!
    expect((await formPanel.root.boundingBox())!.y, 'calendarul nu se deschide sub câmp').toBeGreaterThanOrEqual(fieldBox.y + fieldBox.height - 1)
    await formPanel.root.scrollIntoViewIfNeeded()
    await formPanel.expectInside(form)
    const second = addDays(target, 3)
    await formPanel.pick(second)
    await expect(formPanel.root).toHaveCount(0)
    await expect(field).toBeFocused()
    // Se poate și șterge, apoi alege din nou.
    await field.click()
    await formPanel.clear.click()
    await expect(field).toHaveText('Fără termen')
    await field.click()
    await formPanel.pick(second)
    await form.getByRole('button', { name: 'Trimite cerere' }).click()
    await expect(form).toHaveCount(0)
    const created = sql(`select id from document_requirements where activity_id=${q(draft)} and name='Certificat de urbanism'`)
    expect(created).toMatch(/^[0-9a-f-]{36}$/)
    expect(savedDay('document_requirements', created)).toBe(dayString(second))
  })

  test('seara târziu și după miezul nopții, „Azi” e ziua din București, nu cea din UTC', async ({ team, loginFresh, seeds }) => {
    const project = await seed(team)
    seeds.projects.add(project.id)
    const empty = project.activities.get('Fără termen încă')!
    for (const [moment, expected] of [['2026-10-26T23:30:00+02:00', '2026-10-26'], ['2026-10-27T00:30:00+02:00', '2026-10-27']] as const) {
      sql(`update project_activities set deadline_at=null where id=${q(empty)}`)
      const page = await loginFresh(team.senior)
      await page.clock.setFixedTime(new Date(moment))
      const table = new ProjectTablePage(page)
      await table.goto(project.id)
      await table.activityLine(empty).getByRole('button', { name: 'Adaugă termen pentru Fără termen încă' }).click()
      const panel = DatePickerPanel.named(page, 'Termen limită pentru Fără termen încă')
      const [y, m, d] = expected.split('-').map(Number)
      await expect(panel.dayButton({ y, m, d }), `la ${moment} calendarul trebuie să arate azi ${expected}`).toHaveAccessibleName(/^Astăzi, /)
      await panel.today.click()
      await expect.poll(() => savedDay('project_activities', empty), { message: `„Azi” ales la ${moment}` }).toBe(expected)
      await page.context().close()
    }
  })
})
