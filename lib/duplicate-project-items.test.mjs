import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'

import { duplicateActivityAfterSource, duplicatePhase } from '../app/api/_utils/duplicate-project-items.ts'
import { duplicationAuditEntries } from '../app/api/_utils/duplication-audit.ts'
import { buildCopyName } from './duplicate-name.ts'
import { slugify } from './slug.ts'

const nodeRequire = createRequire(import.meta.url)
const typescript = nodeRequire('typescript')

const ids = {
  project: '10000000-0000-0000-0000-000000000001',
  phase: '20000000-0000-0000-0000-000000000001',
  nextPhase: '20000000-0000-0000-0000-000000000002',
  activity: '30000000-0000-0000-0000-000000000001',
  nextActivity: '30000000-0000-0000-0000-000000000002',
}
const actorId = '90000000-0000-0000-0000-000000000001'

class Query {
  constructor(client, table) {
    this.client = client
    this.table = table
    this.filters = []
    this.sorts = []
    this.operation = 'select'
  }

  select(selection = '*') { this.selection = selection; return this }
  eq(column, value) { this.filters.push(row => row[column] === value); return this }
  neq(column, value) { this.filters.push(row => row[column] !== value); return this }
  gt(column, value) { this.filters.push(row => row[column] > value); return this }
  is(column, value) { this.filters.push(row => row[column] === value); return this }
  in(column, values) { this.filters.push(row => values.includes(row[column])); return this }
  order(column, options = {}) { this.sorts.push({ column, ascending: options.ascending !== false }); return this }
  insert(payload) { this.operation = 'insert'; this.payload = payload; return this }
  update(payload) { this.operation = 'update'; this.payload = payload; return this }
  delete() { this.operation = 'delete'; return this }
  single() { return this.run().then(result => ({ data: result.data?.[0] ?? null, error: result.error })) }
  maybeSingle() { return this.single() }

  then(resolve, reject) { return this.run().then(resolve, reject) }

  async run() {
    if (this.client.failures.has(this.table)) return { data: null, error: this.client.failures.get(this.table) }
    const table = this.client.tables[this.table]
    if (this.operation === 'insert') {
      const input = Array.isArray(this.payload) ? this.payload : [this.payload]
      if (this.table === 'project_phases' && input.some(row => table.some(existing => existing.project_id === row.project_id && existing.slug === row.slug))) {
        return { data: null, error: new Error('project phase slug already exists') }
      }
      const created = input.map(row => ({ id: row.id ?? crypto.randomUUID(), ...row }))
      table.push(...created)
      return { data: created, error: null }
    }
    const selected = table.filter(row => this.filters.every(filter => filter(row)))
    if (this.operation === 'delete') {
      for (const row of selected) table.splice(table.indexOf(row), 1)
      return { data: selected, error: null }
    }
    if (this.operation === 'update') {
      selected.forEach(row => Object.assign(row, this.payload))
      return { data: selected, error: null }
    }
    for (const sort of this.sorts) {
      selected.sort((a, b) => {
        const result = (a[sort.column] ?? 0) - (b[sort.column] ?? 0)
        return sort.ascending ? result : -result
      })
    }
    if (this.table === 'document_requirements' && this.selection?.includes('attachments:')) {
      return {
        data: selected.map(row => ({
          ...row,
          attachments: this.client.tables.document_requirement_attachments
            .filter(attachment => attachment.document_requirement_id === row.id),
        })),
        error: null,
      }
    }
    return { data: selected, error: null }
  }
}

class FakeAdmin {
  constructor(seed = {}) {
    this.tables = {
      project_phases: [...(seed.project_phases ?? [])],
      project_activities: [...(seed.project_activities ?? [])],
      document_requirements: [...(seed.document_requirements ?? [])],
      document_requirement_attachments: [...(seed.document_requirement_attachments ?? [])],
      projects: [...(seed.projects ?? [{ id: ids.project, title: 'Proiect test' }])],
    }
    this.storagePaths = new Set()
    this.copyCalls = []
    this.removeCalls = []
    this.filesAccessed = false
    this.rpcCalls = []
    this.failRpc = false
    this.failures = new Map()
    this.storage = { from: () => ({
      copy: async (from, to) => {
        this.copyCalls.push({ from, to })
        this.storagePaths.add(to)
        return { data: {}, error: null }
      },
      remove: async paths => {
        this.removeCalls.push([...paths])
        paths.forEach(path => this.storagePaths.delete(path))
        return { data: [], error: null }
      },
    }) }
  }

