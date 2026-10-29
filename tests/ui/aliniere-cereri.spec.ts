import { test, expect, type Page } from '@playwright/test'
import { autentifica } from './helpers'

const projectId = '20000000-0000-4000-8000-000000000001'
const phaseId = '20000000-0000-4000-8000-000000000002'
const activityId = '20000000-0000-4000-8000-000000000003'
const nextYearActivityId = '20000000-0000-4000-8000-000000000004'
const consultant = { id: 'consultant-test', full_name: 'Consultant proiect', email: 'consultant@test.invalid' }

async function deschideTabelul(page: Page, role: 'admin' | 'client') {
  await autentifica(page, role)
  const visibility = role === 'admin' ? 'draft' : 'published'
  const activity = {
    id: activityId, phase_id: phaseId, name: 'Activitate cu un titlu lung pentru verificarea alinierii coloanelor',
    visibility, assigned_to: consultant.id, assigned_user: consultant, deadline_at: '2026-12-15',
  }
  const phase = { id: phaseId, name: 'Fază de verificare', visibility, activities: [activity, {
    ...activity, id: nextYearActivityId, name: 'Activitate cu termen în 2027', deadline_at: '2027-02-15',
  }] }
  const requests = ['Cerere de document cu un titlu foarte lung care trebuie să se încadreze fără să împingă statusul', 'DocumentFaraSpatii'.repeat(12)].map((name, index) => ({
    id: `aliniere-${index}`, name, activity_id: activityId, visibility, status: 'pending', deadline_at: index ? '2027-02-15' : '2026-12-15',
    activity: { ...activity, phase },
    files: [{ id: `file-${index}`, storage_path: 'test/document.pdf', original_name: 'document.pdf', created_at: '2026-10-20T10:00:00Z' }],
  }))
  await page.route(`**/api/projects/${projectId}**`, route => {
    const path = new URL(route.request().url()).pathname
    const json = path.endsWith('/phases') ? { phases: [phase] }
      : path.endsWith('/document-requests') ? { requests }
      : path.endsWith('/members') ? { members: [] }
      : { project: { id: projectId, title: 'Verificare aliniere', lifecycle_status: 'active' } }
    return route.fulfill({ json })
  })
  await page.goto(`/projects/${projectId}`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /^Extinde activitatea/ }).first().click()
  await expect(page.locator('#request-aliniere-0')).toBeVisible()
}

test('„În pregătire” nu are contur și fundal alb; păstrează focusul de tastatură', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'stilul pe fundalul activității se verifică pe desktop')
  await deschideTabelul(page, 'admin')
  await page.mouse.move(0, 0)
  const control = page.locator(`#activity-${activityId} > div`).first().getByRole('switch')
  await expect(control).toHaveCSS('border-top-width', '0px')
  await expect(control).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(control).not.toHaveCSS('outline-style', 'solid')
  await page.keyboard.press('Tab')
  await control.focus()
  await expect(control).toHaveCSS('outline-style', 'solid')
  await expect(control).toHaveCSS('outline-width', '2px')
})

test('creionul și calendarul nu deplasează data la hover sau focus', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'hover-ul se verifică pe desktop')
  await page.setViewportSize({ width: 1280, height: 1000 })
  await deschideTabelul(page, 'admin')
  for (const requestId of ['aliniere-0', 'aliniere-1']) {
    const button = page.locator(`#request-${requestId}`).getByRole('button', { name: /^Schimbă termenul/ })
    const date = button.locator(':scope > span')
    const before = (await date.boundingBox())!
    await button.hover()
    await expect(button.locator('svg')).toHaveCSS('opacity', '1')
    expect((await date.boundingBox())!.x).toBe(before.x)
    await page.keyboard.press('Tab')
    await button.focus()
    await expect(button).toHaveCSS('outline-style', 'solid')
    await button.click()
    await expect(button).toHaveAttribute('aria-expanded', 'true')
    expect((await date.boundingBox())!.x).toBe(before.x)
    await page.keyboard.press('Escape')
    await expect(button).toHaveAttribute('aria-expanded', 'false')
  }
})

