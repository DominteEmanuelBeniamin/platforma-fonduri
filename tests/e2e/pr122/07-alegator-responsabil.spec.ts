import { test, expect } from './fixtures'
import { anon, config, emailsSince, q, seedProject, sql, type Account } from './support'
import { ProjectTablePage } from '../pages/ProjectTablePage'
import { AssigneePicker } from '../pages/AssigneePicker'
import type { Team } from './fixtures'

/**
 * Flux 7 — alegătorul de responsabil (`AssigneePicker`): căutare, inițiale,
 * bifă, alegerea vizibilă pe loc și scrisă în bază, tastatura; „Fără
 * responsabil” blocat pe elementele publice (interfață și server); cine are
 * voie să schimbe responsabilul, cu refuzul serverului pentru cine n-are.
 */

function seed(team: Team) {
  return seedProject({
    label: 'responsabil',
    client: team.client,
    members: [team.senior, team.junior],
    phases: [{
      name: 'Echipă',
      activities: [
        { name: 'Ciornă fără om', visibility: 'draft' },
        { name: 'Publicată', assignedTo: team.senior.id, deadline: '2030-05-05T00:00:00.000Z' },
      ],
    }],
  })
}

async function tokenOf(account: Account) {
  const { data, error } = await anon().auth.signInWithPassword({ email: account.email, password: account.password })
  if (error || !data.session) throw new Error('login API eșuat pentru ' + account.email)
  return data.session.access_token
}

async function patch(account: Account, path: string, body: unknown) {
  const res = await fetch(config.baseUrl + path, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + await tokenOf(account), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, json: await res.json().catch(() => ({})) as { error?: string; message?: string } }
}

const assignee = (activityId: string) => sql(`select coalesce(assigned_to::text, '') from project_activities where id=${q(activityId)}`)

