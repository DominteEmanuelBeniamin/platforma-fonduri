import assert from 'node:assert/strict'
import test from 'node:test'

import {
  cleanupCreated,
  createCreatedRegistry,
  createTemporaryProject,
  destroyTemporaryProject,
  protectSourceStoragePath,
  registerCreatedActivity,
  registerCreatedPhase,
  registerCreatedRequest,
  registerCreatedStoragePath,
  requireE2EConfig,
  withCreatedRegistry,
} from '../tests/e2e/helpers/project-state.ts'

const validE2EEnv = {
  E2E_BASE_URL: 'http://127.0.0.1:3100',
  E2E_STAFF_EMAIL: 'staff@test.invalid',
  E2E_STAFF_PASSWORD: 'not-a-secret',
  E2E_CLIENT_EMAIL: 'client@test.invalid',
  E2E_CLIENT_PASSWORD: 'not-a-secret',
  E2E_SUPABASE_URL: 'https://test.supabase.invalid',
  E2E_SUPABASE_ANON_KEY: 'anon-test-key',
  E2E_SUPABASE_SERVICE_ROLE_KEY: 'service-test-key',
}

test('configurația E2E cere scrieri și proiect efemer, fără ID persistent', () => {
  assert.throws(
    () => requireE2EConfig({ ...validE2EEnv, E2E_WRITES: '0', E2E_TEST_PROJECT: '1' }),
    /E2E_WRITES=1/,
  )
  assert.throws(
    () => requireE2EConfig({ ...validE2EEnv, E2E_WRITES: '1' }),
    /E2E_TEST_PROJECT=1/,
  )
  assert.equal(
    requireE2EConfig({ ...validE2EEnv, E2E_WRITES: '1', E2E_TEST_PROJECT: '1' }).baseUrl,
    'http://127.0.0.1:3100',
  )
})