  from(table) {
    if (table === 'files') {
      this.filesAccessed = true
      throw new Error('fișierele client nu fac parte din duplicare')
    }
    return new Query(this, table)
  }

  async rpc(name, args) {
    this.rpcCalls.push({ name, args })
    if (this.failRpc) return { data: null, error: new Error('rpc injectat') }
    if (name === 'shift_project_phases_after_duplicate') {
      const source = this.tables.project_phases.find(row => row.id === args.p_source_phase_id && row.project_id === args.p_project_id)
      const copy = this.tables.project_phases.find(row => row.id === args.p_copy_phase_id && row.project_id === args.p_project_id)
      if (!source || !copy) return { data: null, error: new Error('scope invalid') }
      this.tables.project_phases
        .filter(row => row.project_id === args.p_project_id && row.order_index > source.order_index && row.id !== copy.id)
        .forEach(row => { row.order_index += 1 })
    } else {
      const source = this.tables.project_activities.find(row => row.id === args.p_source_activity_id && row.phase_id === args.p_phase_id)
      const copy = this.tables.project_activities.find(row => row.id === args.p_copy_activity_id && row.phase_id === args.p_phase_id)
      if (!source || !copy) return { data: null, error: new Error('scope invalid') }
      this.tables.project_activities
        .filter(row => row.phase_id === args.p_phase_id && row.order_index > source.order_index && row.id !== copy.id)
        .forEach(row => { row.order_index += 1 })
    }
    return { data: null, error: null }
  }
}

function phase(id, projectId = ids.project, order = 1, name = 'Contractare', overrides = {}) {
  return {
    id,
    project_id: projectId,
    project_status_id: null,
    order_index: order,
    name,
    description: null,
    ...overrides,
  }
}

function activity(id, phaseId = ids.phase, order = 1, name = 'Verificare', overrides = {}) {
  return {
    id,
    phase_id: phaseId,
    order_index: order,
    name,
    description: null,
    assigned_to: null,
    ...overrides,
  }
}

function request(id, activityId, name, overrides = {}) {
  return {
    id,
    activity_id: activityId,
    name,
    deleted_at: null,
    order_index: 1,
    attachment_path: null,
    ...overrides,
  }
}

test('duplicarea generează slug unic cu UUID și rămâne stabilă după redenumire', async () => {
  const admin = new FakeAdmin({ project_phases: [phase(ids.phase)] })
  const source = admin.tables.project_phases[0]
  const firstName = buildCopyName(source.name, admin.tables.project_phases.map(row => row.name))
  const first = await duplicatePhase(admin, { projectId: ids.project, sourcePhase: source, name: firstName, actorId: ids.project })
  const firstRow = admin.tables.project_phases.find(row => row.id === first.phase.id)
  firstRow.name = 'Contractare 2027'
  const secondName = buildCopyName(source.name, admin.tables.project_phases.map(row => row.name))
  const second = await duplicatePhase(admin, { projectId: ids.project, sourcePhase: source, name: secondName, actorId: ids.project })

  assert.match(first.phase.slug, new RegExp(`^${slugify(firstName)}-[0-9a-f-]{36}$`))
  assert.match(second.phase.slug, new RegExp(`^${slugify(secondName)}-[0-9a-f-]{36}$`))
  assert.notEqual(first.phase.slug, second.phase.slug)
  assert.equal(firstRow.slug, first.phase.slug)

  const accented = phase('20000000-0000-0000-0000-000000000003', ids.project, 3, 'Șablon')
  const plain = phase('20000000-0000-0000-0000-000000000004', ids.project, 4, 'Sablon')
  admin.tables.project_phases.push(accented, plain)
  const accentedCopy = await duplicatePhase(admin, {
    projectId: ids.project,
    sourcePhase: accented,
    name: buildCopyName(accented.name, admin.tables.project_phases.map(row => row.name)),
    actorId: ids.project,
  })
  const plainCopy = await duplicatePhase(admin, {
    projectId: ids.project,
    sourcePhase: plain,
    name: buildCopyName(plain.name, admin.tables.project_phases.map(row => row.name)),
    actorId: ids.project,
  })
  assert.notEqual(accentedCopy.phase.slug, plainCopy.phase.slug)
})

