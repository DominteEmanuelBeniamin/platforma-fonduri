import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'

import {
  compensateTemplateDocument,
  copyTemplateAttachments,
  findReferencedPaths,
} from '../app/api/_utils/attachment-storage.ts'

const require = createRequire(import.meta.url)
const typescript = require('typescript')

function loadTsModule(file, stubs = {}) {
  const source = readFileSync(file, 'utf8')
  const { outputText } = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: file,
  })
  const loadedModule = { exports: {} }
  const strictRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
    if (request.startsWith('.')) {
      const candidate = resolve(dirname(file), `${request}.ts`)
      return loadTsModule(candidate, stubs)
    }
    throw new Error(`unexpected module in route test: ${request}`)
  }
  new Function('require', 'module', 'exports', outputText)(strictRequire, loadedModule, loadedModule.exports)
  return loadedModule.exports
}

function createRouteScenario(config = {}) {
  const calls = {
    copies: [],
    inserts: [],
    deletes: [],
    deleteFilters: [],
    removed: [],
    audit: [],
  }
  const references = config.references ?? {
    template_document_requirements: { data: [], error: null },
    document_requirements: { data: [], error: null },
    document_requirement_attachments: { data: [], error: null },
  }
  const activity = config.activity ?? { template_phases: { template_id: 'template-1' } }
  const activityChain = config.activityChain ?? {
    name: 'Activitate',
    template_phases: { name: 'Fază', project_templates: { name: 'Template' } },
  }
  const source = config.source ?? null
  const document = config.document ?? { id: 'new-document', name: 'Document nou', template_activity_id: 'activity-1' }

  const resultFor = (state, method) => {
    if (state.inserted !== undefined) {
      if (state.table === 'template_document_requirements' && method === 'single') {
        const documentInsertIndex = calls.inserts.filter(({ table: insertedTable }) =>
          insertedTable === 'template_document_requirements'
        ).length - 1
        const configuredDocument = Array.isArray(config.documentInsert)
          ? config.documentInsert[documentInsertIndex]
          : config.documentInsert
        return configuredDocument ?? { data: document, error: null }
      }
      return { data: null, error: config.attachmentsInsertError ?? null }
    }
    if (state.deleted) return { data: null, error: config.deleteError ?? null }
    if (state.table === 'template_document_requirements' && state.selection?.includes('template_activities')) {
      return { data: source, error: config.sourceError ?? null }
    }
    if (state.table === 'template_activities' && state.selection?.startsWith('name,')) {
      return { data: activityChain, error: null }
    }
    if (state.table === 'template_activities') return { data: activity, error: config.activityError ?? null }
    if (state.inValues && Object.prototype.hasOwnProperty.call(references, state.table)) {
      return references[state.table]
    }
    if (state.table === 'template_document_requirements' && state.selection === 'order_index') {
      return { data: { order_index: 0 }, error: null }
    }
    return { data: null, error: null }
  }

  const admin = {
    calls,
    from(table) {
      const state = { table, selection: '', inValues: null, inserted: undefined, deleted: false }
      const builder = {
        select(selection = '') { state.selection = selection; return builder },
        eq(column, value) {
          if (state.deleted) calls.deleteFilters.push({ table, column, value })
          return builder
        },
        in(_column, values) { state.inValues = values; return builder },
        is() { return builder },
        order() { return builder },
        limit() { return builder },
        insert(payload) {
          state.inserted = payload
          calls.inserts.push({ table, payload })
          return builder
        },
        delete() {
          state.deleted = true
          calls.deletes.push(table)
          return builder
        },
        maybeSingle() { return Promise.resolve(resultFor(state, 'maybeSingle')) },
        single() { return Promise.resolve(resultFor(state, 'single')) },
        then(resolveValue, reject) { return Promise.resolve(resultFor(state, 'then')).then(resolveValue, reject) },
      }
      return builder
    },
    storage: {
      from() {
        return {
          async copy(from, to) {
            calls.copies.push({ from, to })
            return { error: config.copyError ?? null }
          },
          async remove(paths) {
            calls.removed.push([...paths])
            return { error: config.removeError ?? null }
          },
        }
      },
    },
  }
  const auth = config.auth ?? { ok: true, profile: { id: 'actor-1', role: 'admin' } }
  const route = loadTsModule(
    resolve('app/api/admin/templates/documents/route.ts'),
    {
      'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
      '@supabase/supabase-js': { createClient: () => admin },
      '@/app/api/_utils/auth': {
        requireProfile: async () => auth,
        requireTemplateAccess: async () => ({ ok: true, template: { id: 'template-1', status: 'draft' } }),
      },
      '@/app/api/_utils/audit': { logAction: async (params) => calls.audit.push(params) },
      '@/lib/requirement-type': {
        normalizeRequirementType: (_value, mandatory) => mandatory ? 'obligatoriu' : 'optional',
        requirementTypeToMandatory: value => value === 'obligatoriu',
      },
      '@/app/api/_utils/attachment-storage': loadTsModule(
        resolve('app/api/_utils/attachment-storage.ts'),
      ),
      '@/app/api/_utils/template-duplication': loadTsModule(
        resolve('app/api/_utils/template-duplication.ts'),
      ),
    },
  )
  return { admin, calls, route }
}

