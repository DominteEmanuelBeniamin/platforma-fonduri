import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { isPersistentTemplateId, resolveDuplicationForSave } from '../app/api/_utils/template-duplication.ts'
import { normalizeRequirementType } from './requirement-type.ts'

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
    'generateSlug', 'uploadTemplateFile', 'resetForm', 'fetchData', 'showToast',
    'resolveDuplicationForSave', 'isDbId', 'openTemplatePropagation', 'normalizeRequirementType',
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

async function runSave(phases) {
  const calls = []
  const errors = []
  const apiFetch = async (url, options) => {
    calls.push({ url, method: options?.method ?? 'GET', body: options?.body ? JSON.parse(options.body) : null })
    return new Response(JSON.stringify({ template: { id: ids.template } }), { status: 200 })
  }
  const noOp = () => {}
  const handleSave = extractHandleSave()(
    apiFetch, () => ({ ok: true }), noOp, noOp, noOp, () => 'server error',
    editingTemplate, phases, 'Șablon', '', false,
    value => value.toLowerCase().replace(/\s+/g, '-'), async () => null, noOp, noOp,
    message => errors.push(message), resolveDuplicationForSave,
    value => isPersistentTemplateId(value), async () => {}, normalizeRequirementType,
  )
  await handleSave()
  assert.deepEqual(errors, [])
  lastCalls = calls
  return calls.filter(call => call.method === 'PATCH').map(call => call.url)
}
let lastCalls = []

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

test('salvarea fără modificări trimite doar PATCH-ul șablonului', async () => {
  assert.deepEqual(await runSave(editorPhases()), [`/api/admin/templates/${ids.template}`])
})

test('se trimite PATCH doar pentru documentul modificat', async () => {
  const patches = await runSave(editorPhases({ [ids.docRenamed]: { name: 'Bilanț 2025' } }))
  assert.deepEqual(patches, [
    `/api/admin/templates/${ids.template}`,
    `/api/admin/templates/documents/${ids.docRenamed}`,
  ])
})

test('scoaterea unui atașament sau schimbarea tipului contează ca modificare', async () => {
  const patches = await runSave(editorPhases({
    [ids.docWithFile]: { templateFileRemoved: true },
    [ids.docSame]: { requirement_type: 'daca_e_cazul' },
  }))
  assert.deepEqual(patches, [
    `/api/admin/templates/${ids.template}`,
    `/api/admin/templates/documents/${ids.docSame}`,
    `/api/admin/templates/documents/${ids.docWithFile}`,
  ])
})

test('reordonarea trimite PATCH pentru elementele care și-au schimbat poziția', async () => {
  const phases = editorPhases()
  const docs = phases[0].activities[0].document_requirements
  phases[0].activities[0].document_requirements = [docs[1], docs[0], docs[2]]
  const patches = await runSave(phases)
  assert.deepEqual(patches, [
    `/api/admin/templates/${ids.template}`,
    `/api/admin/templates/documents/${ids.docRenamed}`,
    `/api/admin/templates/documents/${ids.docSame}`,
  ])
})

test('schimbarea consultantului implicit trimite PATCH pentru activitate', async () => {
  const phases = editorPhases()
  phases[0].activities[0].default_consultant_id = '10000000-0000-4000-8000-0000000000aa'
  const patches = await runSave(phases)
  assert.deepEqual(patches, [
    `/api/admin/templates/${ids.template}`,
    `/api/admin/templates/activities/${ids.activity}`,
  ])
})

test('editarea nu mai rescrie slug-ul șablonului (se lovea de unicitate la nume identice)', async () => {
  const phases = editorPhases()
  await runSave(phases)
  const templatePatch = lastCalls.find(call => call.url === `/api/admin/templates/${ids.template}`)
  assert.equal(templatePatch.body.name, 'Șablon')
  assert.equal('slug' in templatePatch.body, false)
})
