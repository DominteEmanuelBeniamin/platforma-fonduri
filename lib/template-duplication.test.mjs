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
import { planTemplateSave } from './template-save-plan.ts'

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

test('handleSave real trimite proveniența locală și sursa ei, iar serverul o leagă de UUID', async () => {
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
  const apiFetch = async (url, options) => {
    calls.push({ url, method: options?.method, body: options?.body ? JSON.parse(options.body) : null })
    if (url === '/api/admin/templates') {
      return new Response(JSON.stringify({ template: { id: 'template-new' } }), { status: 201 })
    }
    throw new Error(`URL neașteptat în test: ${url}`)
  }
  const noOp = () => {}
  const createHandleSave = new Function(
    'apiFetch', 'validateTemplateForm', 'setValidationErrors', 'setFormError', 'setSaving',
    'serverMessage', 'editingTemplate', 'phases', 'templateName', 'templateDescription', 'isAdmin',
    'generateSlug', 'uploadTemplateFile', 'resetForm', 'showToast', 'openTemplatePropagation',
    'setTemplates', 'mapWithConcurrency',
    `${outputText}\nreturn extractedHandleSave`,
  )
  const handleSave = createHandleSave(
    apiFetch, () => ({ ok: true }), noOp, noOp, noOp, async () => 'server error',
    null, phases, 'Template nou', '', false,
    value => value.toLowerCase().replace(/\s+/g, '-'), async () => null, noOp,
    message => errors.push(message), async () => {}, noOp, async () => [],
  )

  await handleSave()
  assert.deepEqual(errors, [])
  assert.equal(calls.length, 1)
  const [sourcePhase, clonePhase] = calls[0].body.phases
  assert.equal(sourcePhase.duplication, undefined)
  assert.equal(sourcePhase.id, sourcePhaseId)
  assert.deepEqual(clonePhase.duplication, provenance.duplication)
  assert.equal(clonePhase.source_local_id, sourcePhaseId)

  // Serverul primește arborele și leagă copia de UUID-ul sursei salvate acum.
  const planned = planTemplateSave({ id: 'template-new', name: 'Template nou', phases: [] }, calls[0].body, [], (() => {
    let n = 0
    return () => `22222222-2222-4222-8222-${String(++n).padStart(12, '0')}`
  })())
  assert.ok(planned.ok)
  const [sourceInsert, cloneInsert] = planned.plan.phaseInserts
  assert.deepEqual(cloneInsert.duplication, {
    source_kind: 'persistent',
    source_entity_type: 'template_phase',
    source_id: sourceInsert.row.id,
    source_name: 'Faza sursă',
  })
})
