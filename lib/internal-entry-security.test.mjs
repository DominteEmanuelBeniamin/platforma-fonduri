import assert from 'node:assert/strict'
import test from 'node:test'

const {
  canEditInternalEntry,
  INTERNAL_ATTACHMENT_MAX_BYTES,
  normalizeInternalAttachmentName,
  parseInternalAttachmentInput,
  parseInternalEntryInput,
  resolveInternalEntryContext,
} = await import('./internal-entry-security.ts')

const projectId = '11111111-1111-4111-8111-111111111111'
const otherId = '22222222-2222-4222-8222-222222222222'

test('only dossier authors, senior members, and admins can edit entries', () => {
  const entry = { created_by: 'junior' }
  assert.equal(canEditInternalEntry({ id: 'junior', role: 'consultant', consultant_level: 'junior' }, entry), true)
  assert.equal(canEditInternalEntry({ id: 'colleague', role: 'consultant', consultant_level: 'junior' }, entry), false)
  assert.equal(canEditInternalEntry({ id: 'colleague', role: 'consultant', consultant_level: 'senior' }, entry), true)
  assert.equal(canEditInternalEntry({ id: 'admin', role: 'admin', consultant_level: 'junior' }, entry), true)
  assert.equal(canEditInternalEntry({ id: 'junior', role: 'client', consultant_level: 'junior' }, entry), false)
})

test('entry validation allows no context and rejects multiple contexts', () => {
  assert.equal(parseInternalEntryInput({ title: 'Fără context' }).ok, true)
  const multiple = parseInternalEntryInput({ title: 'Context invalid', phase_id: projectId, activity_id: otherId })
  assert.deepEqual(multiple, { ok: false, error: 'Choose at most one context' })
})

test('PATCH preserves an omitted context and null clears it', () => {
  const current = { phase_id: projectId, activity_id: null, document_requirement_id: null }
  assert.deepEqual(resolveInternalEntryContext(current, { body: 'text' }), current)
  assert.deepEqual(resolveInternalEntryContext(current, { phase_id: null }), {
    phase_id: null,
    activity_id: null,
    document_requirement_id: null,
  })
  assert.equal(resolveInternalEntryContext(current, { activity_id: otherId }), null)
})

test('upload reservation accepts only bounded metadata and never a path', () => {
  assert.equal(INTERNAL_ATTACHMENT_MAX_BYTES, 25 * 1024 * 1024)
  assert.equal(parseInternalAttachmentInput({ originalName: 'plan.pdf', mimeType: 'application/pdf', fileSize: 123 }).ok, true)
  assert.equal(parseInternalAttachmentInput({ originalName: 'plan.pdf', mimeType: 'application/pdf', fileSize: 25 * 1024 * 1024 + 1 }).ok, false)
  assert.equal(parseInternalAttachmentInput({ originalName: 'plan.pdf', mimeType: 'application/pdf', fileSize: 10, storagePath: 'forged' }).ok, false)
  assert.equal(parseInternalAttachmentInput({ originalName: 'program.exe', mimeType: 'application/x-msdownload', fileSize: 10 }).ok, false)
  assert.equal(parseInternalAttachmentInput({ originalName: 'program.exe', mimeType: 'application/pdf', fileSize: 10 }).ok, false)
  assert.equal(parseInternalAttachmentInput({ originalName: 'raport.XLSX', mimeType: '', fileSize: 10 }).ok, true)
})

test('attachment names are reduced to a safe filename', () => {
  assert.equal(normalizeInternalAttachmentName('..\\private\\note\n.pdf'), 'note.pdf')
  assert.equal(normalizeInternalAttachmentName('  '), '')
})
