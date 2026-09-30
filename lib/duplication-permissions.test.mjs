import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'

const nodeRequire = createRequire(import.meta.url)
const typescript = nodeRequire('typescript')

class Query {
  constructor(rows) { this.rows = rows; this.filters = [] }
  select() { return this }
  eq(column, value) { this.filters.push(row => row[column] === value); return this }
  async single() { return this.result(true) }
  async maybeSingle() { return this.result(false) }
  async result(required) {
    const rows = this.rows.filter(row => this.filters.every(filter => filter(row)))
    return { data: required ? rows[0] ?? null : rows[0] ?? null, error: null }
  }
}

async function loadAuth(db) {
  const source = await readFile(new URL('../app/api/_utils/auth.ts', import.meta.url), 'utf8')
  const output = typescript.transpileModule(source, {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2022 },
  }).outputText
  const loadedModule = { exports: {} }
  const service = {
    from(table) {
      const rows = table === 'project_members'
        ? db.memberships
        : table === 'projects'
        ? db.projects
        : db.templates
      return new Query(rows)
    },
  }
  const server = {
    auth: { getUser: async () => ({ data: { user: { id: db.userId } }, error: null }) },
    from: table => new Query(table === 'profiles' ? db.profiles : []),
  }
  const requireLocal = specifier => specifier.endsWith('/supabase') ? {
    createSupabaseServerClient: () => server,
    createSupabaseServiceClient: () => service,
  } : nodeRequire(specifier)
  new Function('require', 'module', 'exports', output)(requireLocal, loadedModule, loadedModule.exports)
  return loadedModule.exports
}

test('auth real permite consultantul membru și respinge ceilalți pentru duplicare', async () => {
  const projectId = '10000000-0000-0000-0000-000000000001'
  const userId = '90000000-0000-0000-0000-000000000001'
  const db = {
    userId,
    profiles: [{ id: userId, role: 'consultant', email: 'consultant@example.test' }],
    memberships: [{ id: 'membership-1', project_id: projectId, consultant_id: userId }],
    projects: [{ id: projectId, client_id: '90000000-0000-0000-0000-000000000002' }],
    templates: [
      { id: 'template-draft', name: 'Draft', status: 'draft', is_active: true },
      { id: 'template-published', name: 'Publicat', status: 'published', is_active: true },
    ],
  }
  const auth = await loadAuth(db)
  const request = new Request('http://localhost/api', { headers: { authorization: 'Bearer test-token' } })

  let result = await auth.requireProjectAccess(request, projectId)
  assert.equal(result.ok, true)
  assert.equal(result.access.role, 'consultant')
  db.memberships.length = 0
  result = await auth.requireProjectAccess(request, projectId)
  assert.deepEqual(result, { ok: false, status: 403, error: 'Forbidden: not a member of this project' })

  const junior = { role: 'consultant', consultant_level: 'junior' }
  assert.equal(auth.canEditTemplate(junior, 'draft'), true)
  assert.equal(auth.canEditTemplate(junior, 'published'), false)
  assert.equal(auth.canEditTemplate({ role: 'admin', consultant_level: 'junior' }, 'published'), true)
  assert.equal(auth.canEditTemplate({ role: 'client', consultant_level: 'junior' }, 'draft'), false)

  db.memberships.push({ id: 'membership-2', project_id: projectId, consultant_id: userId })
  result = await auth.requireTemplateAccess(request, 'template-draft', 'edit')
  assert.equal(result.ok, true)
  result = await auth.requireTemplateAccess(request, 'template-published', 'edit')
  assert.deepEqual(result, { ok: false, status: 403, error: 'Forbidden: template modification denied' })

  db.profiles[0].role = 'admin'
  result = await auth.requireTemplateAccess(request, 'template-published', 'edit')
  assert.equal(result.ok, true)
  db.profiles[0].role = 'client'
  result = await auth.requireTemplateAccess(request, 'template-draft', 'edit')
  assert.deepEqual(result, { ok: false, status: 403, error: 'Forbidden: template modification denied' })
})

test('consultantul senior administrează doar proiectele în care e membru (#104)', async () => {
  const projectId = '10000000-0000-0000-0000-000000000001'
  const userId = '90000000-0000-0000-0000-000000000001'
  const db = {
    userId,
    profiles: [{ id: userId, role: 'consultant', email: 'senior@example.test', consultant_level: 'senior' }],
    memberships: [{ id: 'membership-1', project_id: projectId, consultant_id: userId }],
    projects: [{ id: projectId, client_id: '90000000-0000-0000-0000-000000000002' }],
    templates: [{ id: 'template-published', name: 'Publicat', status: 'published', is_active: true }],
  }
  const auth = await loadAuth(db)
  const request = new Request('http://localhost/api', { headers: { authorization: 'Bearer test-token' } })

  let result = await auth.requireProjectManager(request, projectId)
  assert.equal(result.ok, true)
  assert.equal(result.access.level, 'senior')
  assert.deepEqual(auth.projectPermissions(result.access), {
    edit_project: true,
    reassign_project: false,
    delete_project: false,
    delete_phases: true,
    manage_team: true,
    moderate_chat: true,
  })

  // Pe șabloane: editează publicate, șterge și duplică; nu publică.
  result = await auth.requireTemplateAccess(request, 'template-published', 'edit')
  assert.equal(result.ok, true)
  result = await auth.requireTemplateAccess(request, 'template-published', 'publish')
  assert.equal(result.ok, false)
  assert.equal((await auth.requireTemplateManager(request)).ok, true)

  // Nemembru: 403 ca orice consultant.
  db.memberships.length = 0
  result = await auth.requireProjectManager(request, projectId)
  assert.deepEqual(result, { ok: false, status: 403, error: 'Forbidden: not a member of this project' })

  // Retrogradarea are efect la următoarea cerere.
  db.memberships.push({ id: 'membership-2', project_id: projectId, consultant_id: userId })
  db.profiles[0].consultant_level = 'junior'
  result = await auth.requireProjectManager(request, projectId)
  assert.deepEqual(result, { ok: false, status: 403, error: 'Forbidden: project management denied' })
  result = await auth.requireTemplateAccess(request, 'template-published', 'edit')
  assert.equal(result.ok, false)
  assert.equal((await auth.requireTemplateManager(request)).ok, false)

  // Un nivel rămas pe alt rol decât consultant nu dă nimic.
  db.profiles[0].role = 'client'
  db.profiles[0].consultant_level = 'senior'
  db.projects[0].client_id = userId
  result = await auth.requireProjectManager(request, projectId)
  assert.equal(result.ok, false)
  assert.equal((await auth.requireTemplateManager(request)).ok, false)
})
