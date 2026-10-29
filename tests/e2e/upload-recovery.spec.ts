import type { Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { test as base, expect } from './pr122/fixtures'
import { BUCKET, pdf, q, seedProject, service, sql, sqlJson, storageText } from './pr122/support'
import { ClientUploadDialog } from './pages/ClientUploadDialog'
import { ProjectTablePage } from './pages/ProjectTablePage'

type Completion = { batchId: string; fileIds: string[] }
type SavedFile = { name: string; path: string; version: number }
type Upload = {
  page: Page
  dialog: ClientUploadDialog
  requestId: string
  completeUrl: string
  initializations: string[][]
  completions: Completion[]
  puts: string[]
  paths: Map<string, string>
}

const test = base.extend<{ upload: Upload }>({
  upload: async ({ team, as, seeds }, provide) => {
    const projectId = randomUUID()
    seeds.projects.add(projectId)
    const project = await seedProject({
      label: 'upload-recovery', client: team.client, members: [team.senior],
      phases: [{ name: 'Acte', activities: [{ name: 'Dosar', assignedTo: team.senior.id, requests: [{ name: 'Act de probă' }] }] }],
    }, projectId)
    const requestId = project.requests.get('Act de probă')!
    const page = await as(team.client)
    const initializations: string[][] = []
    const completions: Completion[] = []
    const puts: string[] = []
    const paths = new Map<string, string>()
    await page.route(`**/api/document-requests/${requestId}/uploads/init`, async route => {
      const files = route.request().postDataJSON().files as { name: string }[]
      initializations.push(files.map(file => file.name))
      const response = await route.fetch()
      expect(response.ok()).toBe(true)
      const body = await response.json()
      for (const upload of body.uploads) paths.set(upload.storagePath, files[upload.clientFileId].name)
      await route.fulfill({ response })
    })
    page.on('request', request => {
      if (request.url().endsWith(`/api/document-requests/${requestId}/uploads/complete`)) {
        completions.push(request.postDataJSON())
      }
      if (request.method() === 'PUT' && request.url().includes('/storage/v1/object/upload/sign/')) {
        puts.push(request.url())
      }
    })
    const table = new ProjectTablePage(page)
    await table.goto(project.id)
    await table.expandActivity(project.activities.get('Dosar')!, 'Dosar')
    await ClientUploadDialog.opener(page, requestId).click()
    const dialog = new ClientUploadDialog(page, 'Act de probă')
    await dialog.expectOpen()
    try {
      await provide({ page, dialog, requestId, completeUrl: `**/api/document-requests/${requestId}/uploads/complete`, initializations, completions, puts, paths })
    } finally {
      // Confirmarea refuzată poate lăsa obiecte fără rând în `files`.
      if (paths.size) {
        const removed = await service.storage.from(BUCKET).remove([...paths.keys()])
        expect(removed.error).toBeNull()
      }
    }
  },
})

function savedFiles(requestId: string): SavedFile[] {
  return sqlJson(`select coalesce(json_agg(json_build_object('name', original_name, 'path', storage_path, 'version', version_number) order by version_number, original_name), '[]')
    from files where requirement_id=${q(requestId)}`)
}

function batchVersions(requestId: string): (number | null)[] {
  return sqlJson(`select coalesce(json_agg(version_number order by created_at, id), '[]') from document_upload_batches where requirement_id=${q(requestId)}`)
}

const FAILED_CONFIRMATION = 'Confirmarea a fost întreruptă pentru test.'

test('confirmarea eșuată se reîncearcă pe același lot, fără un nou transfer', async ({ upload }) => {
  let first = true
  await upload.page.route(upload.completeUrl, async route => {
    if (!first) return route.continue()
    first = false
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: FAILED_CONFIRMATION }) })
  })
  const file = pdf('confirmare.pdf')
  await upload.dialog.pick(upload.dialog.choose, [file])
  await upload.dialog.upload.click()
  await expect(upload.page.getByText(FAILED_CONFIRMATION, { exact: true })).toBeVisible()
  expect(savedFiles(upload.requestId)).toEqual([])
  expect(batchVersions(upload.requestId)).toEqual([null])
  await upload.dialog.upload.click()
  await expect(upload.dialog.root).toHaveCount(0)
  expect(upload.initializations).toEqual([['confirmare.pdf']])
  expect(upload.puts).toHaveLength(1)
  expect(upload.completions).toHaveLength(2)
  expect(upload.completions[1]).toEqual(upload.completions[0])
  expect(batchVersions(upload.requestId)).toEqual([1])
  const files = savedFiles(upload.requestId)
  expect(files.map(file => [file.name, file.version])).toEqual([['confirmare.pdf', 1]])
  expect(await storageText(files[0].path)).toBe(file.buffer.toString())
})