test('PATCH-ul real redenumește faza fără să atingă slug-ul', async () => {
  const admin = new FakeAdmin({ project_phases: [phase(ids.phase)] })
  const auth = {
    requireProjectAccess: async (_request, projectId) => ({
      ok: true,
      user: { id: ids.project },
      profile: { id: ids.project, role: 'admin' },
      access: { role: 'admin', projectId },
    }),
  }
  const audit = { logAction: async () => {} }
  const route = await loadRoute('../app/api/projects/[id]/phases/[phaseId]/route.ts', { admin, auth, audit })
  const oldSlug = admin.tables.project_phases[0].slug = 'contractare-original'
  const response = await route.PATCH(
    new Request('http://localhost/api', { method: 'PATCH', body: JSON.stringify({ name: 'Contractare 2027' }) }),
    { params: Promise.resolve({ id: ids.project, phaseId: ids.phase }) },
  )
  assert.equal(response.status, 200)
  assert.equal(admin.tables.project_phases[0].name, 'Contractare 2027')
  assert.equal(admin.tables.project_phases[0].slug, oldSlug)

  const source = admin.tables.project_phases[0]
  const copy = await duplicatePhase(admin, {
    projectId: ids.project,
    sourcePhase: source,
    name: buildCopyName(source.name, admin.tables.project_phases.map(row => row.name)),
    actorId: ids.project,
  })
  assert.notEqual(copy.phase.slug, oldSlug)
})

test('duplicarea unei faze returnează maparea fază/activități/cereri', async () => {
  const admin = new FakeAdmin({
    project_phases: [phase(ids.phase), phase(ids.nextPhase, ids.project, 2, 'Următoarea')],
    project_activities: [activity(ids.activity, ids.phase, 1, 'Verificare'), activity(ids.nextActivity, ids.phase, 2, 'Aprobare')],
    document_requirements: [
      request('40000000-0000-0000-0000-000000000001', ids.activity, 'Cerere 1'),
      request('40000000-0000-0000-0000-000000000002', ids.activity, 'Cerere 2'),
      request('40000000-0000-0000-0000-000000000003', ids.nextActivity, 'Cerere 3'),
    ],
  })
  const result = await duplicatePhase(admin, {
    projectId: ids.project,
    sourcePhase: admin.tables.project_phases[0],
    name: 'Contractare (copie)',
    actorId: ids.project,
  })

  assert.equal(result.counts.activities, 2)
  assert.equal(result.counts.documentRequests, 3)
  assert.equal(result.audit.phase.sourceId, ids.phase)
  assert.equal(result.audit.phase.copyId, result.phase.id)
  assert.equal(result.audit.activities.length, 2)
  assert.equal(result.audit.documentRequests.length, 3)
  assert.deepEqual(result.audit.activities.map(item => item.sourceName), ['Verificare', 'Aprobare'])
  assert.deepEqual(result.audit.documentRequests.map(item => item.sourceName), ['Cerere 1', 'Cerere 2', 'Cerere 3'])
  assert.ok(result.audit.documentRequests.every(item => item.copyId !== item.sourceId && item.activityId && item.activityName))
  assert.equal(admin.tables.project_phases.find(row => row.id === ids.nextPhase).order_index, 3)
})

