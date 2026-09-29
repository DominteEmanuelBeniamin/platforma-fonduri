import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { normalizeRequirementType } from './requirement-type.ts'
import { mapWithConcurrency } from './template-tree.ts'

const require = createRequire(import.meta.url)
const typescript = require('typescript')

// Scoate handleSave din editor, ca testul să ruleze codul real al paginii.
function extractHandleSave() {
  const pagePath = fileURLToPath(new URL('../app/admin/templates/page.tsx', import.meta.url))
  const sourceFile = typescript.createSourceFile(
    pagePath,
    readFileSync(pagePath, 'utf8'),
    typescript.ScriptTarget.Latest,
    true,
    typescript.ScriptKind.TSX,
  )
  let initializer = null
  const find = (node) => {
    if (typescript.isVariableDeclaration(node) && node.name.getText(sourceFile) === 'handleSave') {
      initializer = node.initializer
      return
    }
    typescript.forEachChild(node, find)
  }
  find(sourceFile)
  assert.ok(initializer, 'handleSave trebuie să existe în editor')
  const { outputText } = typescript.transpileModule(
    `const extractedHandleSave = ${initializer.getText(sourceFile)}`,
    { compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2020 } },
  )
  return new Function(
    'apiFetch', 'validateTemplateForm', 'setValidationErrors', 'setFormError', 'setSaving',
    'serverMessage', 'editingTemplate', 'phases', 'templateName', 'templateDescription', 'isAdmin',
    'generateSlug', 'uploadTemplateFile', 'resetForm', 'showToast', 'openTemplatePropagation',
    'setTemplates', 'mapWithConcurrency',
    `${outputText}\nreturn extractedHandleSave`,
  )
}

const ids = {
  template: '10000000-0000-4000-8000-000000000001',
  phase: '10000000-0000-4000-8000-000000000002',
  activity: '10000000-0000-4000-8000-000000000003',
  docSame: '10000000-0000-4000-8000-000000000004',
  docRenamed: '10000000-0000-4000-8000-000000000005',
  docWithFile: '10000000-0000-4000-8000-000000000006',
}

const attachment = { id: 'att-1', storage_path: 'templates/attachments/model.pdf', original_name: 'model.pdf' }

const editingTemplate = {
  id: ids.template,
  name: 'Șablon',
  status: 'draft',
  phases: [{
    id: ids.phase,
    name: 'Pregătire',
    project_status_id: 'status-1',
    order_index: 1,
    activities: [{
      id: ids.activity,
      name: 'Colectare',
      order_index: 1,
      default_consultant_id: null,
      document_requirements: [
        { id: ids.docSame, name: 'CI', description: null, is_mandatory: true, requirement_type: 'obligatoriu', is_outgoing: false, order_index: 1, attachment_path: null, attachments: [] },
        { id: ids.docRenamed, name: 'Bilanț', description: null, is_mandatory: false, requirement_type: 'optional', is_outgoing: false, order_index: 2, attachment_path: null, attachments: [] },
        { id: ids.docWithFile, name: 'Cerere', description: 'model', is_mandatory: false, requirement_type: 'optional', is_outgoing: false, order_index: 3, attachment_path: attachment.storage_path, attachment_original_name: 'model.pdf', attachments: [attachment] },
      ],
    }],
  }],
}

function editorDoc(doc, overrides = {}) {
  return {
    id: doc.id,
    name: doc.name,
    description: doc.description || '',
    is_outgoing: doc.is_outgoing === true,
    requirement_type: normalizeRequirementType(doc.requirement_type, doc.is_mandatory),
    templateFiles: [],
    templateAttachments: doc.attachments,
    templateFileName: doc.attachment_original_name || null,
    templateFileRemoved: false,
    ...overrides,
  }
}

