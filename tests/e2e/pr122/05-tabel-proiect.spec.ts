import { test, expect } from './fixtures'
import { q, seedProject, sql, sqlJson, type SeededProject } from './support'
import { ProjectTablePage } from '../pages/ProjectTablePage'
import type { Team } from './fixtures'
import type { Locator } from '@playwright/test'

/**
 * Flux 5 — pagina proiectului ca tabel, văzută de echipă: grupurile, ordinea
 * coloanelor, sumarul „Total” cu numerele reale, „Restrânge toate grupurile”,
 * faza aleasă (din panou, căutare, „Ce ai de făcut”, link), comutatorul
 * „Arată și ce e finalizat”, redenumirea care se închide la clic în afară,
 * panoul care se strânge (și tabelul care își schimbă forma după container),
 * documentele trimise separate de „Cereri generale”.
 */

const FAR = '2030-03-10T00:00:00.000Z'
const FARTHER = '2030-03-20T00:00:00.000Z'

function seed(team: Team) {
  return seedProject({
    label: 'tabel',
    client: team.client,
    members: [team.senior, team.junior],
    generalConsultant: team.senior,
    phases: [
      {
        name: 'Proiectare',
        activities: [
          { name: 'Studiu', assignedTo: team.junior.id, deadline: FAR, requests: [{ name: 'Plan de afaceri', status: 'approved' }, { name: 'Extras CF' }, { name: 'Aviz vechi', status: 'closed' }] },
          { name: 'Buget', assignedTo: team.senior.id, deadline: FARTHER, requests: [{ name: 'Deviz', status: 'review' }] },
          { name: 'Avize', assignedTo: team.senior.id, status: 'completed', requests: [{ name: 'Aviz mediu' }] },
        ],
      },
      {
        name: 'Execuție',
        activities: [
          { name: 'Lucrări', assignedTo: team.senior.id, deadline: FAR, requests: [{ name: 'Proces-verbal' }] },
          { name: 'Recepție', assignedTo: team.senior.id, status: 'completed', requests: [{ name: 'PV recepție', status: 'approved' }] },
        ],
      },
    ],
    general: [{ name: 'Act constitutiv' }, { name: 'Ghid pentru client', outgoing: true }],
  })
}

function centerX(box: { x: number; width: number }) { return box.x + box.width / 2 }

async function openTable(as: (a: Team['senior']) => Promise<import('@playwright/test').Page>, team: Team, project: SeededProject) {
  const table = new ProjectTablePage(await as(team.senior))
  await table.goto(project.id)
  return table
}