function fakeAdmin({ failReads = [] } = {}) {
  const state = {
    project_phases: [
      { id: 'phase-source', project_id: 'project-1' },
      { id: 'phase-copy', project_id: 'project-1' },
      { id: 'phase-foreign', project_id: 'project-1' },
    ],
    project_activities: [
      { id: 'activity-source', phase_id: 'phase-source' },
      { id: 'activity-foreign-under-source', phase_id: 'phase-source' },
      { id: 'activity-copy', phase_id: 'phase-copy' },
      { id: 'activity-foreign', phase_id: 'phase-foreign' },
    ],
    document_requirements: [
      { id: 'request-source', activity_id: 'activity-source', project_id: 'project-1', attachment_path: 'source-model', attachment_missing_at: null },
      { id: 'request-foreign-under-source', activity_id: 'activity-foreign-under-source', project_id: 'project-1', attachment_path: 'foreign-under-source-model', attachment_missing_at: null },
      { id: 'request-copy', activity_id: 'activity-copy', project_id: 'project-1', attachment_path: 'copy-model', attachment_missing_at: null },
      { id: 'request-copy-missing', activity_id: 'activity-copy', project_id: 'project-1', attachment_path: 'source-model', attachment_missing_at: '2026-09-03T00:00:00.000Z' },
      { id: 'request-foreign', activity_id: 'activity-foreign', project_id: 'project-1', attachment_path: 'foreign-model', attachment_missing_at: null },
    ],
    document_requirement_attachments: [
      { storage_path: 'source-model', document_requirement_id: 'request-source', missing_at: null },
      { storage_path: 'foreign-under-source-model', document_requirement_id: 'request-foreign-under-source', missing_at: null },
      { storage_path: 'copy-model', document_requirement_id: 'request-copy', missing_at: null },
      { storage_path: 'source-model', document_requirement_id: 'request-copy-missing', missing_at: '2026-09-03T00:00:00.000Z' },
      { storage_path: 'foreign-model', document_requirement_id: 'request-foreign', missing_at: null },
    ],
    files: [
      { storage_path: 'foreign-under-source-client', requirement_id: 'request-foreign-under-source' },
      { storage_path: 'foreign-client', requirement_id: 'request-foreign' },
    ],
    projects: [{ id: 'project-1' }],
    project_members: [],
  }
  const calls = []
  const failures = new Set(failReads)
  const storageObjects = new Set([
    'source-model',
    'foreign-under-source-model',
    'copy-model',
    'foreign-model',
    'foreign-client',
    'foreign-under-source-client',
  ])

  function builder(table) {
    let operation = 'read'
    const filters = []
    const chain = {
      select() { operation = 'read'; return chain },
      delete() { operation = 'delete'; return chain },
      eq(field, value) { filters.push(row => row[field] === value); return chain },
      in(field, values) { filters.push(row => values.includes(row[field])); return chain },
      is(field, value) { filters.push(row => value === null ? row[field] == null : row[field] === value); return chain },
      order() { return chain },
      then(resolve, reject) {
        Promise.resolve().then(() => {
          calls.push({ table, operation })
          if (failures.has(table)) return { data: null, error: { message: `select ${table} failed` } }
          const rows = state[table].filter(row => filters.every(filter => filter(row)))
          if (operation === 'delete') {
            if (table === 'project_phases' && rows.some(phase =>
              state.project_activities.some(activity => activity.phase_id === phase.id))) {
              return { data: null, error: { message: 'phase has child activities' } }
            }
            state[table] = state[table].filter(row => !filters.every(filter => filter(row)))
            return { data: null, error: null }
          }
          return { data: rows, error: null }
        }).then(resolve, reject)
      },
    }
    return chain
  }

  return {
    state,
    storageObjects,
    calls,
    from: table => builder(table),
    storage: {
      from: () => ({
        remove: async paths => {
          calls.push({ table: 'storage', operation: 'remove', paths })
          if (failures.has('storage')) return { data: null, error: { message: 'storage failed' } }
          for (const path of paths) storageObjects.delete(path)
          return { data: paths.map(path => ({ name: path })), error: null }
        },
      }),
    },
  }
}

function fixturePayloadAdmin() {
  const state = {
    profiles: [
      { id: 'client-id', email: 'client@test.invalid', role: 'client' },
      { id: 'staff-id', email: 'staff@test.invalid', role: 'admin' },
    ],
    projects: [],
    project_members: [],
    project_phases: [],
    project_activities: [],
    document_requirements: [],
    document_requirement_attachments: [],
    files: [],
  }
  const knownColumns = {
    profiles: ['id', 'email', 'role'],
    projects: ['id', 'title', 'client_id', 'status'],
    project_members: ['project_id', 'consultant_id', 'role_in_project'],
    project_phases: ['id', 'project_id', 'name', 'slug', 'order_index', 'status', 'visibility'],
    project_activities: ['id', 'phase_id', 'name', 'order_index', 'status', 'visibility', 'assigned_to', 'assigned_by', 'deadline_at'],
    document_requirements: ['id', 'project_id', 'activity_id', 'name', 'order_index', 'requirement_type', 'is_mandatory', 'is_outgoing', 'deadline_at', 'status', 'visibility', 'is_locked'],
    document_requirement_attachments: ['id', 'document_requirement_id', 'storage_path', 'original_name', 'mime_type', 'file_size', 'order_index', 'missing_at', 'missing_checked_at', 'created_by'],
    // review_status is intentionally absent: the real files table does not
    // expose that column even though the generated legacy type still does.
    files: ['id', 'requirement_id', 'storage_path', 'original_name', 'file_size', 'mime_type', 'version_number', 'uploaded_by', 'comments', 'created_at', 'deleted_at', 'deleted_by', 'upload_batch_id'],
  }
  const inserts = []
  const uploadedPaths = []

  function builder(table) {
    let operation = 'read'
    let payload = null
    let filters = []
    let singleton = false
    const chain = {
      select() { return chain },
      insert(row) { operation = 'insert'; payload = row; return chain },
      delete() { operation = 'delete'; return chain },
      eq(field, value) { filters = [...filters, row => row[field] === value]; return chain },
      in(field, values) { filters = [...filters, row => values.includes(row[field])]; return chain },
      is(field, value) { filters = [...filters, row => value === null ? row[field] == null : row[field] === value]; return chain },
      maybeSingle() { singleton = true; return chain },
      single() { singleton = true; return chain },
      then(resolve, reject) {
        Promise.resolve().then(() => {
          if (operation === 'insert') {
            const unknown = Object.keys(payload).find(key => !knownColumns[table].includes(key))
            if (unknown) return { data: null, error: { message: `Could not find '${unknown}' column in schema cache` } }
            state[table].push({ ...payload })
            inserts.push({ table, row: { ...payload } })
            return { data: singleton ? { id: payload.id } : { ...payload }, error: null }
          }
          const rows = state[table].filter(row => filters.every(filter => filter(row)))
          if (operation === 'delete') {
            state[table] = state[table].filter(row => !filters.every(filter => filter(row)))
            return { data: null, error: null }
          }
          return { data: singleton ? (rows[0] ?? null) : rows, error: null }
        }).then(resolve, reject)
      },
    }
    return chain
  }

  return {
    state,
    inserts,
    uploadedPaths,
    from: table => builder(table),
    storage: {
      from: () => ({
        upload: async (path) => {
          uploadedPaths.push(path)
          return { data: { path }, error: null }
        },
      }),
    },
  }
}

