import { test, expect } from './fixtures'
import { PREFIX, projectStatuses, q, seedTemplate, sqlJson, tag } from './support'
import { TemplatesListPage } from '../pages/TemplatesListPage'
import { TemplateEditorPage } from '../pages/TemplateEditorPage'
import { ProjectTablePage } from '../pages/ProjectTablePage'

/**
 * Flux 4 — statusul fazelor: editorul nu-l mai arată; o fază veche fără status
 * se salvează (`lib/template-save-plan.ts` o acceptă); o fază nouă primește
 * primul status; importul în proiect păstrează statusurile.
 */

function phaseStatuses(templateId: string) {
  return sqlJson<{ name: string; status: string | null }[]>(`select coalesce(json_agg(json_build_object('name', name, 'status', project_status_id) order by order_index), '[]')
    from template_phases where template_id=${q(templateId)} and is_active`)
}

test.describe('Flux 4 — statusul fazelor', () => {
  test('editorul nu arată statusul; faza veche fără status se salvează; faza nouă primește primul status', async ({ team, as, seeds }) => {
    const statuses = projectStatuses()
    const third = statuses[2]
    const template = await seedTemplate({
      label: `status ${tag()}`,
      phases: [
        { name: 'Faza veche', projectStatusId: null, activities: [{ name: 'Activitate veche' }] },
        { name: 'Faza cu status', projectStatusId: third.id, activities: [{ name: 'Activitate cu status' }] },
      ],
    })
    seeds.templates.add(template.id)
    const page = await as(team.admin)
    const list = new TemplatesListPage(page)
    const editor = new TemplateEditorPage(page)
    await list.goto()
    await list.action(template.name, 'Editează')
    await editor.expectOpen()
    await editor.expandEverything()

    // Niciun câmp și niciun nume de status în editor: singurele liste sunt consultanții impliciți.
    const comboboxes = await editor.phasesSection.getByRole('combobox').evaluateAll(els => els.map(el => el.getAttribute('aria-label')))
    expect(comboboxes).toEqual(['Consultant implicit pentru activitatea Activitate veche', 'Consultant implicit pentru activitatea Activitate cu status'])
    for (const status of statuses) {
      await expect(page.getByRole('main').getByText(status.name, { exact: true })).toHaveCount(0)
    }

    await editor.rename('faza', 'Faza veche', 'Faza veche redenumită')
    await editor.addPhaseNamed('Faza nouă')
    const saved = page.waitForResponse(r => r.url().endsWith(`/api/admin/templates/${template.id}/tree`) && r.request().method() === 'PUT')
    await editor.save.click()
    expect((await saved).status()).toBe(200)
    await expect(editor.heading).toHaveCount(0)
    expect(phaseStatuses(template.id)).toEqual([
      { name: 'Faza veche redenumită', status: null },
      { name: 'Faza cu status', status: third.id },
      { name: 'Faza nouă', status: statuses[0].id },
    ])
  })

  test('un proiect nou creat din șablon păstrează statusurile fazelor (baza și ce primește pagina)', async ({ team, as, seeds }) => {
    const statuses = projectStatuses()
    const template = await seedTemplate({
      label: `import ${tag()}`,
      status: 'published',
      phases: [
        { name: 'Etapa întâi', projectStatusId: statuses[1].id, activities: [{ name: 'Lucrul 1' }] },
        { name: 'Etapa fără status', projectStatusId: null, activities: [{ name: 'Lucrul 2' }] },
        { name: 'Etapa a treia', projectStatusId: statuses[3].id, activities: [{ name: 'Lucrul 3' }] },
      ],
    })
    seeds.templates.add(template.id)
    const page = await as(team.admin)
    await page.goto('/projects/new')
    const title = `${PREFIX} din șablon ${tag()}`
    await page.getByLabel('Numele proiectului').fill(title)
    const beneficiary = page.getByLabel('Beneficiar')
    await beneficiary.selectOption({ value: (await beneficiary.locator('option').filter({ hasText: team.client.fullName }).getAttribute('value'))! })
    await page.getByRole('checkbox', { name: new RegExp(team.senior.fullName) }).check()
    await page.getByRole('radio', { name: /Din șablon/ }).check()
    await page.getByRole('radio', { name: new RegExp(template.name) }).check()

    const phasesLoaded = page.waitForResponse(r => /\/api\/projects\/[0-9a-f-]{36}\/phases$/.test(new URL(r.url()).pathname) && r.request().method() === 'GET')
    await page.getByRole('button', { name: 'Deschide dosarul', exact: true }).click()
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/)
    const projectId = new URL(page.url()).pathname.split('/').pop()!
    seeds.projects.add(projectId)

    const table = new ProjectTablePage(page)
    await expect(table.viewSwitch).toBeVisible()
    expect(await table.groupTitles()).toEqual(['Etapa întâi', 'Etapa fără status', 'Etapa a treia', 'Documente trimise clientului', 'Cereri generale'])
    const body = await (await phasesLoaded).json() as { phases: { name: string; project_status: { name: string } | null }[] }
    expect(body.phases.map(p => [p.name, p.project_status?.name ?? null])).toEqual([
      ['Etapa întâi', statuses[1].name], ['Etapa fără status', null], ['Etapa a treia', statuses[3].name],
    ])
    expect(sqlJson(`select json_build_object('template', template_id, 'current', current_status_id, 'phases', (
        select json_agg(json_build_object('name', name, 'status', project_status_id) order by order_index) from project_phases where project_id=p.id))
      from projects p where id=${q(projectId)}`)).toEqual({
      template: template.id,
      current: statuses[1].id,
      phases: [
        { name: 'Etapa întâi', status: statuses[1].id },
        { name: 'Etapa fără status', status: null },
        { name: 'Etapa a treia', status: statuses[3].id },
      ],
    })
  })
})