async function runSave(phases, { template = editingTemplate, admin = false, upload = async file => `templates/attachments/${file.name}` } = {}) {
  const calls = []
  const errors = []
  const propagations = []
  let templatesState = [{ id: ids.template, name: 'vechi' }, { id: 'altul', name: 'Altul' }]
  const apiFetch = async (url, options) => {
    calls.push({ url, method: options?.method ?? 'GET', body: options?.body ? JSON.parse(options.body) : null })
    return new Response(JSON.stringify({ template: { id: ids.template, name: 'salvat' } }), { status: 200 })
  }
  const noOp = () => {}
  const handleSave = extractHandleSave()(
    apiFetch, () => ({ ok: true }), noOp, noOp, noOp, async () => 'server error',
    template, phases, ' Șablon ', '', admin,
    value => value.toLowerCase().replace(/\s+/g, '-'), upload, noOp,
    message => errors.push(message), async id => propagations.push(id),
    update => { templatesState = typeof update === 'function' ? update(templatesState) : update },
    mapWithConcurrency,
  )
  await handleSave()
  return { calls, errors, propagations, templatesState }
}

function editorPhases(docOverrides = {}) {
  const [phase] = editingTemplate.phases
  const [activity] = phase.activities
  return [{
    id: phase.id,
    name: phase.name,
    project_status_id: phase.project_status_id,
    expanded: true,
    activities: [{
      id: activity.id,
      name: activity.name,
      expanded: true,
      default_consultant_id: '',
      document_requirements: activity.document_requirements.map(doc => editorDoc(doc, docOverrides[doc.id])),
    }],
  }]
}

test('salvarea unui șablon existent e o singură cerere PUT cu tot arborele', async () => {
  const { calls, errors, templatesState } = await runSave(editorPhases())
  assert.deepEqual(errors, [])
  assert.deepEqual(calls.map(call => `${call.method} ${call.url}`), [`PUT /api/admin/templates/${ids.template}/tree`])
  const body = calls[0].body
  assert.equal(body.name, 'Șablon')
  assert.equal('slug' in body, false, 'editarea nu rescrie slug-ul șablonului')
  const docs = body.phases[0].activities[0].document_requirements
  assert.deepEqual(docs.map(doc => doc.id), [ids.docSame, ids.docRenamed, ids.docWithFile])
  assert.deepEqual(docs[2].attachments, [attachment])
  assert.deepEqual(templatesState.map(t => t.name), ['salvat', 'Altul'], 'lista se actualizează din răspuns')
})

test('atașamentul scos nu mai pleacă, iar fișierele noi se încarcă înainte de salvare', async () => {
  const file = new File(['x'], 'nou.pdf', { type: 'application/pdf' })
  const { calls } = await runSave(editorPhases({
    [ids.docWithFile]: { templateFileRemoved: true },
    [ids.docSame]: { templateFiles: [file] },
  }))
  const docs = calls[0].body.phases[0].activities[0].document_requirements
  assert.deepEqual(docs[2].attachments, [])
  assert.deepEqual(docs[0].attachments, [{
    storage_path: 'templates/attachments/nou.pdf',
    original_name: 'nou.pdf',
    mime_type: 'application/pdf',
    file_size: 1,
  }])
})

test('un fișier care nu se încarcă oprește salvarea înainte de orice scriere', async () => {
  const file = new File(['x'], 'rupt.pdf')
  const { calls, errors } = await runSave(editorPhases({ [ids.docSame]: { templateFiles: [file] } }), { upload: async () => null })
  assert.deepEqual(calls, [])
  assert.deepEqual(errors, ['Nu s-a putut încărca fișierul "rupt.pdf"'])
})

test('un șablon nou se creează cu tot arborele într-un singur POST', async () => {
  const phases = [{
    id: 'local1',
    name: 'Faza nouă',
    project_status_id: 'status-1',
    expanded: true,
    activities: [{
      id: 'local2',
      name: 'Act',
      expanded: true,
      document_requirements: [],
      duplication: { source_kind: 'local', source_entity_type: 'template_activity', source_id: null, source_name: 'X' },
      sourceLocalId: 'local9',
    }],
  }]
  const { calls, templatesState } = await runSave(phases, { template: null })
  assert.deepEqual(calls.map(call => `${call.method} ${call.url}`), ['POST /api/admin/templates'])
  assert.equal(calls[0].body.slug, 'șablon')
  assert.equal(calls[0].body.phases[0].activities[0].source_local_id, 'local9')
  assert.equal(templatesState[0].name, 'salvat')
})

test('după salvarea unui șablon publicat, adminul primește propagarea', async () => {
  const { propagations } = await runSave(editorPhases(), { template: { ...editingTemplate, status: 'published' }, admin: true })
  assert.deepEqual(propagations, [ids.template])
})
