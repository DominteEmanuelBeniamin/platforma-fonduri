import { test, expect } from './fixtures'
import { BUCKET, pdf, q, seedTemplate, service, sqlJson, tag } from './support'
import { TemplatesListPage } from '../pages/TemplatesListPage'
import { TemplateEditorPage } from '../pages/TemplateEditorPage'
import type { Locator, Page } from '@playwright/test'

/**
 * Flux 2 — editorul de șablon, cap-coadă: faze strânse la deschidere,
 * „Extinde/Restrânge toate fazele”, redenumire din dialog (D9), descrierea care
 * crește, reordonare din „⋯” și cu mausul, cerere nouă, fișier-model încărcat
 * din „⋯”, bara de salvare lipită. După „Salvează”, arborele din bază și
 * fișierul din Storage sunt exact cele de pe ecran.
 */

function dbTree(templateId: string) {
  return sqlJson<{ name: string; activities: { name: string; docs: string[] }[] }[]>(`
    select coalesce(json_agg(json_build_object('name', p.name, 'activities', (
      select coalesce(json_agg(json_build_object('name', a.name, 'docs', (
        select coalesce(json_agg(d.name order by d.order_index), '[]') from template_document_requirements d where d.template_activity_id=a.id and d.is_active
      )) order by a.order_index), '[]') from template_activities a where a.template_phase_id=p.id and a.is_active
    )) order by p.order_index), '[]') from template_phases p where p.template_id=${q(templateId)} and p.is_active`)
}

/** Tragere cu mausul real: apăsat pe mâner, mutat în pași peste țintă, eliberat. */
async function drag(page: Page, handle: Locator, target: Locator) {
  await handle.hover()
  const from = (await handle.boundingBox())!
  const to = (await target.boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 15 })
  // Încă o mișcare mică peste țintă, ca mâna: WebKit-ul din Playwright livrează
  // altfel `dragover`-ul ultimei poziții abia după ce mausul e eliberat.
  await page.mouse.move(to.x + to.width / 2 + 1, to.y + to.height / 2, { steps: 2 })
  await page.mouse.up()
}