function requestWith(body) {
  return { json: async () => body, headers: new Headers() }
}

function createTemplateNodeRouteScenario(kind, config = {}) {
  const calls = { inserts: [], audit: [] }
  const targetTemplate = 'template-1'
  const source = config.source ?? null
  const defaultRows = {
    project_templates: { name: 'Template canonic' },
    template_phases: { name: 'Fază', template_id: targetTemplate, project_templates: { name: 'Template canonic' } },
    template_activities: { name: 'Activitate', template_phases: { template_id: targetTemplate } },
  }
  const inserted = config.inserted ?? {
    id: 'new-node',
    name: kind === 'phase' ? 'Fază nouă' : 'Activitate nouă',
    template_id: targetTemplate,
  }
  const admin = {
    from(table) {
      const state = { table, selection: '', eqValues: {}, inserted: undefined }
      const resolveResult = () => {
        if (state.inserted !== undefined) return { data: inserted, error: config.insertError ?? null }
        if (table === 'project_templates') return { data: defaultRows.project_templates, error: null }
        if (kind === 'phase' && table === 'template_phases') {
          if (state.selection.includes('name')) {
            return { data: source?.template_id === targetTemplate ? source : null, error: config.sourceError ?? null }
          }
          if (state.selection === 'order_index') return { data: { order_index: 0 }, error: null }
          if (state.selection === 'id') return { data: null, error: null }
        }
        if (kind === 'activity' && table === 'template_phases') {
          if (state.selection === 'template_id') return { data: { template_id: targetTemplate }, error: null }
        }
        if (kind === 'activity' && table === 'template_activities') {
          if (state.selection.includes('template_phases')) return { data: source, error: config.sourceError ?? null }
          if (state.selection === 'order_index') return { data: { order_index: 0 }, error: null }
        }
        return { data: defaultRows[table] ?? null, error: null }
      }
      const builder = {
        select(selection = '') { state.selection = selection; return builder },
        eq(column, value) { state.eqValues[column] = value; return builder },
        order() { return builder },
        limit() { return builder },
        insert(payload) { state.inserted = payload; calls.inserts.push({ table, payload }); return builder },
        maybeSingle() { return Promise.resolve(resolveResult()) },
        single() { return Promise.resolve(resolveResult()) },
        then(resolve, reject) { return Promise.resolve(resolveResult()).then(resolve, reject) },
      }
      return builder
    },
  }
  const routePath = kind === 'phase'
    ? 'app/api/admin/templates/phases/route.ts'
    : 'app/api/admin/templates/activities/route.ts'
  const route = loadTsModule(resolve(routePath), {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@supabase/supabase-js': { createClient: () => admin },
    '@/app/api/_utils/auth': {
      requireProfile: async () => ({ ok: true, profile: { id: 'actor-1', role: 'admin' } }),
      requireTemplateAccess: async () => ({ ok: true, template: { id: targetTemplate, status: 'draft' } }),
    },
    '@/app/api/_utils/audit': { logAction: async params => calls.audit.push(params) },
    '@/app/api/_utils/template-duplication': loadTsModule(resolve('app/api/_utils/template-duplication.ts')),
  })
  return { route, calls }
}

