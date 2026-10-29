import AxeBuilder from '@axe-core/playwright'
import { test, expect } from './fixtures'
import { seedProject, seedTemplate } from './support'
import { ProjectTablePage } from '../pages/ProjectTablePage'
import { TemplatesListPage } from '../pages/TemplatesListPage'
import { TemplateEditorPage } from '../pages/TemplateEditorPage'

test('contrastul rămâne suficient în progres și fazele desfăcute', async ({ team, as, seeds }) => {
  const project = await seedProject({
    label: 'contrast', client: team.client, members: [team.senior],
    phases: [{ name: 'Faza proiectului', activities: [
      { name: 'Acte', assignedTo: team.senior.id, requests: [{ name: 'Document' }, { name: 'Document aprobat', status: 'approved' }] },
    ] }],
  })
  seeds.projects.add(project.id)
  const page = await as(team.senior)
  const table = new ProjectTablePage(page)
  await table.goto(project.id)
  await table.expandActivity(project.activities.get('Acte')!, 'Acte')
  expect((await new AxeBuilder({ page }).withRules(['color-contrast']).analyze()).violations).toEqual([])

  const template = await seedTemplate({ label: 'contrast', phases: [
    { name: 'Faza șablonului', activities: [{ name: 'Activitate', requests: ['Document'] }] },
  ] })
  seeds.templates.add(template.id)
  const admin = await as(team.admin)
  const list = new TemplatesListPage(admin)
  await list.goto()
  await list.search.fill(template.name)
  await list.expandButton(template.name).click()
  await expect(list.phaseItems(template.id)).toHaveCount(1)
  expect((await new AxeBuilder({ page: admin }).withRules(['color-contrast']).analyze()).violations).toEqual([])
  await list.action(template.name, 'Editează')
  const editor = new TemplateEditorPage(admin)
  await editor.expectOpen()
  await editor.expandEverything()
  expect((await new AxeBuilder({ page: admin }).withRules(['color-contrast']).analyze()).violations).toEqual([])
})
