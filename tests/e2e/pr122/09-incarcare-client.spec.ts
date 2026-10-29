import { test, expect } from './fixtures'
import { pdf, q, seedProject, sqlJson, storageText } from './support'
import { ProjectTablePage } from '../pages/ProjectTablePage'
import { ClientUploadDialog } from '../pages/ClientUploadDialog'
import type { Team } from './fixtures'

/**
 * Flux 9 — clientul încarcă documente, câte un dialog pe cerere (S-19, D8).
 * Fișierele ajung la cererea lor (bază + Storage) și când clientul deschide
 * două dialoguri unul după altul; ieșirea cu fișiere alese cere confirmare;
 * merge de la tastatură; clientul vede doar ce e vizibil clientului; echipa vede
 * documentul imediat, „De verificat”.
 */

function seed(team: Team) {
  return seedProject({
    label: 'incarcare',
    client: team.client,
    members: [team.senior],
    phases: [
      {
        name: 'Acte',
        activities: [
          { name: 'Acte firmă', assignedTo: team.senior.id, deadline: '2030-02-02T00:00:00.000Z', requests: [{ name: 'Act A' }, { name: 'Act B' }, { name: 'Notă internă', visibility: 'draft' }] },
          { name: 'Activitate în pregătire', visibility: 'draft', requests: [{ name: 'Cerere din activitate ascunsă' }] },
        ],
      },
      { name: 'Fază în pregătire', visibility: 'draft', activities: [{ name: 'Activitate din fază ascunsă', requests: [{ name: 'Cerere din fază ascunsă' }] }] },
    ],
  })
}

type FileRow = { request: string; name: string; path: string }

function filesOf(requestIds: string[]) {
  return sqlJson<FileRow[]>(`select coalesce(json_agg(json_build_object('request', d.name, 'name', f.original_name, 'path', f.storage_path) order by d.name, f.original_name), '[]')
    from files f join document_requirements d on d.id=f.requirement_id where f.requirement_id in (${requestIds.map(q).join(',')})`)
}