const existingAttachment = (path = 'source/model.pdf', id = 'attachment-1') => ({
  id,
  storage_path: path,
  original_name: 'model.pdf',
})

const baseDocumentBody = (overrides = {}) => ({
  template_activity_id: 'activity-1',
  name: 'Document nou',
  attachments: [existingAttachment()],
  attachment_path: 'source/model.pdf',
  attachment_original_name: 'legacy.pdf',
  ...overrides,
})

function storageAdmin(copyResults = {}) {
  const copies = []
  const admin = {
    copies,
    storage: {
      from() {
        return {
          async copy(from, to) {
            copies.push({ from, to })
            return { error: copyResults[from] || null }
          },
        }
      },
    },
  }
  return admin
}

test('lista este reprezentarea principală și nu recopiază legacy-ul primului model', async () => {
  const admin = storageAdmin()
  const created = []
  const result = await copyTemplateAttachments(
    admin,
    [
      { id: 'a', storage_path: 'source/a.pdf', original_name: 'a.pdf' },
      { id: 'b', storage_path: 'source/b.pdf', original_name: 'b.pdf' },
    ],
    'source/a.pdf',
    'alt-name.pdf',
    new Set(['source/a.pdf', 'source/b.pdf']),
    created,
  )

  assert.equal(admin.copies.length, 2)
  assert.equal(result.legacyPath, result.attachments[0].storage_path)
  assert.equal(result.legacyOriginalName, 'a.pdf')
  assert.equal(created.length, 2)
})

test('lista nu preia numele legacy când primul attachment nu are nume', async () => {
  const result = await copyTemplateAttachments(
    storageAdmin(),
    [{ id: 'a', storage_path: 'source/a.pdf', original_name: null }],
    'source/a.pdf',
    'alt-name.pdf',
    new Set(['source/a.pdf']),
  )
  assert.equal(result.legacyOriginalName, null)
})

test('documentul exclusiv legacy se copiază o singură dată', async () => {
  const admin = storageAdmin()
  const result = await copyTemplateAttachments(
    admin,
    [],
    'source/legacy.pdf',
    'legacy.pdf',
    new Set(['source/legacy.pdf']),
  )
  assert.equal(admin.copies.length, 1)
  assert.notEqual(result.legacyPath, 'source/legacy.pdf')
})

test('sursa lipsă păstrează calea și marcajele explicite', async () => {
  const result = await copyTemplateAttachments(
    storageAdmin({ 'source/missing.pdf': { message: 'Object not found' } }),
    [{ id: 'a', storage_path: 'source/missing.pdf', original_name: 'missing.pdf' }],
    null,
    null,
    new Set(['source/missing.pdf']),
  )
  assert.equal(result.attachments[0].storage_path, 'source/missing.pdf')
  assert.ok(result.attachments[0].missing_at)
  assert.ok(result.attachments[0].missing_checked_at)
  assert.equal(result.legacyPath, 'source/missing.pdf')
  assert.ok(result.legacyMissingAt)
})

test('eșecul unei copieri păstrează în ledger copiile anterioare', async () => {
  const created = []
  await assert.rejects(
    copyTemplateAttachments(
      storageAdmin({ 'source/b.pdf': { message: 'Internal Server Error' } }),
      [
        { id: 'a', storage_path: 'source/a.pdf', original_name: 'a.pdf' },
        { id: 'b', storage_path: 'source/b.pdf', original_name: 'b.pdf' },
      ],
      null,
      null,
      new Set(['source/a.pdf', 'source/b.pdf']),
      created,
    ),
  )
  assert.equal(created.length, 1)
})

