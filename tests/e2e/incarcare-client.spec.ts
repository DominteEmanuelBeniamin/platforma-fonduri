import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import {
  createTemporaryProject,
  destroyTemporaryProject,
  e2eEnv,
  registerCreatedRequest,
  requireE2EConfig,
  serviceClient,
  verifyServerUsesFixture,
  type TemporaryProjectFixture,
} from './helpers/project-state'

/**
 * Încărcarea clientului, câte un dialog pe cerere (S-19 din feedback-ul lui
 * Sandu, 21 octombrie 2026). Înainte, o activitate ținea o singură listă de
 * fișiere pentru toate cererile ei: ce alegeai la A pleca la B.
 */
const CONFIG = requireE2EConfig(e2eEnv())
const admin = serviceClient()

const pdf = (name: string) => ({
  name,
  mimeType: 'application/pdf',
  buffer: Buffer.from(`%PDF-1.4\n% ${name}\n%%EOF\n`),
})

async function login(page: Page) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.locator('input[type=email]').fill(CONFIG.clientEmail)
  await page.locator('input[type=password]').fill(CONFIG.clientPassword)
  await page.getByRole('button', { name: 'Intră în cont' }).click()
  await page.waitForURL('/', { timeout: 25_000 })
}

test.describe('încărcarea clientului, câte un dialog pe cerere', () => {
  let fixture: TemporaryProjectFixture | null = null
  let requestA = ''
  let requestB = ''

  test.beforeEach(async () => {
    if (!admin) throw new Error('Clientul service E2E lipsește din configurația dedicată')
    fixture = await createTemporaryProject(admin, CONFIG)
    await verifyServerUsesFixture(CONFIG, fixture.projectId)
    // Două cereri curate în aceeași activitate: exact situația bug-ului.
    requestA = randomUUID()
    requestB = randomUUID()
    for (const [id, name, order] of [[requestA, 'Cerere A e2e', 2], [requestB, 'Cerere B e2e', 3]] as const) {
      const { error } = await admin.from('document_requirements').insert({
        id,
        project_id: fixture.projectId,
        activity_id: fixture.activityId,
        name,
        order_index: order,
        requirement_type: 'obligatoriu',
        is_mandatory: true,
        is_outgoing: false,
        deadline_at: '2030-01-03T00:00:00.000Z',
        status: 'pending',
        visibility: 'published',
        is_locked: false,
      })
      if (error) throw new Error(`crearea cererii ${name}: ${error.message}`)
      registerCreatedRequest(fixture.registry, id, fixture.activityId)
    }
  })

  test.afterEach(async () => {
    if (admin && fixture) await destroyTemporaryProject(admin, fixture)
    fixture = null
  })

  test('fișierele merg doar la cererea lor, iar închiderea cu fișiere alese întreabă', async ({ page }) => {
    const inits: string[] = []
    page.on('request', request => {
      const match = request.url().match(/document-requests\/([^/]+)\/uploads\/init/)
      if (match) inits.push(match[1])
    })

    await login(page)
    await page.goto(`/projects/${fixture!.projectId}`)
    const activity = page.locator(`#activity-${fixture!.activityId}`)
    await activity.getByRole('button', { name: /^Extinde activitatea/ }).click()
    const openA = page.locator(`#request-${requestA}`).getByRole('button', { name: 'Încarcă fișiere' })
    const openB = page.locator(`#request-${requestB}`).getByRole('button', { name: 'Încarcă fișiere' })
    const dialogA = page.getByRole('dialog', { name: 'Cerere A e2e' })
    const confirmation = page.getByRole('dialog', { name: 'Renunți la fișierele alese?' })

    // 1. Ales la A, apoi „Anulează”: confirmarea, nimic încărcat, focusul înapoi pe buton.
    await openA.click()
    await expect(dialogA).toBeVisible()
    await expect(dialogA.getByRole('button', { name: 'Alege fișiere' })).toBeFocused()
    await dialogA.locator('input[type=file]').first().setInputFiles(pdf('a-renunt.pdf'))
    await expect(dialogA.getByText('1 fișier selectat')).toBeVisible()
    await dialogA.getByRole('button', { name: 'Anulează' }).click()
    await expect(confirmation).toBeVisible()
    await expect(confirmation).toContainText('Ai ales 1 fișier care nu s-a încărcat. Dacă închizi, selecția se pierde.')
    await confirmation.getByRole('button', { name: 'Renunță la ele' }).click()
    await expect(dialogA).toHaveCount(0)
    await expect(openA).toBeFocused()
    expect(inits, 'renunțarea nu încarcă nimic').toEqual([])

    // 2. B se deschide gol: nimic din ce s-a ales la A nu trece la el.
    await openB.click()
    const dialogB = page.getByRole('dialog', { name: 'Cerere B e2e' })
    await expect(dialogB.getByRole('button', { name: 'Alege fișiere' })).toBeVisible()
    await expect(dialogB.getByRole('list', { name: 'Fișierele alese' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(dialogB).toHaveCount(0)

    // 3. Escape cu fișiere alese întreabă; Escape pe confirmare închide doar confirmarea.
    await openA.click()
    await dialogA.locator('input[type=file]').first().setInputFiles(pdf('a.pdf'))
    await page.keyboard.press('Escape')
    await expect(confirmation).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(confirmation).toHaveCount(0)
    await expect(dialogA.getByText('a.pdf')).toBeVisible()

    // 4. Încărcarea care cade lasă dialogul deschis, cu fișierul marcat; reîncercarea merge.
    await page.route('**/storage/v1/object/upload/sign/**', route => route.fulfill({ status: 500, body: '{}' }))
    await dialogA.getByRole('button', { name: 'Încarcă (1)' }).click()
    await expect(dialogA.getByText('Încărcarea fișierului a eșuat. Reîncearcă.')).toBeVisible({ timeout: 20_000 })
    await expect(dialogA).toBeVisible()
    await page.unroute('**/storage/v1/object/upload/sign/**')
    await dialogA.getByRole('button', { name: 'Încarcă (1)' }).click()
    await expect(dialogA).toHaveCount(0, { timeout: 20_000 })

    // 5. În bază, fișierul e la A și numai la A.
    expect(inits.every(id => id === requestA), `init doar la A, primit: ${inits.join(', ')}`).toBe(true)
    const { data, error } = await admin!.from('files')
      .select('requirement_id, original_name')
      .in('requirement_id', [requestA, requestB])
    expect(error).toBeNull()
    expect(data).toEqual([{ requirement_id: requestA, original_name: 'a.pdf' }])
  })
})
