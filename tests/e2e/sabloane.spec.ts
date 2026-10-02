import { test, expect, type Page } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { e2eEnv, requireE2EConfig, serviceClient, BUCKET } from './helpers/project-state'

/**
 * Șabloanele: salvarea dintr-o singură cerere, importul în proiect, propagarea
 * și editorul din interfață, peste serverul din mediul E2E dedicat.
 *
 * Timpii nu au praguri fixe în milisecunde: ar pica pe o bază mai îndepărtată
 * și n-ar prinde nimic pe una locală. Se măsoară întâi latența de bază (un GET
 * de șablon: autentificare + patru cereri paralele) și fiecare operație trebuie
 * să rămână sub un multiplu al ei. Când o rută revine la câte o cerere per
 * element, depășește multiplul de 5–20 de ori, oricât de rapidă e baza.
 */
const ENV = e2eEnv()
const CONFIG = requireE2EConfig(ENV)
const ADMIN = {
  email: ENV.E2E_ADMIN_EMAIL || CONFIG.staffEmail,
  password: ENV.E2E_ADMIN_PASSWORD || CONFIG.staffPassword,
}
const STAMP = `${Date.now()}`
const PREFIX = `E2E Șabloane ${STAMP}`

// Șablonul de măsurat: 4 faze × 5 activități × 6 cereri = 144 de elemente.
const P = 4, A = 5, D = 6

// Multiplii latenței de bază, cu rezervă generoasă. Valorile tipice sunt între
// paranteze (Supabase local); varianta veche, element cu element, era de
// ~10× la import și de sute de ori la salvare.
const BUDGET = {
  create: 8, // (~1,7×) creare șablon complet
  save: 5, // (~1,2×) salvare arbore
  importTemplate: 4, // (~1,6×) import în proiect; varianta veche: ~7,7× local, mai mult pe o bază îndepărtată
  preview: 6, // (~1,5×) preview propagare
  applyOne: 12, // (~3×) propagare într-un proiect
}

test.describe.configure({ mode: 'serial' })

const service = serviceClient() as SupabaseClient
const created = { templates: new Set<string>(), projects: new Set<string>(), paths: new Set<string>() }
let token = ''
let clientId = ''
let supervisorId = ''
let statusIds: string[] = []

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

