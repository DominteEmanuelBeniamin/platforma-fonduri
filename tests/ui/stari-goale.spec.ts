import { test, expect } from '@playwright/test'
import { autentifica } from './helpers'

const projectId = '10000000-0000-4000-8000-000000000001'
const phaseId = '10000000-0000-4000-8000-000000000002'
const phase = { id: phaseId, name: 'Fază publicată', visibility: 'published', activities: [] }

test.describe('Stări fără conținut în contul clientului', () => {
  test.beforeEach(async ({ page }) => {
    await autentifica(page, 'client')
    // Datele proiectului sunt simulate în browser; testele nu creează date în bază.
    await page.route(`**/api/projects/${projectId}**`, async route => {
      const path = new URL(route.request().url()).pathname
      const json = path.endsWith('/phases') ? { phases: [phase] }
        : path.endsWith('/document-requests') ? { requests: [] }
        : path.endsWith('/members') ? { members: [] }
        : path.includes('/chat/') ? { items: [], nextCursor: null }
        : { project: { id: projectId, title: 'Proiect pentru stări goale', lifecycle_status: 'active' } }
      await route.fulfill({ json })
    })
  })

  test('cererile generale selectate din meniu explică lipsa publicării', async ({ page }) => {
    await page.goto(`/projects/${projectId}`, { waitUntil: 'networkidle' })
    if (!await page.locator('aside').isVisible()) {
      await page.getByRole('button', { name: 'Toate fazele: reordonare, activități, echipă' }).click()
    }
    await page.locator('aside').getByText('Cereri generale', { exact: true }).click()
    await expect(page.locator('main').getByRole('heading', { name: 'Cereri generale', exact: true })).toBeVisible()
    await expect(page.getByText('Nicio cerere publicată încă.', { exact: false })).toBeVisible()
    await expect(page.locator(`#phase-${phaseId}`)).toHaveCount(0)
  })

  test('linkul direct spre cereri generale funcționează și fără faze', async ({ page }) => {
    await page.route(`**/api/projects/${projectId}/phases`, route => route.fulfill({ json: { phases: [] } }))
    await page.goto(`/projects/${projectId}?phase=__general__`, { waitUntil: 'networkidle' })
    await expect(page.getByText('Nicio cerere publicată încă.', { exact: false })).toBeVisible()
  })

  test('fazele și activitățile goale au mesaje potrivite clientului', async ({ page }) => {
    await page.goto(`/projects/${projectId}`, { waitUntil: 'networkidle' })
    await expect(page.locator('main').getByText('Nicio activitate publicată în această fază încă.')).toBeVisible()

    await page.route(`**/api/projects/${projectId}/phases`, route => route.fulfill({ json: { phases: [] } }))
    await page.reload({ waitUntil: 'networkidle' })
    await expect(page.locator('main main').getByText('Nicio fază publicată încă')).toBeVisible()
    await expect(page.locator('aside').getByText('Nicio fază publicată încă')).toHaveCount(1)
    await expect(page.getByText(/Importă un șablon ca să apară/)).toHaveCount(0)
  })

  test('cererile publicate rămân vizibile fără mesaj de listă goală', async ({ page }) => {
    await page.route(`**/api/projects/${projectId}/document-requests`, route => route.fulfill({ json: {
      requests: [{ id: 'request-published', name: 'Cerere publicată', visibility: 'published', status: 'pending', activity_id: null, files: [] }],
    } }))
    await page.goto(`/projects/${projectId}?phase=__general__`, { waitUntil: 'networkidle' })
    await expect(page.locator('#request-request-published')).toContainText('Cerere publicată')
    await expect(page.getByText('Nicio cerere publicată încă.', { exact: false })).toHaveCount(0)
  })

  test('chatul proiectului explică lipsa mesajelor, iar erorile rămân erori', async ({ page }) => {
    await page.goto(`/projects/${projectId}`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: /^Chat/ }).first().click()
    await expect(page.getByText('Niciun mesaj în acest proiect încă')).toBeVisible()

    await page.route(`**/api/projects/${projectId}/chat/messages*`, route => route.fulfill({ status: 500, json: { error: 'Mesajele nu pot fi încărcate.' } }))
    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('button', { name: /^Chat/ }).first().click()
    await expect(page.getByText('Nu am putut încărca mesajele. Reîncearcă peste câteva momente.', { exact: true })).toBeVisible()
    await expect(page.getByText('Niciun mesaj în acest proiect încă')).toHaveCount(0)
  })
})

test('conversația privată goală invită la primul mesaj, iar erorile rămân erori', async ({ page }) => {
  await autentifica(page, 'staff')
  const conversationId = '10000000-0000-4000-8000-000000000003'
  await page.route('**/api/private-conversations**', route => {
    const path = new URL(route.request().url()).pathname
    const json = path === '/api/private-conversations' ? { items: [{
      id: conversationId, other_user: { id: 'other-user', full_name: 'Consultant test', email: 'consultant@test.invalid' },
      last_message: null, last_message_at: null, last_read_at: null, other_last_read_at: null,
    }] } : { items: [], nextCursor: null }
    return route.fulfill({ json })
  })
  await page.goto('/chat', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Consultant test/ }).click()
  await expect(page.getByText('Niciun mesaj încă', { exact: true })).toBeVisible()
  await expect(page.getByText('Scrie primul mesaj pentru a începe conversația.', { exact: true })).toBeVisible()
  await page.route(`**/api/private-conversations/${conversationId}/messages*`, route => route.fulfill({ status: 500, json: {} }))
  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.getByText('Nu am putut încărca mesajele. Reîncearcă peste câteva momente.', { exact: true })).toBeVisible()
  await expect(page.getByText('Niciun mesaj încă', { exact: true })).toHaveCount(0)
})