test('createTemporaryProject folosește schema reală pentru files și titlu test', async () => {
  const admin = fixturePayloadAdmin()
  const fixture = await createTemporaryProject(admin, {
    clientEmail: 'client@test.invalid',
    staffEmail: 'staff@test.invalid',
  })

  const project = admin.inserts.find(insert => insert.table === 'projects')
  const file = admin.inserts.find(insert => insert.table === 'files')
  assert.ok(project)
  assert.match(project.row.title, /test/)
  assert.ok(file)
  assert.equal('review_status' in file.row, false)
  assert.equal('uploaded_at' in file.row, false)
  assert.equal(admin.inserts.some(insert => insert.table === 'activity_document_files'), false)
  assert.equal(admin.state.files.length, 1)
  assert.equal(admin.uploadedPaths.length, 2)
  assert.equal(fixture.projectId, project.row.id)
})

test('păstrează nodul străin adăugat după snapshot, cu cereri și fișiere', async () => {
  const admin = fakeAdmin()
  const registry = createCreatedRegistry('project-1')
  registerCreatedPhase(registry, 'phase-copy')
  protectSourceStoragePath(registry, 'source-model')
  await cleanupCreated(admin, registry)

  assert.deepEqual(admin.state.project_phases.map(row => row.id).sort(), ['phase-foreign', 'phase-source'])
  assert.deepEqual(admin.state.document_requirements.map(row => row.id).sort(), ['request-foreign', 'request-foreign-under-source', 'request-source'])
  assert.deepEqual(admin.state.files.map(row => row.storage_path).sort(), ['foreign-client', 'foreign-under-source-client'])
  assert.ok(admin.state.document_requirement_attachments.some(row => row.storage_path === 'source-model'))
  assert.equal(admin.storageObjects.has('source-model'), true)
  assert.equal(admin.storageObjects.has('copy-model'), false)
  assert.equal(admin.calls.some(call => call.table === 'storage' && call.paths.includes('source-model')), false)
  assert.ok(!admin.calls.some(call => call.table === 'audit_logs'))
})