async function api(method: string, path: string, body?: unknown) {
  const started = performance.now()
  const res = await fetch(`${CONFIG.baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await res.json().catch(() => null) as Json | null
  return { status: res.status, json: json ?? {}, ms: performance.now() - started }
}

async function ok(method: string, path: string, body?: unknown) {
  const res = await api(method, path, body)
  expect(res.status, `${method} ${path}: ${JSON.stringify(res.json)}`).toBeLessThan(300)
  return res
}

/** Mediana a `runs` execuții, ca un singur vârf de rețea să nu pice testul. */
async function median(runs: number, fn: (i: number) => Promise<unknown>) {
  const times: number[] = []
  for (let i = 0; i < runs; i++) {
    const started = performance.now()
    await fn(i)
    times.push(performance.now() - started)
  }
  times.sort((a, b) => a - b)
  return times[Math.floor(times.length / 2)]
}

function expectWithin(label: string, ms: number, baseline: number, factor: number) {
  const ratio = ms / baseline
  console.log(`${label.padEnd(44)} ${Math.round(ms).toString().padStart(5)} ms  (${ratio.toFixed(1)}× bază, prag ${factor}×)`)
  expect(ratio, `${label}: ${Math.round(ms)} ms, adică ${ratio.toFixed(1)}× latența de bază`).toBeLessThan(factor)
}

function bigTree(name: string) {
  return {
    name,
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    description: null,
    phases: Array.from({ length: P }, (_, p) => ({
      id: `p${p}`, name: `Faza ${p}`, project_status_id: statusIds[p % statusIds.length],
      activities: Array.from({ length: A }, (_, a) => ({
        id: `p${p}a${a}`, name: `Activitate ${p}.${a}`,
        document_requirements: Array.from({ length: D }, (_, d) => ({
          id: `p${p}a${a}d${d}`, name: `Document ${p}.${a}.${d}`,
          requirement_type: d % 2 ? 'optional' : 'obligatoriu', attachments: [],
        })),
      })),
    })),
  }
}

/** Arborele în forma trimisă de editor, pornind de la răspunsul serverului. */
function editorTree(template: Json) {
  return {
    name: template.name,
    description: template.description,
    phases: template.phases.map((phase: Json) => ({
      id: phase.id, name: phase.name, project_status_id: phase.project_status_id,
      activities: phase.activities.map((activity: Json) => ({
        id: activity.id, name: activity.name, default_consultant_id: activity.default_consultant_id,
        document_requirements: activity.document_requirements.map((doc: Json) => ({
          id: doc.id, name: doc.name, description: doc.description, is_outgoing: doc.is_outgoing,
          requirement_type: doc.requirement_type, attachments: doc.attachments,
        })),
      })),
    })),
  }
}

async function createTemplate(tree: Json) {
  const { json } = await ok('POST', '/api/admin/templates', tree)
  created.templates.add(json.template.id)
  return json.template as Json
}

async function createProject(title: string) {
  const { json } = await ok('POST', '/api/projects', { title, client_id: clientId, supervisor_ids: [supervisorId] })
  created.projects.add(json.project.id)
  return json.project.id as string
}

async function projectCounts(projectId: string) {
  const { data: phases } = await service.from('project_phases').select('id').eq('project_id', projectId)
  const phaseIds = (phases ?? []).map(phase => phase.id)
  const { count: activities } = await service.from('project_activities')
    .select('id', { count: 'exact', head: true }).in('phase_id', phaseIds)
  const { count: docs } = await service.from('document_requirements')
    .select('id', { count: 'exact', head: true }).eq('project_id', projectId).is('deleted_at', null)
  return [phaseIds.length, activities, docs]
}

test.beforeAll(async () => {
  expect(service, 'Clientul service E2E lipsește din configurația dedicată').toBeTruthy()
  const anon = createClient(CONFIG.supabaseUrl, CONFIG.anonKey, { auth: { persistSession: false } })
  const { data, error } = await anon.auth.signInWithPassword(ADMIN)
  if (error || !data.session) throw new Error(`Autentificarea adminului E2E a eșuat: ${error?.message}`)
  token = data.session.access_token

  const { data: client } = await service.from('profiles').select('id').eq('email', CONFIG.clientEmail).single()
  const { data: statuses } = await service.from('project_statuses').select('id').order('id').limit(2)
  if (!client || !statuses?.length) throw new Error('Baza E2E nu are clientul sau statusurile de proiect așteptate')
  clientId = client.id
  statusIds = statuses.map(status => status.id)

  // Un proiect nou cere cel puțin un supervizor senior (npm run seed:local are unul).
  const { data: senior } = await service.from('profiles').select('id')
    .eq('role', 'consultant').eq('consultant_level', 'senior').limit(1).maybeSingle()
  if (!senior) throw new Error('Baza E2E nu are niciun consultant senior; rulează npm run seed:local')
  supervisorId = senior.id
})

test.afterAll(async () => {
  if (!service) return
  // Proiectele legate blochează ștergerea șablonului, deci pleacă primele.
  for (const id of created.projects) await service.from('projects').delete().eq('id', id)
  for (const id of created.templates) await service.from('project_templates').delete().eq('id', id)
  if (created.paths.size > 0) await service.storage.from(BUCKET).remove([...created.paths])
})

test('salvare, import și propagare: corecte și fără cereri element cu element', async () => {
  test.setTimeout(180_000)

  const template = await createTemplate(bigTree(`${PREFIX} API`))
  // Serverul și clientul service trebuie să vadă aceeași bază, altfel testul
  // ar verifica altceva decât ce a scris.
  const { data: seen } = await service.from('project_templates').select('id').eq('id', template.id)
  expect(seen, 'serverul și clientul service nu folosesc aceeași bază').toHaveLength(1)
  expect(template.phases).toHaveLength(P)
  expect(template.phases[0].activities).toHaveLength(A)
  expect(template.phases[0].activities[0].document_requirements).toHaveLength(D)

  const baseline = await median(5, () => ok('GET', `/api/admin/templates/${template.id}`))
  console.log(`\nLatența de bază (GET un șablon): ${Math.round(baseline)} ms\n`)

  expectWithin('creare șablon cu 144 de elemente', await median(3, i =>
    createTemplate(bigTree(`${PREFIX} măsurare ${i}`))), baseline, BUDGET.create)
  expectWithin('salvare fără modificări', await median(5, () =>
    ok('PUT', `/api/admin/templates/${template.id}/tree`, editorTree(template))), baseline, BUDGET.save)
  expectWithin('reordonare a tuturor fazelor', await median(4, i => {
    const tree = editorTree(template)
    if (i % 2 === 0) tree.phases.reverse()
    return ok('PUT', `/api/admin/templates/${template.id}/tree`, tree)
  }), baseline, BUDGET.save)

  // Reordonarea a ajuns în DB (4 rulări: ordinea finală e cea inițială).
  const { data: phaseOrder } = await service.from('template_phases').select('name, order_index')
    .eq('template_id', template.id).order('order_index')
  expect(phaseOrder?.map(phase => phase.name)).toEqual(['Faza 0', 'Faza 1', 'Faza 2', 'Faza 3'])

  // Un atașament real și unul lipsă, ca să treacă și ramura cu avertismente.
  const realPath = `templates/attachments/e2e-${STAMP}.pdf`
  const upload = await service.storage.from(BUCKET)
    .upload(realPath, new Blob(['%PDF-1.4 e2e']), { contentType: 'application/pdf' })
  expect(upload.error).toBeNull()
  created.paths.add(realPath)
  const withFiles = editorTree(template)
  const [docReal, docMissing] = withFiles.phases[0].activities[0].document_requirements
  docReal.attachments = [{ storage_path: realPath, original_name: 'model.pdf', mime_type: 'application/pdf', file_size: 12 }]
  docMissing.attachments = [{ storage_path: `templates/attachments/lipsa-${STAMP}.pdf`, original_name: 'lipsa.pdf' }]
  await ok('PUT', `/api/admin/templates/${template.id}/tree`, withFiles)
  await ok('PATCH', `/api/admin/templates/${template.id}`, { status: 'published' })

  const projects = [await createProject(`${PREFIX} proiect 0`), await createProject(`${PREFIX} proiect 1`), await createProject(`${PREFIX} proiect 2`)]
  const importMs = await median(3, i => ok('POST', `/api/projects/${projects[i]}/import-template`, { template_id: template.id }))
  expectWithin('import șablon în proiect', importMs, baseline, BUDGET.importTemplate)

  // Importul: tot arborele, prima fază pornită, atașamentul real copiat, cel lipsă marcat.
  expect(await projectCounts(projects[0])).toEqual([P, P * A, P * A * D])
  const { data: phases } = await service.from('project_phases').select('status, started_at')
    .eq('project_id', projects[0]).order('order_index')
  expect(phases?.[0]).toMatchObject({ status: 'in_progress' })
  expect(phases?.[0].started_at).toBeTruthy()
  expect(phases?.slice(1).every(phase => phase.status === 'pending')).toBe(true)
  const { data: importedDocs } = await service.from('document_requirements')
    .select('name, attachment_path, attachments:document_requirement_attachments(missing_at)')
    .eq('project_id', projects[0]).in('name', [docReal.name, docMissing.name])
  const byName = Object.fromEntries((importedDocs ?? []).map(doc => [doc.name, doc]))
  expect(byName[docReal.name].attachment_path).toBe(realPath)
  expect(byName[docMissing.name].attachment_path).toBeNull()
  expect(byName[docMissing.name].attachments[0].missing_at).toBeTruthy()

  // Modificări de propagat: o fază nouă (3 × 4), o cerere nouă în fiecare
  // activitate și o activitate redenumită.
  const current = (await ok('GET', `/api/admin/templates/${template.id}`)).json.template
  const changed = editorTree(current)
  changed.phases.forEach((phase: Json, p: number) => phase.activities.forEach((activity: Json, a: number) =>
    activity.document_requirements.push({ id: `nou-${p}-${a}`, name: `Document nou ${p}.${a}`, requirement_type: 'obligatoriu', attachments: [] })))
  changed.phases[1].activities[0].name += ' (redenumită)'
  changed.phases.push({
    id: 'faza-noua', name: 'Fază nouă', project_status_id: statusIds[0],
    activities: Array.from({ length: 3 }, (_, a) => ({
      id: `faza-noua-${a}`, name: `Activitate nouă ${a}`,
      document_requirements: Array.from({ length: 4 }, (_, d) => ({ id: `faza-noua-${a}-${d}`, name: `Cerere nouă ${a}.${d}`, requirement_type: 'optional', attachments: [] })),
    })),
  })
  await ok('PUT', `/api/admin/templates/${template.id}/tree`, changed)

  const previewPath = `/api/admin/templates/${template.id}/propagation/preview`
  let preview: Json = {}
  expectWithin('preview propagare', await median(3, async () => {
    preview = (await ok('POST', previewPath, {})).json
  }), baseline, BUDGET.preview)
  const ours = (preview.eligible as Json[]).filter(project => projects.includes(project.project_id))
  expect(ours).toHaveLength(projects.length)
  // Cererea cu fișier lipsă nu apare „de propagat”: aplicarea o sare oricum.
  expect(ours[0].totals).toEqual({ phases: 1, activities: 3 + 1, document_requests: P * A + 12 })

  const apply = await ok('POST', `/api/admin/templates/${template.id}/propagation/apply`, { project_ids: [projects[0]] })
  expectWithin('propagare într-un proiect', apply.ms, baseline, BUDGET.applyOne)
  const applyRest = await ok('POST', `/api/admin/templates/${template.id}/propagation/apply`, { project_ids: projects.slice(1) })
  for (const result of [...apply.json.results, ...applyRest.json.results]) expect(result.status).toBe('applied')

  for (const projectId of projects) {
    expect(await projectCounts(projectId)).toEqual([P + 1, P * A + 3, P * A * (D + 1) + 12])
  }
  const { data: renamed } = await service.from('project_activities').select('name')
    .eq('source_template_activity_id', current.phases[1].activities[0].id)
  expect(renamed?.map(activity => activity.name)).toEqual(projects.map(() => 'Activitate 1.0 (redenumită)'))

  const after = (await ok('POST', previewPath, {})).json
  const leftover = (after.eligible as Json[]).filter(project => projects.includes(project.project_id)
    && project.totals.phases + project.totals.activities + project.totals.document_requests > 0)
  expect(leftover, 'după propagare nu mai rămâne nimic de propagat').toEqual([])
})

test('salvarea respinge elemente care nu aparțin șablonului', async () => {
  const template = await createTemplate({
    name: `${PREFIX} validare`, slug: `e2e-validare-${STAMP}`,
    phases: [{ id: 'a', name: 'Unu', project_status_id: statusIds[0], activities: [{ id: 'b', name: 'X', document_requirements: [] }] }],
  })
  const foreign = editorTree(template)
  foreign.phases[0].id = '20000000-0000-4000-8000-000000000999'
  const res = await api('PUT', `/api/admin/templates/${template.id}/tree`, foreign)
  expect(res.status).toBe(400)
  expect(res.json.error).toMatch(/nu aparține acestui șablon/)

  const outgoing = editorTree(template)
  outgoing.phases[0].activities[0].document_requirements.push({ id: 'c', name: 'Fără fișier', is_outgoing: true, attachments: [] })
  expect((await api('PUT', `/api/admin/templates/${template.id}/tree`, outgoing)).status).toBe(400)

  // Nimic n-a fost scris.
  const { count } = await service.from('template_document_requirements')
    .select('id', { count: 'exact', head: true }).eq('name', 'Fără fișier')
  expect(count).toBe(0)
})

test('editorul din interfață: o singură cerere per salvare, de la creare la propagare', async ({ page }) => {
  test.setTimeout(180_000)
  const name = `${PREFIX} UI`
  const writes: string[] = []
  const pageErrors: string[] = []
  page.on('request', request => {
    if (request.url().includes('/api/') && request.method() !== 'GET') {
      writes.push(`${request.method()} ${new URL(request.url()).pathname}`)
    }
  })
  page.on('pageerror', error => pageErrors.push(error.message))

  await login(page)
  await page.goto('/admin/templates', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: 'Șablon nou' })).toBeVisible({ timeout: 30_000 })

  // Creare: 2 faze, câte o activitate cu două cereri, și o activitate duplicată.
  await page.getByRole('button', { name: 'Șablon nou' }).click()
  await page.getByPlaceholder('Ex: Proiect Standard').fill(name)
  for (let p = 0; p < 2; p++) {
    await page.getByRole('button', { name: 'Adaugă fază nouă' }).click()
    await page.getByLabel(`Nume pentru faza ${p + 1}`).fill(`Faza UI ${p + 1}`)
    await page.getByRole('button', { name: 'Adaugă activitate' }).nth(p).click()
    await page.getByLabel(`Nume pentru activitatea 1 din faza Faza UI ${p + 1}`).fill(`Activitate UI ${p + 1}`)
    for (let d = 0; d < 2; d++) await addDoc(page, p, `Cerere UI ${p + 1}.${d + 1}`)
  }
  await page.getByRole('button', { name: 'Duplică activitatea Activitate UI 1' }).click()

  writes.length = 0
  await save(page, name)
  expect(writes).toEqual(['POST /api/admin/templates'])
  const { data: row } = await service.from('project_templates').select('id').eq('name', name).single()
  created.templates.add(row!.id)
  const templateId = row!.id as string
  let tree = await templateTree(templateId)
  expect(tree.map(phase => phase.name)).toEqual(['Faza UI 1', 'Faza UI 2'])
  expect(tree[0].activities.map(activity => activity.docs)).toEqual([
    ['Cerere UI 1.1', 'Cerere UI 1.2'],
    ['Cerere UI 1.1', 'Cerere UI 1.2'],
  ])
  const copyName = tree[0].activities[1].name
  const { data: duplicationLog } = await service.from('audit_logs').select('action_type, new_values')
    .eq('entity_type', 'template_activity').eq('entity_name', copyName).eq('new_values->>template_name', name).single()
  expect(duplicationLog?.action_type).toBe('create')
  expect(duplicationLog?.new_values.duplication.source_kind).toBe('persistent')

  // Editare: redenumire cerere, mutare fază, ștergere activitate.
  await page.getByRole('button', { name: `Editează șablonul ${name}` }).click()
  await page.getByRole('button', { name: 'Modifică cererea Cerere UI 2.1' }).click()
  await page.getByPlaceholder('Ex: Certificat constatator').fill('Cerere UI 2.1 redenumită')
  await page.getByRole('button', { name: 'Salvează', exact: true }).click()
  await expect(page.getByPlaceholder('Ex: Certificat constatator')).toHaveCount(0)
  await page.getByRole('button', { name: 'Mută faza Faza UI 2 mai sus' }).click()
  await expect(page.getByLabel('Nume pentru faza 1')).toHaveValue('Faza UI 2')
  await page.getByRole('button', { name: `Șterge activitatea ${copyName}` }).click()
  await confirmDialog(page, /^Șterge/)

  writes.length = 0
  await save(page, name)
  expect(writes).toEqual([`PUT /api/admin/templates/${templateId}/tree`])
  tree = await templateTree(templateId)
  expect(tree.map(phase => phase.name)).toEqual(['Faza UI 2', 'Faza UI 1'])
  expect(tree[0].activities[0].docs).toEqual(['Cerere UI 2.1 redenumită', 'Cerere UI 2.2'])
  expect(tree[1].activities).toHaveLength(1)

  // Publicare, apoi un proiect importat din șablon.
  await page.getByRole('button', { name: `Publică șablonul ${name}` }).click()
  await confirmDialog(page, /^Aprobă/)
  await expect(page.getByRole('button', { name: `Publică șablonul ${name}` })).toHaveCount(0, { timeout: 15_000 })
  const projectId = await createProject(`${PREFIX} proiect UI`)
  await ok('POST', `/api/projects/${projectId}/import-template`, { template_id: templateId })

  // O cerere nouă într-un șablon publicat deschide propagarea după salvare.
  await page.getByRole('button', { name: `Editează șablonul ${name}` }).click()
  await addDoc(page, 0, 'Cerere adăugată după publicare')
  writes.length = 0
  const propagate = page.getByRole('button', { name: /^Propagă în \d+ proiect/ })
  await page.getByRole('button', { name: 'Salvează modificările' }).click()
  await expect(propagate).toBeVisible({ timeout: 30_000 })
  expect(writes).toEqual([
    `PUT /api/admin/templates/${templateId}/tree`,
    `POST /api/admin/templates/${templateId}/propagation/preview`,
  ])
  const applied = page.waitForResponse(response => response.url().endsWith('/propagation/apply'))
  await propagate.click()
  expect((await applied).ok()).toBe(true)
  await expect(page.getByText('Modificările template-ului au fost propagate.')).toBeVisible({ timeout: 30_000 })
  const { count } = await service.from('document_requirements').select('id', { count: 'exact', head: true })
    .eq('project_id', projectId).eq('name', 'Cerere adăugată după publicare')
  expect(count).toBe(1)

  // Ștergere: proiectul legat o blochează, deci pleacă întâi.
  await service.from('projects').delete().eq('id', projectId)
  created.projects.delete(projectId)
  await page.getByRole('button', { name: `Șterge șablonul ${name}` }).click()
  await confirmDialog(page, /^Șterge/)
  await expect(page.getByRole('button', { name: `Editează șablonul ${name}` })).toHaveCount(0, { timeout: 15_000 })
  const { data: gone } = await service.from('project_templates').select('id').eq('id', templateId)
  expect(gone).toHaveLength(0)

  expect(pageErrors).toEqual([])
})

async function login(page: Page) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.locator('input[type=email]').fill(ADMIN.email)
  await page.locator('input[type=password]').fill(ADMIN.password)
  await page.getByRole('button', { name: 'Intră în cont' }).click()
  await page.waitForURL('/', { timeout: 25_000 })
}

async function addDoc(page: Page, phaseIndex: number, docName: string) {
  await page.getByRole('button', { name: 'Adaugă cerere document' }).nth(phaseIndex).click()
  await page.getByPlaceholder('Ex: Certificat constatator').fill(docName)
  await page.getByRole('button', { name: 'Adaugă', exact: true }).click()
  await expect(page.getByPlaceholder('Ex: Certificat constatator')).toHaveCount(0)
}

/** Salvează și așteaptă răspunsul serverului și închiderea formularului. */
async function save(page: Page, templateName: string) {
  const response = page.waitForResponse(res =>
    /\/api\/admin\/templates(\/[^/]+\/tree)?$/.test(new URL(res.url()).pathname)
    && ['POST', 'PUT'].includes(res.request().method()))
  await page.getByRole('button', { name: /^(Salvează modificările|Creează template)$/ }).click()
  expect((await response).ok()).toBe(true)
  await expect(page.getByRole('heading', { name: /^(Editează șablonul|Șablon nou)$/ })).toHaveCount(0, { timeout: 30_000 })
  await expect(page.getByRole('button', { name: `Editează șablonul ${templateName}` })).toBeVisible()
}

/** Dialogurile de confirmare cer tastarea cuvântului afișat ca placeholder. */
async function confirmDialog(page: Page, button: RegExp) {
  const dialog = page.getByRole('dialog')
  const input = dialog.locator('input')
  await input.fill(await input.getAttribute('placeholder') ?? '')
  await dialog.getByRole('button', { name: button }).last().click()
}

async function templateTree(templateId: string) {
  const { data } = await service.from('template_phases')
    .select('name, order_index, activities:template_activities(name, order_index, is_active, docs:template_document_requirements(name, order_index, is_active))')
    .eq('template_id', templateId).eq('is_active', true).order('order_index')
  type Row = { name: string; order_index: number; is_active: boolean }
  const active = <T extends Row>(rows: T[]) => rows.filter(row => row.is_active).sort((a, b) => a.order_index - b.order_index)
  return (data ?? []).map(phase => ({
    name: phase.name,
    activities: active(phase.activities as (Row & { docs: Row[] })[]).map(activity => ({
      name: activity.name,
      docs: active(activity.docs).map(doc => doc.name),
    })),
  }))
}