test('duplicarea activității mapează cererile și compensează la eșecul RPC', async () => {
  const admin = new FakeAdmin({
    project_activities: [activity(ids.activity), activity(ids.nextActivity, ids.phase, 2, 'Aprobare')],
    document_requirements: [request('40000000-0000-0000-0000-000000000011', ids.activity, 'Cerere')],
  })
  const result = await duplicateActivityAfterSource(admin, {
    projectId: ids.project,
    phaseId: ids.phase,
    sourceActivity: admin.tables.project_activities[0],
    name: 'Verificare (copie)',
    actorId: ids.project,
    phaseName: 'Contractare',
  })
  assert.equal(result.documentRequests.length, 1)
  assert.equal(result.audit.activities[0].sourceId, ids.activity)
  assert.equal(result.audit.documentRequests[0].sourceActivityId, ids.activity)
  assert.equal(admin.tables.project_activities.find(row => row.id === ids.nextActivity).order_index, 3)

  const failing = new FakeAdmin({
    project_activities: [activity(ids.activity), activity(ids.nextActivity, ids.phase, 2, 'Aprobare')],
    document_requirements: [request('40000000-0000-0000-0000-000000000012', ids.activity, 'Cerere')],
  })
  failing.failRpc = true
  await assert.rejects(
    duplicateActivityAfterSource(failing, {
      projectId: ids.project,
      phaseId: ids.phase,
      sourceActivity: failing.tables.project_activities[0],
      name: 'Verificare (copie)',
      actorId: ids.project,
    }),
    /rpc injectat/,
  )
  assert.equal(failing.tables.project_activities.length, 2)
  assert.equal(failing.tables.document_requirements.length, 1)
  assert.equal(failing.tables.project_activities.find(row => row.id === ids.nextActivity).order_index, 2)
})

async function loadRoute(path, { admin, auth, audit }) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8')
  const output = typescript.transpileModule(source, {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2022 },
  }).outputText
  const loadedModule = { exports: {} }
  const requireLocal = specifier => {
    if (specifier === '@/app/api/_utils/auth') return auth
    if (specifier === '@/app/api/_utils/audit') return audit
    if (specifier === '@/app/api/_utils/duplicate-project-items') return { duplicatePhase, duplicateActivityAfterSource }
    if (specifier === '@/app/api/_utils/duplication-audit') return { duplicationAuditEntries }
    if (specifier === '@/lib/duplicate-name') return { buildCopyName }
    if (specifier.endsWith('/auth') || specifier.endsWith('/auth.ts')) return auth
    if (specifier.endsWith('/audit') || specifier.endsWith('/audit.ts')) return audit
    if (specifier.endsWith('/duplicate-project-items.ts')) return { duplicatePhase, duplicateActivityAfterSource }
    if (specifier.endsWith('/duplication-audit') || specifier.endsWith('/duplication-audit.ts')) return { duplicationAuditEntries }
    if (specifier.endsWith('/duplicate-name') || specifier.endsWith('/duplicate-name.ts')) return { buildCopyName }
    if (specifier === '@/lib/client-visibility') return nodeRequire('../lib/client-visibility.js')
    if (specifier === '@supabase/supabase-js') return { createClient: () => admin }
    if (specifier.startsWith('@/')) throw new Error(`import alias neașteptat în ruta testată: ${specifier}`)
    if (/email|notification/i.test(specifier)) throw new Error(`import de notificare neașteptat: ${specifier}`)
    return nodeRequire(specifier)
  }
  new Function('require', 'module', 'exports', output)(requireLocal, loadedModule, loadedModule.exports)
  return loadedModule.exports
}

