import { test, expect } from './fixtures'
import { PREFIX, q, seedTemplate, sqlJson, tag } from './support'
import { TemplatesListPage } from '../pages/TemplatesListPage'
import { TemplateEditorPage } from '../pages/TemplateEditorPage'
import type { Page, Route } from '@playwright/test'

/**
 * Flux 3 — salvarea șablonului nu se întrerupe (S-29) și „Anulează” cere
 * confirmare doar când ai ce pierde (D12, Z-02).
 *
 * Singura intervenție în rețea: răspunsul salvării e ținut până îl eliberează
 * testul (`route.fetch()` — cererea ajunge întreagă la server).
 */

function holdResponses(page: Page, pattern: string, method: string) {
  let release!: () => void
  const released = new Promise<void>(resolve => { release = resolve })
  const seen: string[] = []
  return {
    seen,
    release,
    install: () => page.route(pattern, async (route: Route) => {
      if (route.request().method() !== method) return route.fallback()
      seen.push(`${method} ${new URL(route.request().url()).pathname}`)
      const response = await route.fetch()
      await released
      await route.fulfill({ response })
    }),
  }
}

function templateSnapshot(templateId: string) {
  return sqlJson(`select json_build_object('name', t.name, 'description', t.description, 'phases', (
      select coalesce(json_agg(json_build_object('name', p.name, 'status', p.project_status_id, 'activities', (
        select coalesce(json_agg(a.name order by a.order_index), '[]') from template_activities a where a.template_phase_id=p.id and a.is_active
      )) order by p.order_index), '[]') from template_phases p where p.template_id=t.id and p.is_active))
    from project_templates t where t.id=${q(templateId)}`)
}

test.describe('Flux 3 — salvarea nu se întrerupe, „Anulează” cere confirmare', () => {
  test('dublu clic pe „Creează” face o singură salvare; ieșirea din pagină în timpul ei cere confirmare', async ({ team, as, seeds }) => {
    const page = await as(team.admin)
    const list = new TemplatesListPage(page)
    const editor = new TemplateEditorPage(page)
    const name = `${PREFIX} dublu ${tag()}`
    await list.goto()
    await list.newTemplate.click()
    await editor.expectOpen()
    await editor.name.fill(name)
    await editor.addPhaseNamed('Faza unică 1')
    await editor.addPhaseNamed('Faza unică 2')

    const hold = holdResponses(page, '**/api/admin/templates', 'POST')
    await hold.install()
    const dialogs: string[] = []
    page.on('dialog', dialog => { dialogs.push(dialog.type()); void dialog.dismiss() })

    await editor.save.dblclick()
    await expect(editor.save).toHaveAttribute('aria-busy', 'true')
    await expect(editor.cancel).toHaveAttribute('aria-disabled', 'true')
    // „Anulează” și „Șabloane” din fâșie nu închid editorul cât se salvează.
    // „Anulează” e doar `aria-disabled`, deci un om îl poate apăsa: clic real cu mausul.
    const cancelBox = (await editor.cancel.boundingBox())!
    await page.mouse.click(cancelBox.x + cancelBox.width / 2, cancelBox.y + cancelBox.height / 2)
    await page.getByRole('navigation', { name: 'Locație' }).getByRole('button', { name: 'Șabloane' }).click()
    await expect(editor.heading).toHaveText('Șablon nou')
    await expect(editor.discardDialog().root).toHaveCount(0)

    // Închiderea filei cere confirmare (beforeunload); refuzată, pagina rămâne.
    await page.close({ runBeforeUnload: true })
    await expect.poll(() => dialogs).toEqual(['beforeunload'])
    expect(page.isClosed()).toBe(false)
    await expect(editor.heading).toBeVisible()

    hold.release()
    await expect(editor.heading).toHaveCount(0)
    await expect(list.menuButton(name)).toBeVisible()
    expect(hold.seen, 'câte salvări au plecat').toEqual(['POST /api/admin/templates'])
    const rows = sqlJson<{ id: string; phases: string[] }[]>(`select coalesce(json_agg(json_build_object('id', t.id, 'phases', (select json_agg(p.name order by p.order_index) from template_phases p where p.template_id=t.id))), '[]') from project_templates t where t.name=${q(name)}`)
    for (const row of rows) seeds.templates.add(row.id)
    expect(rows.map(r => r.phases)).toEqual([['Faza unică 1', 'Faza unică 2']])
  })

  test('„Anulează”: fără modificări închide direct; cu modificări întreabă, refuzul le păstrează, confirmarea lasă baza neschimbată', async ({ team, as, seeds }) => {
    const template = await seedTemplate({
      label: `anulare ${tag()}`,
      phases: [{ name: 'Faza 1', activities: [{ name: 'Activitate 1' }] }, { name: 'Faza 2' }],
    })
    seeds.templates.add(template.id)
    const before = templateSnapshot(template.id)
    const page = await as(team.admin)
    const list = new TemplatesListPage(page)
    const editor = new TemplateEditorPage(page)
    const discard = editor.discardDialog()
    await list.goto()

    // Fără modificări: nicio întrebare.
    await list.action(template.name, 'Editează')
    await editor.expectOpen()
    await editor.cancel.click()
    await expect(editor.heading).toHaveCount(0)
    await expect(discard.root).toHaveCount(0)
    await expect(list.heading).toBeVisible()

    // Cu modificări: întreabă; „Anulează” din confirmare păstrează tot ce era pe ecran.
    await list.action(template.name, 'Editează')
    await editor.rename('faza', 'Faza 1', 'Faza 1 schimbată')
    await editor.addPhaseNamed('Faza 3')
    await editor.description.fill('Descriere care nu trebuie să ajungă în bază')
    await editor.cancel.click()
    await discard.expectOpen('Ce ai schimbat de la ultima salvare se pierde.')
    await discard.cancel()
    await expect(editor.heading).toBeVisible()
    await expect(page.getByRole('heading', { level: 3 })).toHaveText(['Faza 1 schimbată', 'Faza 2', 'Faza 3'])
    await expect(editor.description).toHaveValue('Descriere care nu trebuie să ajungă în bază')

    // Același drum din fâșia de locație: tot întreabă.
    await page.getByRole('navigation', { name: 'Locație' }).getByRole('button', { name: 'Șabloane' }).click()
    await discard.expectOpen()
    await discard.confirm('Renunță la modificări')
    await expect(editor.heading).toHaveCount(0)
    await expect(list.menuButton(template.name)).toBeVisible()
    expect(templateSnapshot(template.id)).toEqual(before)
  })
})
