import { test, expect } from './fixtures'
import { PREFIX, q, seedTemplate, sql, sqlJson, tag } from './support'
import { TemplatesListPage } from '../pages/TemplatesListPage'
import { TemplateEditorPage } from '../pages/TemplateEditorPage'

/**
 * Flux 1 — lista de șabloane (S-22, S-23, S-30, S-31, Z-01; „Proiect nou” mutat
 * pe prima pagină). Fiecare acțiune pornește dintr-un clic în listă și se
 * verifică în bază.
 */

const NINE = Array.from({ length: 9 }, (_, i) => ({ name: `Faza ${i + 1}`, activities: [{ name: `Activitate ${i + 1}` }] }))

/** Arborele activ al unui șablon, din bază: faze → activități → cereri, în ordine. */
function templateTree(templateId: string) {
  return sqlJson<{ name: string; activities: { name: string; docs: string[] }[] }[]>(`
    select coalesce(json_agg(json_build_object('name', p.name, 'activities', (
      select coalesce(json_agg(json_build_object('name', a.name, 'docs', (
        select coalesce(json_agg(d.name order by d.order_index), '[]') from template_document_requirements d where d.template_activity_id=a.id and d.is_active
      )) order by a.order_index), '[]') from template_activities a where a.template_phase_id=p.id and a.is_active
    )) order by p.order_index), '[]') from template_phases p where p.template_id=${q(templateId)} and p.is_active`)
}