test('rutele reale loghează fiecare nod doar după succes și resping clientul', async () => {
  let accessRole = 'admin'
  const events = []
  const sourceDeadline = '2027-01-02T00:00:00.000Z'
  const modelPath = 'models/source.pdf'
  const clientFilePath = 'client/private-upload.pdf'
  const auth = {
    requireProjectAccess: async (_request, projectId) => accessRole === 'client'
      ? { ok: true, user: { id: actorId }, profile: { id: actorId, role: 'client' }, access: { role: 'client', projectId } }
      : { ok: true, user: { id: actorId }, profile: { id: actorId, role: 'admin' }, access: { role: 'admin', projectId } },
  }
  // `auditBatches` numără apelurile, `events` păstrează intrările: auditul
  // trebuie să plece într-un singur insert, cu exact același conținut.
  const auditBatches = []
  const audit = {
    logAction: async params => { auditBatches.push([params]); events.push(params) },
    logActions: async entries => { auditBatches.push(entries); events.push(...entries) },
  }
  let admin = new FakeAdmin({
    project_phases: [phase(ids.phase, ids.project, 1, 'Contractare', {
      status: 'published',
      visibility: 'published',
      deadline_at: sourceDeadline,
      client_notified_at: '2025-01-01T00:00:00.000Z',
      reminder_sent_at: '2025-01-02T00:00:00.000Z',
      source_template_phase_id: 'template-phase-1',
    }), phase(ids.nextPhase, ids.project, 2, 'Următoarea')],
    project_activities: [
      activity(ids.activity, ids.phase, 1, 'Verificare', {
        status: 'completed',
        visibility: 'published',
        assigned_to: '70000000-0000-0000-0000-000000000001',
        assigned_by: '70000000-0000-0000-0000-000000000099',
        assigned_at: '2025-01-03T00:00:00.000Z',
        deadline_at: sourceDeadline,
        started_at: '2025-01-04T00:00:00.000Z',
        completed_at: '2025-01-05T00:00:00.000Z',
        client_notified_at: '2025-01-06T00:00:00.000Z',
        reminder_sent_at: '2025-01-07T00:00:00.000Z',
        deleted_at: null,
        source_template_activity_id: 'template-activity-1',
        files: [{ storage_path: clientFilePath }],
      }),
      activity(ids.nextActivity, ids.phase, 2, 'Aprobare', {
        status: 'cancelled',
        visibility: 'published',
        assigned_to: '70000000-0000-0000-0000-000000000002',
        assigned_by: '70000000-0000-0000-0000-000000000098',
        assigned_at: '2025-01-08T00:00:00.000Z',
        deadline_at: '2027-02-03T00:00:00.000Z',
        started_at: '2025-01-09T00:00:00.000Z',
        completed_at: '2025-01-10T00:00:00.000Z',
        client_notified_at: '2025-01-11T00:00:00.000Z',
        reminder_sent_at: '2025-01-12T00:00:00.000Z',
        deleted_at: null,
        source_template_activity_id: 'template-activity-2',
        files: [{ storage_path: 'client/private-upload-2.pdf' }],
      }),
    ],
    document_requirements: [
      request('40000000-0000-0000-0000-000000000021', ids.activity, 'Cerere 1', {
        description: 'Model obligatoriu',
        is_mandatory: true,
        requirement_type: 'upload',
        is_outgoing: false,
        assigned_to: '70000000-0000-0000-0000-000000000001',
        assigned_by: '70000000-0000-0000-0000-000000000099',
        assigned_at: '2025-01-13T00:00:00.000Z',
        deadline_at: sourceDeadline,
        status: 'approved',
        visibility: 'published',
        is_locked: true,
        client_notified_at: '2025-01-14T00:00:00.000Z',
        reminder_sent_at: '2025-01-15T00:00:00.000Z',
        source_template_document_requirement_id: 'template-document-1',
        files: [{ storage_path: clientFilePath }],
        attachments: [{
          id: '50000000-0000-0000-0000-000000000021',
          storage_path: modelPath,
          original_name: 'model.pdf',
          mime_type: 'application/pdf',
          file_size: 42,
          order_index: 0,
          missing_at: null,
          missing_checked_at: null,
          source_template_attachment_id: 'template-attachment-1',
        }],
      }),
      request('40000000-0000-0000-0000-000000000022', ids.activity, 'Cerere 2', {
        assigned_to: '70000000-0000-0000-0000-000000000001',
        deadline_at: sourceDeadline,
        status: 'approved',
        visibility: 'published',
        is_locked: true,
        source_template_document_requirement_id: 'template-document-2',
        files: [{ storage_path: 'client/private-upload-2.pdf' }],
      }),
      request('40000000-0000-0000-0000-000000000023', ids.nextActivity, 'Cerere 3', {
        assigned_to: '70000000-0000-0000-0000-000000000002',
        deadline_at: '2027-02-03T00:00:00.000Z',
        status: 'rejected',
        visibility: 'published',
        is_locked: true,
        source_template_document_requirement_id: 'template-document-3',
        files: [{ storage_path: 'client/private-upload-3.pdf' }],
      }),
    ],
    document_requirement_attachments: [{
      id: '50000000-0000-0000-0000-000000000021',
      document_requirement_id: '40000000-0000-0000-0000-000000000021',
      storage_path: modelPath,
      original_name: 'model.pdf',
      mime_type: 'application/pdf',
      file_size: 42,
      order_index: 0,
      missing_at: null,
      missing_checked_at: null,
      source_template_attachment_id: 'template-attachment-1',
    }],
  })
  const phaseRoute = await loadRoute('../app/api/projects/[id]/phases/[phaseId]/duplicate/route.ts', { admin, auth, audit })
  let response = await phaseRoute.POST(new Request('http://localhost/api'), { params: Promise.resolve({ id: ids.project, phaseId: ids.phase }) })
  assert.equal(response.status, 201)
  const phaseBody = await response.json()
  assert.equal(events.length, 6)
  assert.equal(auditBatches.length, 1, 'auditul pleacă într-un singur insert, nu unul per element')
  assert.equal(events.filter(event => event.entityType === 'project_phase').length, 1)
  assert.equal(events.filter(event => event.entityType === 'project_activity').length, 2)
  assert.equal(events.filter(event => event.entityType === 'document_request').length, 3)
  assert.ok(events.every(event => event.actorId === actorId))
  assert.ok(events.every(event => event.newValues.project_id === ids.project))
  assert.ok(events.every(event => event.newValues.project_title === 'Proiect test'))
  assert.ok(events.every(event => event.newValues.duplication.source_kind === 'persistent'))
  assert.deepEqual(events.filter(event => event.entityType === 'project_activity').map(event => event.newValues.duplication.source_name), ['Verificare', 'Aprobare'])
  const phaseEvent = events.find(event => event.entityType === 'project_phase')
  assert.equal(phaseEvent.newValues.duplication.source_id, ids.phase)
  assert.equal(phaseEvent.newValues.source_template_phase_id, null)
  assert.deepEqual(
    events.filter(event => event.entityType === 'project_activity').map(event => event.newValues.duplication.source_id).sort(),
    [ids.activity, ids.nextActivity].sort(),
  )
  assert.deepEqual(
    events.filter(event => event.entityType === 'document_request').map(event => event.newValues.duplication.source_id).sort(),
    ['40000000-0000-0000-0000-000000000021', '40000000-0000-0000-0000-000000000022', '40000000-0000-0000-0000-000000000023'].sort(),
  )
  assert.ok(events.filter(event => event.entityType === 'document_request').every(event => event.newValues.activity_id && event.newValues.source_activity_id))

  const copiedPhase = admin.tables.project_phases.find(row => row.id === phaseBody.phase.id)
  assert.equal(copiedPhase.status, 'pending')
  assert.equal(copiedPhase.visibility, 'draft')
  assert.equal(copiedPhase.source_template_phase_id, null)
  const copiedActivities = admin.tables.project_activities.filter(row => row.phase_id === copiedPhase.id)
  assert.equal(copiedActivities.length, 2)
  for (const copied of copiedActivities) {
    const source = admin.tables.project_activities.find(row => row.name === copied.name && row.phase_id === ids.phase)
    assert.equal(copied.status, 'pending')
    assert.equal(copied.visibility, 'draft')
    assert.equal(copied.assigned_to, source.assigned_to)
    assert.equal(copied.assigned_by, actorId)
    assert.equal(copied.deadline_at, source.deadline_at)
    assert.equal(copied.notes, null)
    assert.equal(copied.started_at, undefined)
    assert.equal(copied.completed_at, undefined)
    assert.equal(copied.client_notified_at, undefined)
    assert.equal(copied.reminder_sent_at, undefined)
    assert.equal(copied.source_template_activity_id, null)
    assert.equal(copied.files, undefined)
  }
  const copiedActivityIds = new Set(copiedActivities.map(row => row.id))
  const copiedRequests = admin.tables.document_requirements.filter(row => copiedActivityIds.has(row.activity_id))
  assert.equal(copiedRequests.length, 3)
  for (const copied of copiedRequests) {
    const source = admin.tables.document_requirements.find(row => row.name === copied.name && row.activity_id !== copied.activity_id)
    assert.equal(copied.status, 'pending')
    assert.equal(copied.visibility, 'draft')
    assert.equal(copied.is_locked, false)
    assert.equal(copied.assigned_to, source.assigned_to)
    assert.equal(copied.assigned_by, actorId)
    assert.ok(copied.assigned_at)
    assert.equal(copied.deadline_at, source.deadline_at)
    assert.equal(copied.client_notified_at, undefined)
    assert.equal(copied.reminder_sent_at, undefined)
    assert.equal(copied.source_template_document_requirement_id, null)
    assert.equal(copied.files, undefined)
  }
  const copiedAttachments = admin.tables.document_requirement_attachments.filter(row => copiedRequests.some(requestRow => requestRow.id === row.document_requirement_id))
  assert.equal(copiedAttachments.length, 1)
  assert.notEqual(copiedAttachments[0].storage_path, modelPath)
  assert.equal(copiedAttachments[0].source_template_attachment_id, null)
  assert.deepEqual(admin.copyCalls.map(call => call.from), [modelPath])
  assert.ok(admin.copyCalls.every(call => !call.from.startsWith('client/')))
  assert.equal(admin.filesAccessed, false)
  assert.deepEqual(admin.removeCalls, [])

  admin = new FakeAdmin({
    project_phases: [phase(ids.phase)],
    project_activities: [activity(ids.activity), activity(ids.nextActivity, ids.phase, 2, 'Aprobare')],
    document_requirements: [request('40000000-0000-0000-0000-000000000024', ids.activity, 'Cerere')],
  })
  const activityRoute = await loadRoute('../app/api/projects/[id]/phases/[phaseId]/activities/[activityId]/duplicate/route.ts', { admin, auth, audit })
  events.length = 0
  auditBatches.length = 0
  response = await activityRoute.POST(new Request('http://localhost/api'), { params: Promise.resolve({ id: ids.project, phaseId: ids.phase, activityId: ids.activity }) })
  assert.equal(response.status, 201)
  const activityBody = await response.json()
  assert.equal(events.length, 2)
  assert.equal(auditBatches.length, 1, 'auditul pleacă într-un singur insert, nu unul per element')
  assert.equal(events[0].entityType, 'project_activity')
  assert.equal(events[1].entityType, 'document_request')
  assert.ok(events.every(event => event.actorId === actorId))
  assert.ok(events.every(event => event.newValues.project_id === ids.project && event.newValues.project_title === 'Proiect test'))
  assert.ok(events.every(event => event.newValues.duplication.source_kind === 'persistent'))
  assert.equal(events[0].newValues.duplication.source_id, ids.activity)
  assert.equal(events[1].newValues.duplication.source_id, '40000000-0000-0000-0000-000000000024')
  const copiedActivity = admin.tables.project_activities.find(row => row.id === activityBody.activity.id)
  assert.equal(copiedActivity.status, 'pending')
  assert.equal(copiedActivity.visibility, 'draft')
  assert.equal(copiedActivity.source_template_activity_id, null)
  assert.equal(admin.filesAccessed, false)
  assert.deepEqual(admin.copyCalls, [])

  const beforeFailure = admin.tables.project_activities.length
  events.length = 0
  auditBatches.length = 0
  admin.failRpc = true
  response = await activityRoute.POST(new Request('http://localhost/api'), { params: Promise.resolve({ id: ids.project, phaseId: ids.phase, activityId: ids.activity }) })
  assert.equal(response.status, 500)
  assert.equal(events.length, 0)
  assert.equal(admin.tables.project_activities.length, beforeFailure)

  accessRole = 'client'
  admin.failRpc = false
  response = await activityRoute.POST(new Request('http://localhost/api'), { params: Promise.resolve({ id: ids.project, phaseId: ids.phase, activityId: ids.activity }) })
  assert.equal(response.status, 403)
  assert.equal(events.length, 0)
})