function queryAdmin(results) {
  return {
    from(table) {
      const result = results[table]
      const builder = {
        select() { return builder },
        in() { return builder },
        is() { return builder },
        then(resolve, reject) { return Promise.resolve(result).then(resolve, reject) },
      }
      return builder
    },
  }
}

test('findReferencedPaths propagă eroarea oricăruia dintre cele trei SELECT-uri', async () => {
  const errors = [
    ['template_document_requirements', new Error('template select failed')],
    ['document_requirements', new Error('project select failed')],
    ['document_requirement_attachments', new Error('attachments select failed')],
  ]
  for (const [failedTable, expected] of errors) {
    const results = {
      template_document_requirements: { data: [], error: null },
      document_requirements: { data: [], error: null },
      document_requirement_attachments: { data: [], error: null },
    }
    results[failedTable] = { data: null, error: expected }
    await assert.rejects(findReferencedPaths(queryAdmin(results), ['source/a.pdf']), error => error === expected)
  }
})

test('compensarea șterge exact rândurile documentului și căile nou-create', async () => {
  const calls = []
  const admin = {
    from(table) {
      const builder = {
        delete() { calls.push({ operation: 'delete', table }); return builder },
        eq(column, value) { calls.push({ operation: 'eq', table, column, value }); return builder },
        then(resolve, reject) { return Promise.resolve({ error: null }).then(resolve, reject) },
      }
      return builder
    },
    storage: {
      from() {
        return { async remove(paths) { calls.push({ operation: 'remove', paths }); return { error: null } } }
      },
    },
  }
  const errors = await compensateTemplateDocument(admin, 'new-document', ['new/a.pdf', 'new/b.pdf'])
  assert.deepEqual(errors, [])
  assert.deepEqual(calls, [
    { operation: 'delete', table: 'document_requirement_attachments' },
    { operation: 'eq', table: 'document_requirement_attachments', column: 'template_document_requirement_id', value: 'new-document' },
    { operation: 'delete', table: 'template_document_requirements' },
    { operation: 'eq', table: 'template_document_requirements', column: 'id', value: 'new-document' },
    { operation: 'remove', paths: ['new/a.pdf', 'new/b.pdf'] },
  ])
})

test('oricare dintre cele trei SELECT-uri de referințe eșuează înainte de orice mutație', async () => {
  const paths = {
    legacy: 'source/model-legacy.pdf',
    attachment: 'source/model-attachment.pdf',
  }
  const selectCases = [
    ['template_document_requirements', new Error('template reference SELECT failed')],
    ['document_requirements', new Error('project reference SELECT failed')],
    ['document_requirement_attachments', new Error('attachment reference SELECT failed')],
  ]

  for (const [failedTable, selectError] of selectCases) {
    const references = {
      template_document_requirements: { data: [{ attachment_path: paths.legacy }], error: null },
      document_requirements: { data: [], error: null },
      document_requirement_attachments: { data: [{ storage_path: paths.attachment }], error: null },
    }
    references[failedTable] = { data: null, error: selectError }
    const scenario = createRouteScenario({ references })
    const response = await scenario.route.POST(requestWith(baseDocumentBody({
      attachments: [
        existingAttachment(paths.legacy, 'legacy-model'),
        existingAttachment(paths.attachment, 'attachment-model'),
      ],
      attachment_path: paths.legacy,
    })), {})

    assert.equal(response.status, 500, failedTable)
    assert.equal(scenario.calls.copies.length, 0, failedTable)
    assert.equal(scenario.calls.inserts.length, 0, failedTable)
    assert.equal(scenario.calls.audit.length, 0, failedTable)
    assert.deepEqual(scenario.calls.deletes, [], failedTable)
    assert.deepEqual(scenario.calls.removed, [], failedTable)
    assert.equal((await response.json()).message.includes('SELECT'), false, failedTable)
  }
})