test.describe('Flux 5 — pagina proiectului ca tabel, ca echipă', () => {
  test('un grup pe fază, coloanele în ordine (și la cereri), sumarul „Total” cu numerele din bază', async ({ team, as, seeds }) => {
    const project = await seed(team)
    seeds.projects.add(project.id)
    const table = await openTable(as, team, project)

    expect(await table.groupTitles()).toEqual(['Proiectare', 'Execuție', 'Documente trimise clientului', 'Cereri generale'])
    const group = table.group('Proiectare')
    expect(await table.headerLabels(group)).toEqual(['Activitate', 'Responsabil', 'Status', 'Documente', 'Termen', 'Vizibil clientului', ''])

    // Celulele rândului stau sub coloanele lor.
    const header = group.locator('div[aria-hidden="true"]').filter({ hasText: 'Responsabil' }).first()
    const studiu = project.activities.get('Studiu')!
    const line = table.activityLine(studiu)
    const columns: [string, Locator][] = [
      ['Responsabil', line.getByRole('button', { name: /^Atribuie consultant: / })],
      ['Status', table.activityStatus(studiu)],
      ['Documente', line.getByText('2/3')],
      ['Termen', line.getByRole('button', { name: /^Schimbă termenul pentru Studiu/ })],
      ['Vizibil clientului', line.locator('[data-tooltip^="Vizibil clientului"]')],
    ]
    for (const [label, cell] of columns) {
      const column = (await header.getByText(label, { exact: true }).boundingBox())!
      const box = (await cell.boundingBox())!
      expect(Math.abs(centerX(box) - centerX(column)), `celula „${label}” nu stă sub coloana ei`).toBeLessThan(column.width / 2)
    }

    // Un singur antet: cererile de sub activitate n-au antet propriu, iar
    // celulele lor stau sub aceleași coloane ca ale activității.
    await table.expandActivity(studiu, 'Studiu')
    await expect(table.activity(studiu).locator('div[aria-hidden="true"]').filter({ hasText: 'Cerere' })).toHaveCount(0)
    const request = table.request(project.requests.get('Extras CF')!)
    const requestColumns: [string, Locator][] = [
      ['Status', request.getByText('Așteaptă răspuns', { exact: true })],
      ['Documente', request.locator('span.tabular-nums').filter({ hasText: /fișier/ })],
      ['Termen', request.getByRole('button', { name: /^Adaugă termen pentru Extras CF/ })],
      ['Vizibil clientului', request.locator('[data-tooltip^="Vizibil clientului"]')],
    ]
    for (const [label, cell] of requestColumns) {
      const column = (await header.getByText(label, { exact: true }).boundingBox())!
      const box = (await cell.boundingBox())!
      expect(Math.abs(centerX(box) - centerX(column)), `la cerere, „${label}” nu stă sub coloana activității`).toBeLessThan(column.width / 2)
    }
    // „Cereri generale” n-are rând de activitate deasupra, deci își păstrează antetul.
    const general = table.group('Cereri generale')
    expect(await table.requestHeaderLabels(general)).toEqual(['Cerere', 'Status', 'Documente', 'Termen', 'Vizibil clientului', ''])

    // Sumarul: „Total”, bateria pe stări, cererile gata din total, intervalul termenelor deschise.
    const counts = sqlJson<{ done: number; total: number }>(`select json_build_object('done', count(*) filter (where d.status in ('approved','closed')), 'total', count(*))
      from document_requirements d join project_activities a on a.id=d.activity_id where a.phase_id=${q(project.phases.get('Proiectare')!)} and not d.is_outgoing and d.deleted_at is null`)
    expect(counts).toEqual({ done: 2, total: 5 })
    const summary = table.summary(group)
    await expect(table.summaryLabel(group)).toBeVisible()
    await expect(summary.getByText(`${counts.done} din ${counts.total} cereri finalizate`)).toBeAttached()
    await expect(summary.getByRole('img')).toHaveAccessibleName('Activitățile pe stări: 1 finalizată, 1 de verificat, 1 la client')
    await expect(summary).toContainText('10 – 20 mar 2030')
  })

  test('„Restrânge toate grupurile” lasă titlurile, sumarele și antetul; „Extinde” le aduce înapoi', async ({ team, as, seeds }) => {
    const project = await seed(team)
    seeds.projects.add(project.id)
    const table = await openTable(as, team, project)
    const studiu = table.activity(project.activities.get('Studiu')!)
    await expect(studiu).toBeVisible()

    await table.collapseAll.click()
    await expect(table.expandAll).toBeVisible()
    await expect(studiu).toHaveCount(0)
    await expect(table.activity(project.activities.get('Lucrări')!)).toHaveCount(0)
    for (const phase of ['Proiectare', 'Execuție']) {
      const group = table.group(phase)
      await expect(group.getByRole('heading', { level: 2, name: phase })).toBeVisible()
      await expect(table.summaryLabel(group)).toBeVisible()
      expect(await table.headerLabels(group), `antetul coloanelor lipsește din „${phase}” strâns`).toEqual(['Activitate', 'Responsabil', 'Status', 'Documente', 'Termen', 'Vizibil clientului', ''])
    }
    await table.expandAll.click()
    await expect(studiu).toBeVisible()
  })

  test('faza aleasă din panou, căutare, „Ce ai de făcut” sau link arată doar faza; „Arată toate fazele” revine', async ({ team, as, seeds }) => {
    const project = await seed(team)
    seeds.projects.add(project.id)
    const table = await openTable(as, team, project)
    const all = ['Proiectare', 'Execuție', 'Documente trimise clientului', 'Cereri generale']

    // Din panoul fazelor.
    await table.sidebarPhase('Execuție').click()
    await expect.poll(() => table.groupTitles()).toEqual(['Execuție'])
    await table.showAll.click()
    await expect.poll(() => table.groupTitles()).toEqual(all)

    // Din căutare (tasta /).
    await table.page.keyboard.press('/')
    const search = table.page.getByRole('dialog')
    await search.getByRole('textbox').fill('Proiectare')
    await search.getByRole('button').filter({ hasText: 'Proiectare' }).first().click()
    await expect.poll(() => table.groupTitles()).toEqual(['Proiectare'])
    await table.showAll.click()
    await expect.poll(() => table.groupTitles()).toEqual(all)

    // Din „Ce ai de făcut”: documentul de verificat din „Buget”.
    await table.viewSwitch.getByRole('button', { name: /^Ce ai de făcut/ }).click()
    await table.page.getByRole('button', { name: /Deviz/ }).first().click()
    await expect.poll(() => table.groupTitles()).toEqual(['Proiectare'])
    await expect(table.request(project.requests.get('Deviz')!)).toBeVisible()
    await table.page.keyboard.press('Escape')
    await table.showAll.click()
    await expect.poll(() => table.groupTitles()).toEqual(all)

    // Dintr-un link.
    await table.goto(project.id, `?phase=${project.phases.get('Execuție')}`)
    await expect.poll(() => table.groupTitles()).toEqual(['Execuție'])
    await table.showAll.click()
    await expect.poll(() => table.groupTitles()).toEqual(all)
  })

  test('„Arată și ce e finalizat” rămâne pe ecran la fiecare clic și arată sau ascunde ce e gata', async ({ team, as, seeds }) => {
    const project = await seed(team)
    seeds.projects.add(project.id)
    const table = await openTable(as, team, project)
    const receptie = table.activity(project.activities.get('Recepție')!)
    // Ascunse implicit și numărate lângă comutator: „Recepție” (gata cu tot ce
    // are) și cererile încheiate din activitățile la vedere: „Plan de afaceri”, „Aviz vechi”.
    await expect(receptie).toHaveCount(0)
    await expect(table.showFinal).not.toBeChecked()
    await expect(table.showFinal.locator('xpath=..')).toHaveText('Arată și ce e finalizat(3)')

    await table.showFinal.click()
    await expect(table.showFinal).toBeVisible()
    await expect(table.showFinal).toBeChecked()
    await expect(receptie).toBeVisible()
    await table.showFinal.click()
    await expect(table.showFinal).toBeVisible()
    await expect(table.showFinal).not.toBeChecked()
    await expect(receptie).toHaveCount(0)
    // „Avize” e finalizată, dar are o cerere deschisă: rămâne la vedere oricum.
    await expect(table.activity(project.activities.get('Avize')!)).toBeVisible()
  })

  test('S-13: cu nimic de ascuns (finalizatul are cereri deschise), comutatorul tot apare și nu dispare la propriul clic', async ({ team, as, seeds }) => {
    const project = await seedProject({
      label: 'finalizat zero',
      client: team.client,
      members: [team.senior],
      phases: [{ name: 'Acte', activities: [{ name: 'Gata, cu cereri deschise', assignedTo: team.senior.id, status: 'completed', requests: [{ name: 'Încă așteptată' }] }] }],
    })
    seeds.projects.add(project.id)
    const table = await openTable(as, team, project)
    const activity = table.activity(project.activities.get('Gata, cu cereri deschise')!)
    await expect(table.showFinal).toBeVisible()
    await expect(table.showFinal.locator('xpath=..')).toHaveText('Arată și ce e finalizat')
    await expect(table.showFinal.locator('xpath=..')).toHaveAttribute('data-tooltip', 'Nimic ascuns acum: elementele finalizate mai au cereri deschise, deci rămân la vedere.')
    for (const checked of [true, false, true]) {
      await table.showFinal.click()
      await expect(table.showFinal, 'comutatorul a dispărut la propriul clic').toBeVisible()
      await expect(table.showFinal).toBeChecked({ checked })
      await expect(activity).toBeVisible()
    }
  })

  test('redenumirea din tabel se închide la clic în afară: salvează un nume schimbat, nu atinge unul neschimbat', async ({ team, as, seeds }) => {
    const project = await seed(team)
    seeds.projects.add(project.id)
    const table = await openTable(as, team, project)
    const patches: string[] = []
    table.page.on('request', r => { if (r.method() === 'PATCH') patches.push(new URL(r.url()).pathname) })
    const studiu = project.activities.get('Studiu')!
    const input = table.page.getByPlaceholder('Nume activitate...')

    await table.activityLine(studiu).hover()
    await table.chooseFromMenu('Acțiuni pentru activitatea Studiu', 'Redenumește')
    await expect(input).toHaveValue('Studiu')
    await input.fill('Studiu de fezabilitate')
    await table.group('Execuție').getByRole('heading', { level: 2 }).click()
    await expect(input).toHaveCount(0)
    await expect(table.activityLine(studiu)).toContainText('Studiu de fezabilitate')
    await expect.poll(() => sql(`select name from project_activities where id=${q(studiu)}`)).toBe('Studiu de fezabilitate')

    // Neschimbat: se închide fără nicio scriere. Escape renunță la ce s-a tastat.
    patches.length = 0
    await table.group('Execuție').hover()
    await table.chooseFromMenu('Acțiuni pentru faza Execuție', 'Redenumește')
    const phaseInput = table.page.getByPlaceholder('Nume fază...')
    await expect(phaseInput).toHaveValue('Execuție')
    await table.group('Proiectare').getByRole('heading', { level: 2 }).click()
    await expect(phaseInput).toHaveCount(0)
    await table.chooseFromMenu('Acțiuni pentru faza Execuție', 'Redenumește')
    await phaseInput.fill('Execuție greșită')
    await phaseInput.press('Escape')
    await expect(phaseInput).toHaveCount(0)
    await expect(table.group('Execuție')).toBeVisible()
    expect(patches).toEqual([])
    expect(sql(`select name from project_phases where id=${q(project.phases.get('Execuție')!)}`)).toBe('Execuție')
  })

  test('panoul fazelor se strânge și se redeschide; tabelul își alege forma după container, nu după ecran', async ({ team, as, seeds }) => {
    const project = await seed(team)
    seeds.projects.add(project.id)
    // 1024px: cu panoul deschis containerul are sub 50rem (fișe), cu panoul strâns, peste (coloane).
    const table = new ProjectTablePage(await as(team.senior, { viewport: { width: 1024, height: 800 } }))
    await table.goto(project.id)
    const header = table.group('Proiectare').locator('div[aria-hidden="true"]').filter({ hasText: 'Responsabil' }).first()
    const studiu = table.activityLine(project.activities.get('Studiu')!)
    await expect(table.sidebar).toBeVisible()
    expect((await table.tableContainer.boundingBox())!.width).toBeLessThan(800)
    await expect(header).toBeHidden()
    const nameBox = (await studiu.getByText('Studiu', { exact: true }).boundingBox())!
    const statusBox = (await table.activityStatus(project.activities.get('Studiu')!).boundingBox())!
    expect(statusBox.y, 'pe fișă, starea stă sub nume').toBeGreaterThan(nameBox.y + nameBox.height - 1)

    await table.collapseSidebar.click()
    await expect(table.sidebar).toBeHidden()
    await expect(table.openSidebar).toBeVisible()
    expect((await table.tableContainer.boundingBox())!.width).toBeGreaterThanOrEqual(800)
    await expect(header).toBeVisible()
    const nameWide = (await studiu.getByText('Studiu', { exact: true }).boundingBox())!
    const statusWide = (await table.activityStatus(project.activities.get('Studiu')!).boundingBox())!
    expect(Math.abs(centerY(statusWide) - centerY(nameWide)), 'pe coloane, starea stă pe rândul numelui').toBeLessThan(nameWide.height)

    await table.openSidebar.click()
    await expect(table.sidebar).toBeVisible()
    await expect(header).toBeHidden()
  })

  test('documentele trimise clientului sunt un grup separat de „Cereri generale” (și pentru client)', async ({ team, as, seeds }) => {
    const project = await seed(team)
    seeds.projects.add(project.id)
    const table = await openTable(as, team, project)
    const sent = table.group('Documente trimise clientului')
    const general = table.group('Cereri generale')
    await expect(sent).toContainText('Ghid pentru client')
    await expect(sent).not.toContainText('Act constitutiv')
    await expect(general).toContainText('Act constitutiv')
    await expect(general).not.toContainText('Ghid pentru client')

    const client = new ProjectTablePage(await as(team.client))
    await client.goto(project.id)
    await expect(client.group('Documente de la consultant')).toContainText('Ghid pentru client')
    await expect(client.group('Cereri generale')).toContainText('Act constitutiv')
    await expect(client.group('Cereri generale')).not.toContainText('Ghid pentru client')
    await expect(client.group('Documente trimise clientului')).toHaveCount(0)
  })
})

function centerY(box: { y: number; height: number }) { return box.y + box.height / 2 }