test.describe('Flux 1 — lista de șabloane', () => {
  test('un singur „⋯” pe rând, cu acțiunile rolului; Ciornă și Publicat spun dacă se pot folosi', async ({ team, as, seeds }) => {
    const draft = await seedTemplate({ label: `ciorna ${tag()}`, phases: [{ name: 'Faza A' }] })
    const published = await seedTemplate({ label: `publicat ${tag()}`, status: 'published', phases: [{ name: 'Faza B' }] })
    seeds.templates.add(draft.id).add(published.id)

    const admin = new TemplatesListPage(await as(team.admin))
    await admin.goto()
    // Pe rând stau doar săgeata de desfacere și „⋯” (S-30): nicio iconiță de apăsat din greșeală.
    expect(await admin.rowButtons(draft.name)).toEqual([`Arată fazele — ${draft.name}`, `Acțiuni pentru șablonul ${draft.name}`])
    expect(await admin.rowButtons(published.name)).toEqual([`Arată fazele — ${published.name}`, `Acțiuni pentru șablonul ${published.name}`])
    await expect(admin.menuButton(draft.name)).toHaveAttribute('data-tooltip', 'Acțiuni șablon')
    expect(await admin.menuItems(draft.name)).toEqual(['Editează', 'Publică', 'Duplică', 'Șterge'])
    expect(await admin.menuItems(published.name)).toEqual(['Editează', 'Duplică', 'Șterge'])

    // Tooltip-ul etichetei, cu mausul (S-22): ce înseamnă la crearea unui proiect.
    const tooltip = admin.page.locator('#sg-tooltip')
    await expect(admin.statusBadge(draft.name)).toHaveText('Ciornă')
    await admin.statusBadge(draft.name).hover()
    await expect(tooltip).toHaveText('Ciornă: nu apare la crearea unui proiect până nu o publică un administrator.')
    await admin.page.mouse.move(1, 1)
    await expect(tooltip).toHaveCount(0)
    await expect(admin.statusBadge(published.name)).toHaveText('Publicat')
    await admin.statusBadge(published.name).hover()
    await expect(tooltip).toHaveText('Publicat: se poate alege la crearea unui proiect nou.')

    // Seniorul gestionează, dar nu publică; juniorul editează doar ciorne.
    const senior = new TemplatesListPage(await as(team.senior))
    await senior.goto()
    expect(await senior.menuItems(draft.name)).toEqual(['Editează', 'Duplică', 'Șterge'])
    expect(await senior.menuItems(published.name)).toEqual(['Editează', 'Duplică', 'Șterge'])
    const junior = new TemplatesListPage(await as(team.junior))
    await junior.goto()
    expect(await junior.menuItems(draft.name)).toEqual(['Editează'])
    await expect(junior.row(draft.name)).toHaveCount(1)
    await expect(junior.menuButton(published.name)).toHaveCount(0)
  })

  test('fazele unui șablon desfăcut curg pe coloane, de sus în jos', async ({ team, as, seeds }) => {
    const template = await seedTemplate({ label: `coloane ${tag()}`, phases: NINE })
    seeds.templates.add(template.id)
    const list = new TemplatesListPage(await as(team.admin))
    await list.goto()
    await list.expandButton(template.name).click()
    const items = list.phaseItems(template.id)
    await expect(items).toHaveCount(9)
    const boxes = await Promise.all((await items.all()).map(async item => ({ text: (await item.innerText()).replace(/\s+/g, ' '), box: (await item.boundingBox())! })))
    const columns = [...new Set(boxes.map(b => Math.round(b.box.x)))].sort((a, b) => a - b)
    // 1280px: trei coloane, câte trei faze, în ordinea șablonului de sus în jos.
    expect(columns, 'numărul de coloane la 1280px').toHaveLength(3)
    const byColumn = columns.map(x => boxes.filter(b => Math.round(b.box.x) === x).sort((a, b) => a.box.y - b.box.y).map(b => b.text.split(' ').slice(0, 3).join(' ')))
    expect(byColumn).toEqual([
      ['1. Faza 1', '2. Faza 2', '3. Faza 3'],
      ['4. Faza 4', '5. Faza 5', '6. Faza 6'],
      ['7. Faza 7', '8. Faza 8', '9. Faza 9'],
    ])
    await list.expandButton(template.name).click()
    await expect(items).toHaveCount(0)
  })

  test('duplicarea cere confirmare; refuzul nu copiază nimic; copiile se numesc „(copie)”, apoi „(copie 2)”', async ({ team, as, seeds }) => {
    const template = await seedTemplate({
      label: `dup ${tag()}`,
      phases: [
        { name: 'Pregătire', activities: [{ name: 'Acte', requests: ['CI', 'Certificat'] }] },
        { name: 'Depunere', activities: [{ name: 'Cerere', requests: ['Formular'] }] },
      ],
    })
    seeds.templates.add(template.id)
    const copies = () => sqlJson<{ id: string; name: string }[]>(`select coalesce(json_agg(json_build_object('id', id, 'name', name) order by name), '[]') from project_templates where name like ${q(template.name + ' (%')}`)
    const list = new TemplatesListPage(await as(team.admin))
    await list.goto()

    // Refuz: nimic nou nici pe ecran, nici în bază.
    await list.action(template.name, 'Duplică')
    const dialog = list.duplicateDialog(template.name)
    await dialog.expectOpen('Se copiază 2 faze, 2 activități, 3 cereri și fișierele-model. Durează câteva secunde.')
    await dialog.cancel()
    await expect(list.menuButton(`${template.name} (copie)`)).toHaveCount(0)
    expect(copies()).toEqual([])

    // Confirmare: copia apare în listă și în bază, cu tot arborele.
    const done = list.page.waitForResponse(r => r.url().endsWith(`/api/admin/templates/${template.id}/duplicate`))
    await list.action(template.name, 'Duplică')
    await dialog.confirm('Duplică')
    expect((await done).status()).toBe(201)
    await expect(list.menuButton(`${template.name} (copie)`)).toBeVisible()
    let rows = copies()
    for (const row of rows) seeds.templates.add(row.id)
    expect(rows.map(r => r.name)).toEqual([`${template.name} (copie)`])
    expect(templateTree(rows[0].id)).toEqual(templateTree(template.id))

    // A doua duplicare a originalului nu repetă „(copie)”.
    await list.action(template.name, 'Duplică')
    await dialog.confirm('Duplică')
    await expect(list.menuButton(`${template.name} (copie 2)`)).toBeVisible()
    rows = copies()
    for (const row of rows) seeds.templates.add(row.id)
    expect(rows.map(r => r.name)).toEqual([`${template.name} (copie 2)`, `${template.name} (copie)`])
  })

  test('redenumirea la numele altui șablon e refuzată (409), cu motivul sub nume; numele vechi rămâne', async ({ team, as, seeds }) => {
    const first = await seedTemplate({ label: `unu ${tag()}`, phases: [{ name: 'Faza 1' }] })
    const second = await seedTemplate({ label: `doi ${tag()}`, phases: [{ name: 'Faza 1' }] })
    seeds.templates.add(first.id).add(second.id)
    const page = await as(team.admin)
    const list = new TemplatesListPage(page)
    const editor = new TemplateEditorPage(page)
    await list.goto()
    await list.action(second.name, 'Editează')
    await editor.expectOpen()

    // Același nume cu alte majuscule și spații: tot al primului șablon (D10).
    const clash = `  ${first.name.toUpperCase()} `
    await editor.name.fill(clash)
    const refused = page.waitForResponse(r => r.url().endsWith(`/api/admin/templates/${second.id}/tree`) && r.request().method() === 'PUT')
    await editor.save.click()
    expect((await refused).status()).toBe(409)
    await expect(editor.nameField).toContainText(`Există deja un șablon numit «${first.name.toUpperCase()}». Alege alt nume.`)
    await expect(editor.heading).toHaveText('Editează șablonul')
    expect(sql(`select name from project_templates where id=${q(second.id)}`)).toBe(second.name)

    // Un nume liber trece: editorul se închide, lista și baza îl au.
    const renamed = `${PREFIX} redenumit ${tag()}`
    await editor.name.fill(renamed)
    await expect(editor.nameField).not.toContainText('Există deja')
    await editor.save.click()
    await expect(editor.heading).toHaveCount(0)
    await expect(list.menuButton(renamed)).toBeVisible()
    expect(sql(`select name from project_templates where id=${q(second.id)}`)).toBe(renamed)
  })

  test('„Proiect nou” nu mai e pe pagina de șabloane; de pe prima pagină creează un proiect', async ({ team, as, seeds }) => {
    const page = await as(team.admin)
    const list = new TemplatesListPage(page)
    await list.goto()
    await expect(page.getByRole('main').getByRole('link', { name: 'Proiect nou' })).toHaveCount(0)
    await expect(page.getByRole('main').getByRole('button', { name: 'Proiect nou' })).toHaveCount(0)

    await page.getByRole('navigation', { name: 'Navigare principală' }).getByRole('link', { name: 'Proiecte' }).first().click()
    await expect(page).toHaveURL(url => url.pathname === '/')
    await page.getByRole('link', { name: 'Proiect nou' }).first().click()
    await expect(page).toHaveURL(url => url.pathname === '/projects/new')

    const title = `${PREFIX} proiect nou ${tag()}`
    await page.getByLabel('Numele proiectului').fill(title)
    const beneficiary = page.getByLabel('Beneficiar')
    const option = beneficiary.locator('option').filter({ hasText: team.client.fullName })
    await beneficiary.selectOption({ value: (await option.getAttribute('value'))! })
    await page.getByRole('checkbox', { name: new RegExp(team.senior.fullName) }).check()
    await page.getByRole('radio', { name: /Dosar gol/ }).check()
    await page.getByRole('button', { name: 'Deschide dosarul', exact: true }).click()

    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/)
    const projectId = new URL(page.url()).pathname.split('/').pop()!
    seeds.projects.add(projectId)
    await expect(page.getByRole('navigation', { name: 'Locație' })).toContainText(title)
    expect(sqlJson(`select json_build_object('title', title, 'client', client_id, 'members', (select json_agg(consultant_id) from project_members where project_id=p.id)) from projects p where id=${q(projectId)}`))
      .toEqual({ title, client: team.client.id, members: [team.senior.id] })
  })
})