for (const role of ['admin', 'client'] as const) {
  test(`cererile se aliniază cu antetul ca ${role}, cu panoul deschis și închis`, async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'alinierile coloanelor se verifică la lățimi de desktop')
    await deschideTabelul(page, role)
    const activity = page.locator(`#activity-${activityId}`)
    const header = page.locator(`#phase-${phaseId} div[aria-hidden="true"]`).first()

    for (const width of [1100, 1280, 1366, 1440, 1600]) {
      await page.setViewportSize({ width, height: 1000 })
      for (const collapsed of [false, true]) {
        if (collapsed) await page.getByRole('button', { name: 'Strânge panoul fazelor' }).click()
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), { message: `fără depășire la ${width}px, panou ${collapsed ? 'închis' : 'deschis'}` }).toBeLessThanOrEqual(1)

        if (await header.isVisible()) {
          for (const requestId of ['aliniere-0', 'aliniere-1']) {
            const request = page.locator(`#request-${requestId}`)
            const cells = request.locator(':scope > div').first().locator(':scope > div').nth(1).locator(':scope > div')
            for (const [index, name] of ['Status', 'Documente', 'Termen', ...(role === 'admin' ? ['Vizibil clientului'] : [])].entries()) {
              await expect.poll(async () => {
                const heading = (await header.getByText(name, { exact: true }).boundingBox())!
                const content = (await cells.nth(index).boundingBox())!
                return Math.abs(heading.x + heading.width / 2 - content.x - content.width / 2)
              }, { message: `${name}, ${requestId}, ${width}px, panou ${collapsed ? 'închis' : 'deschis'}` }).toBeLessThan(1.5)
            }
            const status = request.locator('span[data-tooltip]').filter({ hasText: role === 'admin' ? 'Așteaptă răspuns' : 'De încărcat' })
            const statusBox = (await status.boundingBox())!
            const columnBox = (await header.getByText('Status', { exact: true }).boundingBox())!
            expect(Math.abs(statusBox.x + statusBox.width / 2 - columnBox.x - columnBox.width / 2)).toBeLessThan(1.5)
            const dateBox = (await cells.nth(2).locator('span.tabular-nums').boundingBox())!
            expect(dateBox.height, 'data și anul rămân pe un singur rând').toBeLessThanOrEqual(17)
            const deadlineColumn = (await header.getByText('Termen', { exact: true }).boundingBox())!
            expect(Math.abs(dateBox.x + dateBox.width / 2 - deadlineColumn.x - deadlineColumn.width / 2), `data vizibilă din ${requestId} este centrată`).toBeLessThan(1.5)
          }
          const deadlineColumn = (await header.getByText('Termen', { exact: true }).boundingBox())!
          for (const id of [activityId, nextYearActivityId]) {
            const date = page.locator(`#activity-${id} > div`).first().locator('span.tabular-nums').filter({ hasText: /15 (dec\.|feb\. 2027)/ })
            const dateBox = (await date.boundingBox())!
            expect(dateBox.height, 'termenul activității rămâne pe un singur rând').toBeLessThanOrEqual(17)
            expect(Math.abs(dateBox.x + dateBox.width / 2 - deadlineColumn.x - deadlineColumn.width / 2), `data vizibilă din ${id} este centrată`).toBeLessThan(1.5)
          }
          const range = header.locator('..').locator('span[title^="Termenele activităților"]')
          await expect(range).toHaveText('15 dec – 15 feb 2027')
          const rangeBox = (await range.boundingBox())!
          expect(Math.abs(rangeBox.x + rangeBox.width / 2 - deadlineColumn.x - deadlineColumn.width / 2), 'intervalul din Total este centrat').toBeLessThan(1.5)
          const activityBox = (await activity.boundingBox())!
          const requestBox = (await page.locator('#request-aliniere-0').boundingBox())!
          expect(requestBox.x + requestBox.width).toBeLessThanOrEqual(activityBox.x + activityBox.width + 1)
          if (role === 'admin') {
            const icon = (await activity.getByRole('button', { name: 'Adaugă cerere de document nouă' }).locator('svg').boundingBox())!
            expect(icon.x).toBeGreaterThan(activityBox.x + 1.3 * 16)
          }
        }
        await page.screenshot({ path: info.outputPath(`${role}-${width}-${collapsed ? 'inchis' : 'deschis'}.png`), fullPage: true })
      }
      await page.getByRole('button', { name: 'Arată panoul fazelor' }).click()
    }
  })
}
