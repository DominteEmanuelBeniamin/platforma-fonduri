import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  duplicationFromSource,
  isPersistentTemplateId,
  parseTemplateDuplication,
  resolveDuplicationForSave,
} from '../app/api/_utils/template-duplication.ts'

const require = createRequire(import.meta.url)
const typescript = require('typescript')

const phaseId = '11111111-1111-4111-8111-111111111111'

test('proveniența locală păstrează numele și ID-ul intern separat', () => {
  const metadata = duplicationFromSource({ id: 'local-phase', name: 'Faza locală' }, 'template_phase')
  assert.deepEqual(metadata.duplication, {
    source_kind: 'local',
    source_entity_type: 'template_phase',
    source_id: null,
    source_name: 'Faza locală',
  })
  assert.equal(metadata.sourceLocalId, 'local-phase')
  assert.equal(isPersistentTemplateId('local-phase'), false)
})

test('salvarea folosește UUID-ul obținut pentru sursa locală', () => {
  const node = duplicationFromSource({ id: 'local-activity', name: 'Activitate' }, 'template_activity')
  const saved = new Map([['local-activity', phaseId]])
  assert.deepEqual(resolveDuplicationForSave(node, saved), {
    source_kind: 'persistent',
    source_entity_type: 'template_activity',
    source_id: phaseId,
    source_name: 'Activitate',
  })
})

test('sursa locală nesalvată rămâne explicit locală', () => {
  const node = duplicationFromSource({ id: 'local-document', name: 'Cerere' }, 'template_document')
  assert.deepEqual(resolveDuplicationForSave(node, new Map()), {
    source_kind: 'local',
    source_entity_type: 'template_document',
    source_id: null,
    source_name: 'Cerere',
  })
})

test('sursa persistentă cere UUID și tipul de audit corect', () => {
  assert.equal(parseTemplateDuplication({
    source_kind: 'persistent',
    source_entity_type: 'template_phase',
    source_id: phaseId,
  }, 'template_phase').ok, true)
  assert.equal(parseTemplateDuplication({
    source_kind: 'persistent',
    source_entity_type: 'template_phase',
    source_id: 'not-a-uuid',
  }, 'template_phase').ok, false)
  assert.equal(parseTemplateDuplication({
    source_kind: 'persistent',
    source_entity_type: 'template_activity',
    source_id: phaseId,
  }, 'template_phase').ok, false)
})

test('sursa locală fără nume sau cu ID persistent este respinsă', () => {
  assert.equal(parseTemplateDuplication({
    source_kind: 'local',
    source_entity_type: 'template_document',
    source_id: null,
    source_name: '  ',
  }, 'template_document').ok, false)
  assert.equal(parseTemplateDuplication({
    source_kind: 'local',
    source_entity_type: 'template_document',
    source_id: phaseId,
    source_name: 'Cerere',
  }, 'template_document').ok, false)
})

test('handleSave real mapează sursa locală la UUID-ul obținut în aceeași salvare', async () => {
  const pagePath = fileURLToPath(new URL('../app/admin/templates/page.tsx', import.meta.url))
  const pageSource = readFileSync(pagePath, 'utf8')
  const sourceFile = typescript.createSourceFile(
    pagePath,
    pageSource,
    typescript.ScriptTarget.Latest,
    true,
    typescript.ScriptKind.TSX,
  )
  let handleSaveInitializer = null
  const findHandleSave = (node) => {
    if (typescript.isVariableDeclaration(node) && node.name.getText(sourceFile) === 'handleSave') {
      handleSaveInitializer = node.initializer
      return
    }
    typescript.forEachChild(node, findHandleSave)
  }
  findHandleSave(sourceFile)
  assert.ok(handleSaveInitializer, 'handleSave trebuie să existe în editor')

  const { outputText } = typescript.transpileModule(
    `const extractedHandleSave = ${handleSaveInitializer.getText(sourceFile)}`,
    {
      compilerOptions: {
        module: typescript.ModuleKind.CommonJS,
        target: typescript.ScriptTarget.ES2020,
      },
      fileName: pagePath,
    },
  )
  const sourcePhaseId = 'local-source-phase'
  const persistedSourcePhaseId = '22222222-2222-4222-8222-222222222222'
  const provenance = duplicationFromSource(
    { id: sourcePhaseId, name: 'Faza sursă' },
    'template_phase',
  )
  const phases = [
    {
      id: sourcePhaseId,
      name: 'Faza sursă',
      project_status_id: 'status-1',
      activities: [],
    },
    {
      id: 'local-clone-phase',
      name: 'Faza clonată',
      project_status_id: 'status-1',
      activities: [],
      ...provenance,
    },
  ]
  const calls = []
  const errors = []
  let phasePosts = 0
  const apiFetch = async (url, options) => {
    const body = options?.body ? JSON.parse(options.body) : null
    calls.push({ url, method: options?.method, body })
    if (url === '/api/admin/templates') {
      return new Response(JSON.stringify({ template: { id: 'template-new' } }), { status: 201 })
    }
    if (url === '/api/admin/templates/phases') {
      phasePosts += 1
      const id = phasePosts === 1 ? persistedSourcePhaseId : '33333333-3333-4333-8333-333333333333'
      return new Response(JSON.stringify({ phase: { id } }), { status: 201 })
    }
    throw new Error(`URL neașteptat în test: ${url}`)
  }
  const noOp = () => {}
  const createHandleSave = new Function(
    'apiFetch',
    'validateTemplateForm',
    'setValidationErrors',
    'setFormError',
    'setSaving',
    'serverMessage',
    'editingTemplate',
    'phases',
    'templateName',
    'templateDescription',
    'isAdmin',
    'generateSlug',
    'uploadTemplateFile',
    'resetForm',
    'fetchData',
    'showToast',
    'resolveDuplicationForSave',
    'isDbId',
    'openTemplatePropagation',
    `${outputText}\nreturn extractedHandleSave`,
  )
  const handleSave = createHandleSave(
    apiFetch,
    () => ({ ok: true }),
    noOp,
    noOp,
    noOp,
    () => 'server error',
    null,
    phases,
    'Template nou',
    '',
    false,
    value => value.toLowerCase().replace(/\s+/g, '-'),
    async () => null,
    noOp,
    noOp,
    message => errors.push(message),
    resolveDuplicationForSave,
    value => isPersistentTemplateId(value),
    async () => {},
  )

  await handleSave()
  assert.deepEqual(errors, [])
  const phaseCalls = calls.filter(call => call.url === '/api/admin/templates/phases')
  assert.equal(phaseCalls.length, 2)
  assert.equal(phaseCalls[0].body.duplication, undefined)
  assert.deepEqual(phaseCalls[1].body.duplication, {
    source_kind: 'persistent',
    source_entity_type: 'template_phase',
    source_id: persistedSourcePhaseId,
    source_name: 'Faza sursă',
  })
  assert.notEqual(phaseCalls[1].body.duplication.source_id, sourcePhaseId)
})