test.describe('Flux 7 — alegătorul de responsabil', () => {
  test('juniorul din echipă caută și alege cu Enter; alegerea apare pe loc, e în bază și anunță consultantul', async ({ team, as, seeds }) => {
    const project = await seed(team)
    seeds.projects.add(project.id)
    const draft = project.activities.get('Ciornă fără om')!
    const table = new ProjectTablePage(await as(team.junior))
    await table.goto(project.id)
    const picker = AssigneePicker.inside(table.page, table.activityLine(draft))
    await expect(picker.trigger).toHaveAccessibleName('Atribuie consultant: Neatribuită')

    await picker.open()
    // Echipa (în ordinea în care a intrat în proiect), cu inițiale, apoi „Fără responsabil”, bifat acum.
    const options = await picker.listbox.getByRole('option').evaluateAll(els => els.map(el => el.getAttribute('aria-selected') + ' ' + el.textContent))
    expect(options.slice(0, 2).sort()).toEqual(['false EI' + team.junior.fullName, 'false ES' + team.senior.fullName])
    expect(options[2]).toBe('true Fără responsabil')
    await picker.search.fill('sorin')
    expect(await picker.listbox.getByRole('option').allInnerTexts()).toEqual([`ES\n${team.senior.fullName}`, 'Fără responsabil'])
    const since = Date.now()
    await picker.search.press('Enter')
    await expect(picker.listbox).toHaveCount(0)
    await picker.expectShows(team.senior.fullName)
    await expect(picker.trigger).toBeFocused()
    await expect.poll(() => assignee(draft)).toBe(team.senior.id)
    // Atribuirea anunță consultantul, prin simulatorul Resend.
    await expect.poll(() => emailsSince(since).filter(e => JSON.stringify(e.body?.to).includes(team.senior.email)).length).toBe(1)

    // Bifa stă pe cel ales; Escape închide și întoarce focusul pe buton.
    await picker.trigger.press('Enter')
    await expect(picker.search).toBeFocused()
    await expect(picker.option(team.senior.fullName)).toHaveAttribute('aria-selected', 'true')
    await expect(picker.option(team.senior.fullName).locator('svg')).toHaveCount(1)
    await table.page.keyboard.press('Escape')
    await expect(picker.listbox).toHaveCount(0)
    await expect(picker.trigger).toBeFocused()
  })

  test('de la tastatură: din căutare, ↓ duce la primul om, încă un ↓ la următorul, Enter alege', async ({ team, as, seeds }) => {
    const project = await seed(team)
    seeds.projects.add(project.id)
    const draft = project.activities.get('Ciornă fără om')!
    const table = new ProjectTablePage(await as(team.junior))
    await table.goto(project.id)
    const picker = AssigneePicker.inside(table.page, table.activityLine(draft))
    await picker.trigger.focus()
    await table.page.keyboard.press('Enter')
    await expect(picker.search).toBeFocused()
    // Ordinea e a intrării în echipă; testul o citește de pe ecran.
    const [first, second] = (await picker.optionNames()).slice(0, 2).map(text => text.split('\n').pop()!)
    const idOf = (name: string) => [team.senior, team.junior].find(a => a.fullName === name)!.id
    await table.page.keyboard.press('ArrowDown')
    await expect(picker.option(first), '↓ din căutare trebuie să ducă la primul om din listă').toBeFocused()
    await table.page.keyboard.press('ArrowDown')
    await expect(picker.option(second)).toBeFocused()
    await table.page.keyboard.press('Enter')
    await expect(picker.listbox).toHaveCount(0)
    await picker.expectShows(second)
    await expect.poll(() => assignee(draft)).toBe(idOf(second))

    // Cu o singură potrivire, ↓ trebuie să ajungă la ea, nu la „Fără responsabil”.
    await table.page.keyboard.press('Enter')
    await picker.search.fill('sorin')
    await table.page.keyboard.press('ArrowDown')
    await expect(picker.option(team.senior.fullName)).toBeFocused()
    await table.page.keyboard.press('Enter')
    await picker.expectShows(team.senior.fullName)
    await expect.poll(() => assignee(draft)).toBe(team.senior.id)
  })

  test('pe o activitate publică „Fără responsabil” e blocat, cu motivul; serverul refuză oricum golirea', async ({ team, as, seeds }) => {
    const project = await seed(team)
    seeds.projects.add(project.id)
    const published = project.activities.get('Publicată')!
    const table = new ProjectTablePage(await as(team.senior))
    await table.goto(project.id)
    const patches: string[] = []
    table.page.on('request', r => { if (r.method() === 'PATCH') patches.push(r.url()) })
    const picker = AssigneePicker.inside(table.page, table.activityLine(published))

    await picker.open()
    await expect(picker.empty).toHaveAttribute('aria-disabled', 'true')
    expect(await picker.emptyReason()).toBe('Activitatea e vizibilă clientului: trebuie să aibă un responsabil.')
    // Opțiunea e doar `aria-disabled`, deci un om o poate apăsa: clic real cu mausul.
    const blocked = (await picker.empty.boundingBox())!
    await table.page.mouse.click(blocked.x + blocked.width / 2, blocked.y + blocked.height / 2)
    await expect(picker.listbox).toBeVisible()
    // Cu săgețile, lista sare peste opțiunea blocată.
    await table.page.keyboard.press('End')
    await expect(picker.option(team.junior.fullName)).toBeFocused()
    await table.page.keyboard.press('Escape')
    await picker.expectShows(team.senior.fullName)
    expect(patches).toEqual([])
    expect(assignee(published)).toBe(team.senior.id)

    // Se poate schimba, doar nu goli.
    await picker.open()
    await picker.choose(team.junior.fullName)
    await picker.expectShows(team.junior.fullName)
    await expect.poll(() => assignee(published)).toBe(team.junior.id)

    // Direct prin API: 400, cu mesajul care spune ce se poate face în loc.
    const path = `/api/projects/${project.id}/phases/${project.phases.get('Echipă')}/activities/${published}`
    const cleared = await patch(team.admin, path, { assigned_to: null })
    expect(cleared.status).toBe(400)
    expect(cleared.json.message).toBe('Elementul e vizibil clientului, deci trebuie să aibă un consultant atribuit. Alege alt consultant în loc să-l scoți.')
    expect(assignee(published)).toBe(team.junior.id)
  })

  test('cine poate schimba responsabilul: echipa da; clientul și un consultant din afara echipei, nu', async ({ team, as, seeds }) => {
    const project = await seed(team)
    seeds.projects.add(project.id)
    const draft = project.activities.get('Ciornă fără om')!
    const path = `/api/projects/${project.id}/phases/${project.phases.get('Echipă')}/activities/${draft}`

    // Clientul vede responsabilul, fără alegător.
    const client = new ProjectTablePage(await as(team.client))
    await client.goto(project.id)
    const published = project.activities.get('Publicată')!
    await expect(client.activityLine(published)).toContainText(team.senior.fullName)
    await expect(client.page.getByRole('button', { name: /^Atribuie consultant/ })).toHaveCount(0)

    for (const [who, expected] of [[team.client, 403], [team.outsider, 403]] as const) {
      const res = await patch(who, path, { assigned_to: team.senior.id })
      expect(res.status, `${who.fullName} n-ar trebui să poată atribui`).toBe(expected)
    }
    expect(assignee(draft)).toBe('')

    // Adminul, fără să fie în echipă, poate.
    const admin = new ProjectTablePage(await as(team.admin))
    await admin.goto(project.id)
    const picker = AssigneePicker.inside(admin.page, admin.activityLine(draft))
    await picker.open()
    await picker.choose(team.junior.fullName)
    await expect.poll(() => assignee(draft)).toBe(team.junior.id)
  })

  test('consultantul general: adminul îl alege din „Cereri generale”; seniorul nu are alegător, iar serverul îl refuză', async ({ team, as, seeds }) => {
    const project = await seed(team)
    seeds.projects.add(project.id)
    const general = () => sql(`select coalesce(general_consultant_id::text, '') from projects where id=${q(project.id)}`)

    const admin = new ProjectTablePage(await as(team.admin))
    await admin.goto(project.id)
    const picker = AssigneePicker.inside(admin.page, admin.group('Cereri generale'), 'Atribuie consultant pentru cererile generale')
    await expect(picker.trigger).toHaveAccessibleName('Atribuie consultant pentru cererile generale: Neatribuit')
    await picker.open()
    await picker.choose(team.senior.fullName)
    await picker.expectShows(team.senior.fullName)
    await expect.poll(general).toBe(team.senior.id)

    const senior = new ProjectTablePage(await as(team.senior))
    await senior.goto(project.id)
    await expect(senior.group('Cereri generale')).toContainText(team.senior.fullName)
    await expect(senior.group('Cereri generale').getByRole('button', { name: /^Atribuie consultant pentru cererile generale/ })).toHaveCount(0)
    const res = await patch(team.senior, `/api/projects/${project.id}`, { general_consultant_id: team.junior.id })
    expect(res.status).toBe(403)
    expect(general()).toBe(team.senior.id)
  })
})
