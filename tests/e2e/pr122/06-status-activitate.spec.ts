import { test, expect } from './fixtures'
import { pdf, q, seedProject, sql } from './support'
import { ProjectTablePage } from '../pages/ProjectTablePage'
import { ClientUploadDialog } from '../pages/ClientUploadDialog'
import { ConfirmDialog } from '../pages/ConfirmDialog'
import type { Page } from '@playwright/test'

/**
 * Flux 6 — statusul calculat al activității (`lib/activity-status.ts`). Fiecare
 * stare se produce prin acțiuni reale: clientul încarcă, echipa respinge sau
 * aprobă din fișa cererii, seniorul finalizează activitatea; „Depășită” vine
 * din ceasul paginii, mutat după termen. Se verifică eticheta exactă, la echipă
 * și la client, și ordinea când stările se suprapun:
 * Finalizată > Depășită > Document respins > De verificat > La client > Toate primite
 * (la client: De încărcat înaintea lui În verificare).
 */

const DEADLINE = '2030-06-01T00:00:00.000Z'
const AFTER_DEADLINE = new Date('2030-06-02T09:00:00+03:00')

async function clientUpload(page: Page, requestId: string, requestName: string, file: string) {
  const dialog = new ClientUploadDialog(page, requestName)
  await ClientUploadDialog.opener(page, requestId).click()
  await dialog.expectOpen()
  await dialog.pick(dialog.choose, [pdf(file)])
  await dialog.upload.click()
  await expect(dialog.root).toHaveCount(0)
}

/** Fișa cererii (`DocumentModal`), deschisă din rândul ei. */
function sheet(page: Page, requestName: string) {
  return page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: requestName }) })
}

async function review(page: Page, requestId: string, requestName: string, decision: 'Aprobă' | 'Respinge') {
  await page.locator(`#request-${requestId}`).getByRole('heading', { name: requestName }).click()
  const modal = sheet(page, requestName)
  await expect(modal).toBeVisible()
  if (decision === 'Respinge') {
    await modal.getByPlaceholder('Opțional la aprobare, obligatoriu la respingere').fill('Documentul nu e semnat')
    await modal.getByRole('button', { name: 'Respinge', exact: true }).click()
    await new ConfirmDialog(page, 'Confirmă respingerea').confirm('Respinge documentul')
  } else {
    await modal.getByRole('button', { name: 'Aprobă documentul' }).click()
  }
  await expect(modal).toHaveCount(0)
}

test('statusul activității, produs prin acțiuni reale, cu ordinea corectă la echipă și la client', async ({ team, as, seeds, loginFresh }) => {
  test.setTimeout(240_000)
  const project = await seedProject({
    label: 'status',
    client: team.client,
    members: [team.senior],
    phases: [{
      name: 'Documentație',
      activities: [{
        name: 'Dosarul firmei',
        assignedTo: team.senior.id,
        deadline: DEADLINE,
        requests: [
          { name: 'Statut', deadline: DEADLINE },
          { name: 'Bilanț', deadline: DEADLINE },
          { name: 'Cazier fiscal', deadline: DEADLINE },
        ],
      }],
    }],
  })
  seeds.projects.add(project.id)
  const activityId = project.activities.get('Dosarul firmei')!
  const [statut, bilant, cazier] = ['Statut', 'Bilanț', 'Cazier fiscal'].map(name => project.requests.get(name)!)

  const teamPage = await as(team.senior)
  const clientPage = await as(team.client)
  const teamTable = new ProjectTablePage(teamPage)
  const clientTable = new ProjectTablePage(clientPage)

  /** Ce vede fiecare rol când deschide proiectul acum. */
  async function labels() {
    await teamTable.goto(project.id)
    await clientTable.goto(project.id)
    return [await teamTable.activityStatus(activityId).innerText(), await clientTable.activityStatus(activityId).innerText()]
  }

  // Trei cereri trimise clientului.
  expect(await labels()).toEqual(['La client', 'De încărcat'])

  // Clientul încarcă una: echipa are de verificat; clientul încă are de încărcat.
  await clientTable.expandActivity(activityId, 'Dosarul firmei')
  await clientUpload(clientPage, statut, 'Statut', 'statut.pdf')
  await expect(clientTable.activityStatus(activityId)).toHaveText('De încărcat')
  expect(await labels()).toEqual(['De verificat', 'De încărcat'])

  // Echipa o respinge: „Document respins” trece înaintea lui „La client”, fără reîncărcare.
  await teamTable.expandActivity(activityId, 'Dosarul firmei')
  await review(teamPage, statut, 'Statut', 'Respinge')
  await expect(teamTable.activityStatus(activityId)).toHaveText('Document respins')
  expect(sql(`select status from document_requirements where id=${q(statut)}`)).toBe('rejected')
  expect(await labels()).toEqual(['Document respins', 'Document respins'])

  // Un document de verificat nu acoperă respingerea.
  await clientTable.expandActivity(activityId, 'Dosarul firmei')
  await clientUpload(clientPage, bilant, 'Bilanț', 'bilant.pdf')
  expect(await labels()).toEqual(['Document respins', 'Document respins'])

  // După termen, „Depășită” le acoperă pe toate (ceasul paginii, nu al serverului).
  for (const account of [team.senior, team.client]) {
    const late = await loginFresh(account)
    await late.clock.setFixedTime(AFTER_DEADLINE)
    const table = new ProjectTablePage(late)
    await table.goto(project.id)
    await expect(table.activityStatus(activityId)).toHaveText('Depășită')
    await late.context().close()
  }

  // Clientul reîncarcă și completează; echipa aprobă tot: „Toate primite”.
  await clientTable.expandActivity(activityId, 'Dosarul firmei')
  await clientUpload(clientPage, statut, 'Statut', 'statut-semnat.pdf')
  await clientUpload(clientPage, cazier, 'Cazier fiscal', 'cazier.pdf')
  await expect(clientTable.activityStatus(activityId)).toHaveText('În verificare')
  await teamTable.goto(project.id)
  await expect(teamTable.activityStatus(activityId)).toHaveText('De verificat')
  await teamTable.expandActivity(activityId, 'Dosarul firmei')
  for (const [id, name] of [[statut, 'Statut'], [bilant, 'Bilanț'], [cazier, 'Cazier fiscal']] as const) {
    await review(teamPage, id, name, 'Aprobă')
  }
  await expect(teamTable.activityStatus(activityId)).toHaveText('Toate primite')
  expect(sql(`select string_agg(status, ',' order by order_index) from document_requirements where activity_id=${q(activityId)}`)).toBe('approved,approved,approved')
  expect(await labels()).toEqual(['Toate primite', 'Toate primite'])

  // Seniorul o finalizează: „Finalizată”, chiar și după termen.
  await teamTable.activityLine(activityId).hover()
  await teamTable.chooseFromMenu('Acțiuni pentru activitatea Dosarul firmei', 'Marchează activitatea ca finalizată')
  await new ConfirmDialog(teamPage, 'Marchezi activitatea „Dosarul firmei” ca finalizată?').confirm('Marchează ca finalizată')
  await expect.poll(() => sql(`select status from project_activities where id=${q(activityId)}`)).toBe('completed')
  const late = await loginFresh(team.senior)
  await late.clock.setFixedTime(AFTER_DEADLINE)
  const table = new ProjectTablePage(late)
  await table.goto(project.id)
  await table.showFinal.check()
  await expect(table.activityStatus(activityId)).toHaveText('Finalizată')
})