test('păstrează cererea străină sub activitatea non-expandabilă', async () => {
  const admin = fakeAdmin()
  admin.state.project_activities = admin.state.project_activities
    .filter(row => row.id !== 'activity-foreign-under-source')
  admin.state.document_requirements.push({
    id: 'request-foreign-under-activity',
    activity_id: 'activity-source',
    project_id: 'project-1',
    attachment_path: 'foreign-request-model',
    attachment_missing_at: null,
  })

  const registry = createCreatedRegistry('project-1')
  registerCreatedPhase(registry, 'phase-source', { includeDescendants: false })
  registerCreatedActivity(registry, 'activity-source', 'phase-source', { includeDescendants: false })
  registerCreatedRequest(registry, 'request-source', 'activity-source')

  await assert.rejects(cleanupCreated(admin, registry), /Cererea request-foreign-under-activity/)
  assert.ok(admin.state.document_requirements.some(row => row.id === 'request-foreign-under-activity'))
  assert.equal(admin.calls.some(call => call.operation === 'delete' || call.operation === 'remove'), false)
})

test('eșecul citirii oprește cleanup-ul înainte de orice ștergere', async () => {
  const admin = fakeAdmin({ failReads: ['project_activities'] })
  const registry = createCreatedRegistry('project-1')
  registerCreatedPhase(registry, 'phase-copy')

  await assert.rejects(cleanupCreated(admin, registry), /select project_activities failed/)
  assert.equal(admin.calls.some(call => call.operation === 'delete' || call.operation === 'remove'), false)
  assert.equal(admin.state.project_phases.some(row => row.id === 'phase-copy'), true)
})

test('eșecul ștergerii storage păstrează rândurile pentru retry', async () => {
  const admin = fakeAdmin({ failReads: ['storage'] })
  const registry = createCreatedRegistry('project-1')
  registerCreatedPhase(registry, 'phase-copy')

  await assert.rejects(cleanupCreated(admin, registry), /storage failed/)
  assert.equal(admin.state.project_phases.some(row => row.id === 'phase-copy'), true)
  assert.equal(admin.state.document_requirements.some(row => row.id === 'request-copy'), true)
  assert.equal(admin.storageObjects.has('copy-model'), true)
  assert.equal(admin.calls.some(call => call.operation === 'delete'), false)
})

test('cleanup-ul rulează după o aserțiune eșuată din fixture', async () => {
  const admin = fakeAdmin()
  await assert.rejects(
    withCreatedRegistry(admin, 'project-1', async registry => {
      registerCreatedPhase(registry, 'phase-copy')
      throw new Error('asserție eșuată')
    }),
    /asserție eșuată/,
  )
  assert.equal(admin.state.project_phases.some(row => row.id === 'phase-copy'), false)
  assert.equal(admin.state.document_requirements.some(row => row.id === 'request-copy'), false)
})

test('destroyTemporaryProject păstrează proiectul când apare un nod străin', async () => {
  const admin = fakeAdmin()
  const registry = createCreatedRegistry('project-1')
  registerCreatedPhase(registry, 'phase-source', { includeDescendants: false })
  registerCreatedActivity(registry, 'activity-source', 'phase-source')
  registerCreatedRequest(registry, 'request-source', 'activity-source')
  registerCreatedStoragePath(registry, 'source-model')

  await assert.rejects(
    destroyTemporaryProject(admin, {
      projectId: 'project-1',
      phaseId: 'phase-source',
      activityId: 'activity-source',
      requestId: 'request-source',
      registry,
    }),
    /neînregistrate/,
  )
  assert.deepEqual(admin.state.projects, [{ id: 'project-1' }])
  assert.ok(admin.state.project_phases.some(row => row.id === 'phase-foreign'))
  assert.ok(admin.state.project_activities.some(row => row.id === 'activity-foreign-under-source'))
  assert.ok(admin.state.files.some(row => row.storage_path === 'foreign-under-source-client'))
  assert.ok(admin.state.files.some(row => row.storage_path === 'foreign-client'))
  assert.equal(admin.calls.some(call => call.operation === 'delete'), false)
})