test('SELECT reușit fără referințe permite crearea obișnuită și păstrează auditul add', async () => {
  const scenario = createRouteScenario({
    references: {
      template_document_requirements: { data: [], error: null },
      document_requirements: { data: [], error: null },
      document_requirement_attachments: { data: [], error: null },
    },
  })
  const response = await scenario.route.POST(requestWith(baseDocumentBody({ attachments: [] })), {})
  assert.equal(response.status, 201)
  assert.equal(scenario.calls.copies.length, 0)
  assert.equal(scenario.calls.inserts.length, 1)
  assert.equal(scenario.calls.audit.length, 1)
  assert.equal(scenario.calls.audit[0].actionType, 'add')
  assert.equal('duplication' in scenario.calls.audit[0].newValues, false)
})

test('path fără id nu intră în ledger și nu este șters dacă INSERT-ul documentului eșuează', async () => {
  const scenario = createRouteScenario({
    documentInsert: { data: null, error: new Error('document INSERT failed') },
    references: {
      template_document_requirements: { data: [], error: null },
      document_requirements: { data: [], error: null },
      document_requirement_attachments: { data: [], error: null },
    },
  })
  const response = await scenario.route.POST(requestWith(baseDocumentBody({
    attachments: [{ storage_path: 'client/fresh.pdf', original_name: 'fresh.pdf' }],
    attachment_path: 'client/fresh.pdf',
  })), {})
  assert.equal(response.status, 500)
  assert.deepEqual(scenario.calls.removed, [])
})

test('eșecul INSERT attachments curăță documentul nou și doar destinația copiată', async () => {
  const scenario = createRouteScenario({
    attachmentsInsertError: new Error('attachments INSERT failed'),
    documentInsert: [
      { data: { id: 'previous-document', name: 'Document anterior', template_activity_id: 'activity-1' }, error: null },
      { data: { id: 'new-document', name: 'Document nou', template_activity_id: 'activity-1' }, error: null },
    ],
    references: {
      template_document_requirements: { data: [{ attachment_path: 'source/model.pdf' }], error: null },
      document_requirements: { data: [], error: null },
      document_requirement_attachments: { data: [], error: null },
    },
  })
  const firstResponse = await scenario.route.POST(requestWith(baseDocumentBody({ attachments: [] })), {})
  assert.equal(firstResponse.status, 201)
  assert.equal(scenario.calls.audit.length, 1)
  const previousAudit = scenario.calls.audit[0]

  const response = await scenario.route.POST(requestWith(baseDocumentBody()), {})
  assert.equal(response.status, 500)
  assert.equal(scenario.calls.copies.length, 2)
  assert.deepEqual(scenario.calls.deletes.slice(-2), [
    'document_requirement_attachments',
    'template_document_requirements',
  ])
  assert.deepEqual(scenario.calls.deleteFilters.slice(-2), [
    {
      table: 'document_requirement_attachments',
      column: 'template_document_requirement_id',
      value: 'new-document',
    },
    { table: 'template_document_requirements', column: 'id', value: 'new-document' },
  ])
  assert.equal(scenario.calls.removed.length, 1)
  assert.equal(scenario.calls.removed[0].length, 1)
  assert.equal(scenario.calls.removed[0][0], scenario.calls.copies[1].to)
  assert.notEqual(scenario.calls.removed[0][0], scenario.calls.copies[0].to)
  assert.equal(scenario.calls.audit.length, 1)
  assert.equal(scenario.calls.audit[0], previousAudit)
})

test('attachments au prioritate față de legacy și copiază primul model o singură dată', async () => {
  const scenario = createRouteScenario({
    references: {
      template_document_requirements: { data: [{ attachment_path: 'source/model.pdf' }], error: null },
      document_requirements: { data: [], error: null },
      document_requirement_attachments: { data: [], error: null },
    },
  })
  const response = await scenario.route.POST(requestWith(baseDocumentBody()), {})
  assert.equal(response.status, 201)
  assert.equal(scenario.calls.copies.length, 1)
  const inserted = scenario.calls.inserts[0].payload
  assert.equal(inserted.attachment_path, scenario.calls.copies[0].to)
  assert.equal(inserted.attachment_original_name, 'model.pdf')
})