test('proiectul așteaptă profilul clientului și arată erorile de profil', async ({ team, as, seeds }) => {
  const project = await seedProject({
    label: 'profil client',
    client: team.client,
    members: [team.senior],
    phases: [{ name: 'Faza', activities: [{ name: 'Activitate', requests: [{ name: 'Document' }] }] }],
  })
  seeds.projects.add(project.id)
  const page = await as(team.client)
  let releaseProfile!: () => void
  const heldProfile = new Promise<void>(resolve => { releaseProfile = resolve })
  await page.route('**/api/me', async route => {
    await heldProfile
    await route.continue()
  })
  const responses = ['', '/phases', '/document-requests'].map(suffix =>
    page.waitForResponse(response => response.url().endsWith(`/api/projects/${project.id}${suffix}`) && response.ok()),
  )
  try {
    await page.goto(`/projects/${project.id}`)
    await Promise.all((await Promise.all(responses)).map(response => response.finished()))
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await expect(page.getByText('Se încarcă proiectul…')).toBeVisible()
    await expect(page.getByRole('button', { name: /^Echipa proiectului/ })).toHaveCount(0)
    await expect(page.getByText('La client', { exact: true })).toHaveCount(0)
  } finally {
    releaseProfile()
  }
  const table = new ProjectTablePage(page)
  await expect(table.activityStatus(project.activities.get('Activitate')!)).toHaveText('De încărcat')
  await expect(page.getByRole('button', { name: /^Echipa proiectului/ })).toHaveCount(0)

  const failed = await as(team.client)
  await failed.route('**/api/me', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }))
  await failed.goto(`/projects/${project.id}`)
  await expect(failed.getByRole('alert').getByText('Nu am putut încărca profilul tău.')).toBeVisible()
  const reload = failed.getByRole('button', { name: 'Reîncarcă pagina' })
  await expect(reload).toBeVisible()
  if (await failed.evaluate(() => matchMedia('(pointer: coarse)').matches)) {
    const bounds = await reload.boundingBox()
    expect(bounds!.height).toBeGreaterThanOrEqual(44)
    expect(bounds!.width).toBeGreaterThanOrEqual(44)
  }
  await expect(failed.getByRole('button', { name: /^Echipa proiectului/ })).toHaveCount(0)
  await failed.unroute('**/api/me')
  await reload.click()
  await expect(new ProjectTablePage(failed).activityStatus(project.activities.get('Activitate')!)).toHaveText('De încărcat')
})