test('editorul: de la deschidere la salvare, baza și Storage sunt exact ce e pe ecran', async ({ team, as, seeds }) => {
  const template = await seedTemplate({
    label: `editor ${tag()}`,
    phases: [
      { name: 'Faza Alfa', activities: [{ name: 'Alfa 1', requests: ['Doc A1a', 'Doc A1b'] }, { name: 'Alfa 2', requests: ['Doc A2a', 'Doc A2b'] }] },
      { name: 'Faza Beta', activities: [{ name: 'Beta 1', requests: ['Doc B1a', 'Doc B1b'] }, { name: 'Beta 2', requests: ['Doc B2a', 'Doc B2b'] }] },
      { name: 'Faza Gama', activities: [{ name: 'Gama 1', requests: ['Doc G1a', 'Doc G1b'] }, { name: 'Gama 2', requests: ['Doc G2a', 'Doc G2b'] }] },
    ],
  })
  seeds.templates.add(template.id)
  const page = await as(team.admin)
  const list = new TemplatesListPage(page)
  const editor = new TemplateEditorPage(page)
  await list.goto()
  await list.action(template.name, 'Editează')
  await editor.expectOpen()

  // Fazele sunt strânse la deschidere (S-24): niciun rând de activitate.
  await expect(editor.phaseToggles()).toHaveCount(3)
  expect(await editor.phaseToggles().evaluateAll(b => b.map(x => x.getAttribute('aria-label')))).toEqual(['Extinde faza Faza Alfa', 'Extinde faza Faza Beta', 'Extinde faza Faza Gama'])
  await expect(editor.menuButton('activitatea', 'Alfa 1')).toHaveCount(0)

  // „Extinde toate fazele” și înapoi.
  await editor.expandAll.click()
  await expect(editor.page.getByRole('button', { name: /^Restrânge faza / })).toHaveCount(3)
  await expect(editor.page.getByRole('button', { name: /^Acțiuni pentru activitatea / })).toHaveCount(6)
  await editor.collapseAll.click()
  await expect(editor.page.getByRole('button', { name: /^Extinde faza / })).toHaveCount(3)
  await expect(editor.expandAll).toBeVisible()

  // Redenumirea din dialog (D9), pentru fază și activitate.
  await editor.rename('faza', 'Faza Beta', 'Faza Beta nouă')
  await expect(editor.page.getByRole('heading', { level: 3, name: 'Faza Beta nouă', exact: true })).toBeVisible()
  await editor.expandEverything()
  await editor.rename('activitatea', 'Gama 1', 'Gama unu')
  await expect(editor.menuButton('activitatea', 'Gama unu')).toBeVisible()

  // Descrierea crește cu textul până la 8 rânduri, apoi derulează (S-25).
  const start = (await editor.description.boundingBox())!.height
  await editor.description.fill(['Rândul 1', 'Rândul 2', 'Rândul 3', 'Rândul 4', 'Rândul 5'].join('\n'))
  await expect.poll(async () => (await editor.description.boundingBox())!.height, { message: 'descrierea nu crește cu textul' }).toBeGreaterThan(start + 30)
  const five = (await editor.description.boundingBox())!.height
  const twelve = Array.from({ length: 12 }, (_, i) => `Rândul ${i + 1}`).join('\n')
  await editor.description.fill(twelve)
  await expect.poll(async () => (await editor.description.boundingBox())!.height).toBeGreaterThan(five)
  const scroll = await editor.description.evaluate(el => ({ scroll: el.scrollHeight, client: el.clientHeight }))
  expect(scroll.scroll, 'peste 8 rânduri câmpul derulează în loc să crească').toBeGreaterThan(scroll.client)

  // Reordonare din „⋯”: fază, activitate, cerere.
  await editor.action('faza', 'Faza Gama', 'Mută sus')
  await editor.action('activitatea', 'Alfa 2', 'Mută sus')
  await editor.action('cererea', 'Doc A1b', 'Mută sus')
  expect((await editor.screenTree()).map(p => p.name)).toEqual(['Faza Alfa', 'Faza Gama', 'Faza Beta nouă'])

  // Reordonare cu mausul, de pe mâner: activitatea, apoi faza (cu fazele strânse).
  await drag(page, editor.dragHandle(editor.activityHeader('Gama 2')), editor.activityHeader('Gama unu'))
  expect((await editor.screenTree())[1].activities.map(a => a.name)).toEqual(['Gama 2', 'Gama unu'])
  await editor.collapseAll.click()
  await drag(page, editor.dragHandle(editor.phaseHeader('Faza Alfa')), editor.phaseHeader('Faza Beta nouă'))
  await expect(editor.page.getByRole('heading', { level: 3 })).toHaveText(['Faza Gama', 'Faza Beta nouă', 'Faza Alfa'])
  await editor.expandEverything()

  // Cerere nouă, cu un fișier-model ales din „⋯”.
  await editor.addDoc('Beta 2', 'Doc nou')
  const model = pdf('model-sablon.pdf')
  const chooser = page.waitForEvent('filechooser')
  await editor.action('cererea', 'Doc nou', 'Încarcă model')
  await (await chooser).setFiles(model)
  await expect(editor.page.locator('li').filter({ has: editor.menuButton('cererea', 'Doc nou') })).toContainText('model-sablon.pdf')

  // Bara de salvare: lipită jos, cu numele și numerele de acum.
  await expect(editor.saveBar).toContainText(`„${template.name}”`)
  await expect(editor.saveBar).toContainText('3 faze · 6 activități · 13 cereri de documente')
  await page.mouse.wheel(0, -5000)
  const viewport = page.viewportSize()!
  await expect.poll(async () => Math.round((await editor.saveBar.boundingBox())!.y + (await editor.saveBar.boundingBox())!.height), { message: 'bara de salvare nu e lipită jos' }).toBe(viewport.height)

  const screen = await editor.screenTree()
  expect(screen).toEqual([
    { name: 'Faza Gama', activities: [{ name: 'Gama 2', docs: ['Doc G2a', 'Doc G2b'] }, { name: 'Gama unu', docs: ['Doc G1a', 'Doc G1b'] }] },
    { name: 'Faza Beta nouă', activities: [{ name: 'Beta 1', docs: ['Doc B1a', 'Doc B1b'] }, { name: 'Beta 2', docs: ['Doc B2a', 'Doc B2b', 'Doc nou'] }] },
    { name: 'Faza Alfa', activities: [{ name: 'Alfa 2', docs: ['Doc A2a', 'Doc A2b'] }, { name: 'Alfa 1', docs: ['Doc A1b', 'Doc A1a'] }] },
  ])

  const saved = page.waitForResponse(r => r.url().endsWith(`/api/admin/templates/${template.id}/tree`) && r.request().method() === 'PUT')
  await editor.save.click()
  expect((await saved).status()).toBe(200)
  await expect(editor.heading).toHaveCount(0)

  expect(dbTree(template.id)).toEqual(screen)
  expect(sqlJson(`select to_json(description) from project_templates where id=${q(template.id)}`)).toBe(twelve)
  const attachment = sqlJson<{ storage_path: string; original_name: string }[]>(`select coalesce(json_agg(json_build_object('storage_path', a.storage_path, 'original_name', a.original_name)), '[]')
    from document_requirement_attachments a join template_document_requirements d on d.id=a.template_document_requirement_id
    join template_activities ta on ta.id=d.template_activity_id join template_phases tp on tp.id=ta.template_phase_id
    where tp.template_id=${q(template.id)} and d.name='Doc nou'`)
  expect(attachment.map(a => a.original_name)).toEqual(['model-sablon.pdf'])
  const { data, error } = await service.storage.from(BUCKET).download(attachment[0].storage_path)
  expect(error, 'fișierul-model lipsește din Storage').toBeNull()
  expect(Buffer.from(await data!.arrayBuffer()).equals(model.buffer), 'Storage are alt conținut decât fișierul ales').toBe(true)
})