test('proveniența persistentă recitește numele canonic și respinge alt template', async () => {
  const duplication = {
    source_kind: 'persistent',
    source_entity_type: 'template_document',
    source_id: '11111111-1111-4111-8111-111111111111',
    source_name: 'nume fals',
  }
  const valid = createRouteScenario({
    source: {
      id: duplication.source_id,
      name: 'Nume canonic',
      template_activities: { template_phases: { template_id: 'template-1' } },
    },
    references: {
      template_document_requirements: { data: [], error: null },
      document_requirements: { data: [], error: null },
      document_requirement_attachments: { data: [], error: null },
    },
  })
  const validResponse = await valid.route.POST(requestWith(baseDocumentBody({ duplication })), {})
  assert.equal(validResponse.status, 201)
  assert.equal(valid.calls.audit.length, 1)
  assert.equal(valid.calls.audit[0].actionType, 'create')
  assert.equal(valid.calls.audit[0].newValues.duplication.source_name, 'Nume canonic')

  const invalid = createRouteScenario({
    source: {
      id: duplication.source_id,
      name: 'Nume alt template',
      template_activities: { template_phases: { template_id: 'template-2' } },
    },
  })
  const invalidResponse = await invalid.route.POST(requestWith(baseDocumentBody({ duplication })), {})
  assert.equal(invalidResponse.status, 400)
  assert.equal(invalid.calls.inserts.length, 0)
  assert.equal(invalid.calls.audit.length, 0)
})

test('POST phase real validează provenance și păstrează add pentru crearea obișnuită', async () => {
  const sourceId = '11111111-1111-4111-8111-111111111111'
  const duplication = {
    source_kind: 'persistent', source_entity_type: 'template_phase', source_id: sourceId, source_name: 'fals',
  }
  const valid = createTemplateNodeRouteScenario('phase', {
    source: { id: sourceId, name: 'Fază canonică', template_id: 'template-1' },
  })
  const validResponse = await valid.route.POST(requestWith({
    template_id: 'template-1', project_status_id: 'status-1', name: 'Fază nouă', duplication,
  }), {})
  assert.equal(validResponse.status, 201)
  assert.equal(valid.calls.audit[0].actionType, 'create')
  assert.equal(valid.calls.audit[0].newValues.duplication.source_name, 'Fază canonică')

  const invalid = createTemplateNodeRouteScenario('phase', {
    source: { id: sourceId, name: 'Altă fază', template_id: 'template-2' },
  })
  const invalidResponse = await invalid.route.POST(requestWith({
    template_id: 'template-1', project_status_id: 'status-1', name: 'Fază nouă', duplication,
  }), {})
  assert.equal(invalidResponse.status, 400)
  assert.equal(invalid.calls.inserts.length, 0)
  assert.equal(invalid.calls.audit.length, 0)

  const ordinary = createTemplateNodeRouteScenario('phase')
  const ordinaryResponse = await ordinary.route.POST(requestWith({
    template_id: 'template-1', project_status_id: 'status-1', name: 'Fază obișnuită',
  }), {})
  assert.equal(ordinaryResponse.status, 201)
  assert.equal(ordinary.calls.audit[0].actionType, 'add')
  assert.equal('duplication' in ordinary.calls.audit[0].newValues, false)
})

test('POST activity real înregistrează clonarea locală fără UUID temporar', async () => {
  const activity = createTemplateNodeRouteScenario('activity')
  const response = await activity.route.POST(requestWith({
    template_phase_id: 'phase-1',
    name: 'Activitate clonată',
    duplication: {
      source_kind: 'local',
      source_entity_type: 'template_activity',
      source_id: null,
      source_name: 'Activitate locală',
    },
  }), {})
  assert.equal(response.status, 201)
  assert.equal(activity.calls.audit.length, 1)
  assert.equal(activity.calls.audit[0].actionType, 'create')
  assert.deepEqual(activity.calls.audit[0].newValues.duplication, {
    source_kind: 'local', source_entity_type: 'template_activity', source_id: null, source_name: 'Activitate locală',
  })
})