test('răspunsul pierdut după salvare nu dublează fișierul sau versiunea', async ({ upload }) => {
  let first = true
  await upload.page.route(upload.completeUrl, async route => {
    if (!first) return route.continue()
    first = false
    const response = await route.fetch()
    expect(response.ok()).toBe(true)
    expect(await response.json()).toMatchObject({ created: true, versionNumber: 1 })
    await route.abort('connectionreset')
  })
  await upload.dialog.pick(upload.dialog.choose, [pdf('raspuns-pierdut.pdf')])
  await upload.dialog.upload.click()
  await expect(upload.dialog.upload).toBeEnabled()
  expect(savedFiles(upload.requestId)).toHaveLength(1)
  await upload.dialog.upload.click()
  await expect(upload.dialog.root).toHaveCount(0)
  expect(upload.completions).toHaveLength(2)
  expect(upload.completions[1]).toEqual(upload.completions[0])
  expect(upload.initializations).toHaveLength(1)
  expect(upload.puts).toHaveLength(1)
  expect(savedFiles(upload.requestId)).toHaveLength(1)
  expect(batchVersions(upload.requestId)).toEqual([1])
})

test('fișierul adăugat după eroare pornește numai după confirmarea lotului vechi', async ({ upload }) => {
  let first = true
  await upload.page.route(upload.completeUrl, async route => {
    if (!first) return route.continue()
    first = false
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: FAILED_CONFIRMATION }) })
  })
  await upload.dialog.pick(upload.dialog.choose, [pdf('vechi.pdf')])
  await upload.dialog.upload.click()
  await expect(upload.page.getByText(FAILED_CONFIRMATION, { exact: true })).toBeVisible()
  await upload.dialog.pick(upload.dialog.addMore, [pdf('nou.pdf')])
  await upload.dialog.upload.click()
  await expect(upload.dialog.root).toHaveCount(0)
  expect(upload.initializations).toEqual([['vechi.pdf'], ['nou.pdf']])
  expect(upload.puts).toHaveLength(2)
  expect(upload.completions).toHaveLength(3)
  expect(upload.completions[1]).toEqual(upload.completions[0])
  expect(upload.completions[2].batchId).not.toBe(upload.completions[0].batchId)
  expect(savedFiles(upload.requestId).map(file => [file.name, file.version])).toEqual([['vechi.pdf', 1], ['nou.pdf', 2]])
  expect(batchVersions(upload.requestId)).toEqual([1, 2])
})

test('transferul parțial reîncearcă doar fișierul eșuat', async ({ upload }) => {
  let blocked = false
  await upload.page.route('**/storage/v1/object/upload/sign/**', async route => {
    const name = [...upload.paths].find(([path]) => decodeURIComponent(route.request().url()).includes(path))?.[1]
    if (!blocked && route.request().method() === 'PUT' && name === 'b.pdf') {
      blocked = true
      return route.fulfill({ status: 500, body: '{}' })
    }
    return route.continue()
  })
  await upload.dialog.pick(upload.dialog.choose, [pdf('a.pdf'), pdf('b.pdf')])
  await upload.dialog.upload.click()
  await expect(upload.page.getByText('1 fișiere au fost încărcate, iar 1 au eșuat. Verifică lista fișierelor.', { exact: true })).toBeVisible()
  expect(blocked).toBe(true)
  expect(savedFiles(upload.requestId).map(file => file.name)).toEqual(['a.pdf'])
  await upload.dialog.upload.click()
  await expect(upload.dialog.root).toHaveCount(0)
  expect(upload.initializations).toEqual([['a.pdf', 'b.pdf'], ['b.pdf']])
  expect(upload.puts).toHaveLength(3)
  expect(savedFiles(upload.requestId).map(file => [file.name, file.version])).toEqual([['a.pdf', 1], ['b.pdf', 2]])
})

test('cererea închisă după transfer refuză confirmarea fără salvare parțială', async ({ upload }) => {
  await upload.page.route(upload.completeUrl, async route => {
    sql(`update document_requirements set status='closed', status_before_close='pending', closed_at=clock_timestamp() where id=${q(upload.requestId)}`)
    const response = await route.fetch()
    expect(response.status()).toBe(409)
    await route.fulfill({ response })
  })
  await upload.dialog.pick(upload.dialog.choose, [pdf('cerere-inchisa.pdf')])
  await upload.dialog.upload.click()
  await expect(upload.page.getByText('Cererea a fost închisă între timp. Nu se mai pot încărca fișiere.', { exact: true })).toBeVisible()
  await expect(upload.dialog.root).toBeVisible()
  expect(savedFiles(upload.requestId)).toEqual([])
  expect(batchVersions(upload.requestId)).toEqual([null])
  expect(sql(`select status from document_requirements where id=${q(upload.requestId)}`)).toBe('closed')
})