test.describe('Flux 9 — clientul încarcă documente', () => {
  test('două dialoguri unul după altul: fiecare fișier ajunge la cererea lui, în bază și în Storage; echipa îl vede imediat', async ({ team, as, seeds }) => {
    const project = await seed(team)
    seeds.projects.add(project.id)
    const activityId = project.activities.get('Acte firmă')!
    const [actA, actB] = [project.requests.get('Act A')!, project.requests.get('Act B')!]
    const client = new ProjectTablePage(await as(team.client))
    await client.goto(project.id)
    const page = client.page

    // Clientul vede doar ce e publicat, pe tot drumul (fază, activitate, cerere).
    expect(await client.groupTitles()).toEqual(['Acte'])
    await client.expandActivity(activityId, 'Acte firmă')
    await expect(client.activity(activityId)).toContainText('Act A')
    await expect(client.activity(activityId)).toContainText('Act B')
    for (const hidden of ['Notă internă', 'Activitate în pregătire', 'Cerere din activitate ascunsă', 'Fază în pregătire', 'Cerere din fază ascunsă']) {
      await expect(page.getByText(hidden)).toHaveCount(0)
    }

    // A: ales, apoi închis cu X — confirmarea; „Anulează” păstrează lista, „Renunță la ele” o golește.
    const dialogA = new ClientUploadDialog(page, 'Act A')
    await ClientUploadDialog.opener(page, actA).click()
    await dialogA.expectOpen()
    await dialogA.pick(dialogA.choose, [pdf('a-renuntat.pdf')])
    await expect(dialogA.files).toContainText('a-renuntat.pdf')
    await dialogA.close.click()
    const discard = dialogA.discardDialog()
    await discard.expectOpen('Ai ales 1 fișier care nu s-a încărcat. Dacă închizi, selecția se pierde.')
    await discard.cancel()
    await expect(dialogA.files).toContainText('a-renuntat.pdf')
    await dialogA.cancel.click()
    await discard.confirm('Renunță la ele')
    await expect(dialogA.root).toHaveCount(0)

    // B se deschide gol; două fișiere, unul adăugat după primul.
    const dialogB = new ClientUploadDialog(page, 'Act B')
    await ClientUploadDialog.opener(page, actB).click()
    await dialogB.expectOpen()
    await expect(dialogB.files).toHaveCount(0)
    const b1 = pdf('b-1.pdf')
    const b2 = pdf('b-2.pdf')
    await dialogB.pick(dialogB.choose, [b1])
    await dialogB.pick(dialogB.addMore, [b2])
    await expect(dialogB.root).toContainText('2 fișiere selectate')
    await expect(dialogB.upload).toHaveText('Încarcă (2)')
    await dialogB.upload.click()
    await expect(dialogB.root).toHaveCount(0)

    // Apoi A, cu fișierul lui.
    const a = pdf('a.pdf')
    await ClientUploadDialog.opener(page, actA).click()
    await dialogA.expectOpen()
    await expect(dialogA.files).toHaveCount(0)
    await dialogA.pick(dialogA.choose, [a])
    await dialogA.upload.click()
    await expect(dialogA.root).toHaveCount(0)

    // Clientul vede „În verificare”, fără reîncărcare.
    await expect(client.request(actA)).toContainText('În verificare')
    await expect(client.request(actB)).toContainText('În verificare')

    const rows = filesOf([actA, actB])
    expect(rows.map(r => [r.request, r.name])).toEqual([['Act A', 'a.pdf'], ['Act B', 'b-1.pdf'], ['Act B', 'b-2.pdf']])
    for (const row of rows) {
      const expected = { 'a.pdf': a, 'b-1.pdf': b1, 'b-2.pdf': b2 }[row.name]!
      expect(await storageText(row.path), `Storage pentru ${row.name}`).toBe(expected.buffer.toString())
    }
    expect(sqlJson(`select json_agg(status order by name) from document_requirements where id in (${q(actA)}, ${q(actB)})`)).toEqual(['review', 'review'])

    // Echipa: activitatea și cererile „De verificat”; în fișa cererii, fișierul clientului.
    const teamTable = new ProjectTablePage(await as(team.senior))
    await teamTable.goto(project.id)
    await expect(teamTable.activityStatus(activityId)).toHaveText('De verificat')
    await teamTable.expandActivity(activityId, 'Acte firmă')
    await expect(teamTable.request(actA)).toContainText('De verificat')
    await expect(teamTable.request(actB)).toContainText('De verificat')
    await teamTable.request(actA).getByRole('heading', { name: 'Act A' }).click()
    const sheet = teamTable.page.getByRole('dialog').filter({ has: teamTable.page.getByRole('heading', { name: 'Act A' }) })
    await expect(sheet).toContainText('a.pdf')
    await expect(sheet).not.toContainText('b-1.pdf')
  })

  test('de la tastatură: Enter deschide dialogul, alege fișierele și încarcă', async ({ team, as, seeds }) => {
    const project = await seed(team)
    seeds.projects.add(project.id)
    const activityId = project.activities.get('Acte firmă')!
    const actB = project.requests.get('Act B')!
    const client = new ProjectTablePage(await as(team.client))
    await client.goto(project.id)
    const page = client.page
    await client.expandActivity(activityId, 'Acte firmă')

    const opener = ClientUploadDialog.opener(page, actB)
    await opener.focus()
    await page.keyboard.press('Enter')
    const dialog = new ClientUploadDialog(page, 'Act B')
    await dialog.expectOpen()
    await expect(dialog.choose).toBeFocused()
    const file = pdf('tastatura.pdf')
    const chooser = page.waitForEvent('filechooser')
    await page.keyboard.press('Enter')
    await (await chooser).setFiles(file)
    await expect(dialog.files).toContainText('tastatura.pdf')
    // Tab până la „Încarcă (1)”, apoi Enter.
    for (let i = 0; i < 8; i++) {
      if (await dialog.upload.evaluate(el => el === document.activeElement)) break
      await page.keyboard.press('Tab')
    }
    await expect(dialog.upload).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(dialog.root).toHaveCount(0)
    await expect(opener).toHaveCount(0)
    expect(filesOf([actB]).map(r => r.name)).toEqual(['tastatura.pdf'])
  })
})
