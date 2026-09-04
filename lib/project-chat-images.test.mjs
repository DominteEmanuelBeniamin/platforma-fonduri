import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildProjectChatImagePath,
  extractProjectChatStorageMetadata,
  isCoherentProjectChatImageReference,
  isProjectChatImagePath,
  normalizeProjectChatImageMimeType,
  parseProjectChatMessageInput,
  projectChatImagePrefix,
  sanitizeProjectChatImageName,
  validateProjectChatImageUploads,
} from './project-chat-images.ts'

const projectId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'
const uuid = '33333333-3333-4333-8333-333333333333'

test('accepts the four supported image types and infers a blank MIME from extension', () => {
  for (const [name, type] of [
    ['one.png', 'image/png'],
    ['two.jpg', 'image/jpeg'],
    ['three.webp', 'image/webp'],
    ['four.gif', 'image/gif'],
  ]) {
    const result = validateProjectChatImageUploads([{ name, size: 1, type: '' }])
    assert.equal(result.ok, true)
    assert.equal(result.files[0].mimeType, type)
  }
})

test('rejects SVG, zero bytes, oversized files, and more than five files', () => {
  assert.equal(validateProjectChatImageUploads([{ name: 'x.svg', size: 1, type: 'image/svg+xml' }]).ok, false)
  assert.equal(validateProjectChatImageUploads([{ name: 'x.png', size: 0, type: 'image/png' }]).ok, false)
  assert.equal(validateProjectChatImageUploads([{ name: 'x.png', size: 10 * 1024 * 1024 + 1, type: 'image/png' }]).ok, false)
  assert.equal(validateProjectChatImageUploads(Array.from({ length: 6 }, (_, i) => ({ name: `${i}.png`, size: 1, type: 'image/png' }))).ok, false)
})

test('sanitizes names without allowing path separators and keeps a bounded name', () => {
  const safe = sanitizeProjectChatImageName('../folder\\my image?.png')
  assert.equal(safe.includes('/'), false)
  assert.equal(safe.includes('\\'), false)
  assert.equal(safe.endsWith('.png'), true)
  assert.equal(sanitizeProjectChatImageName('   '), '')
})

test('requires exact project/user prefix and generated filename coherence', () => {
  const path = buildProjectChatImagePath(projectId, userId, 'capture.png', uuid)
  assert.equal(path, `${projectChatImagePrefix(projectId, userId)}${uuid}_capture.png`)
  assert.equal(isProjectChatImagePath(path, projectId, userId), true)
  assert.equal(isCoherentProjectChatImageReference(path, 'capture.png', projectId, userId), true)
  assert.equal(isCoherentProjectChatImageReference(path, 'other.png', projectId, userId), false)
  assert.equal(isCoherentProjectChatImageReference(`${projectChatImagePrefix(projectId, userId)}${uuid}_evil_capture.png`, 'capture.png', projectId, userId), false)
  assert.equal(isProjectChatImagePath(`${projectChatImagePrefix(projectId, 'other')}${uuid}_capture.png`, projectId, userId), false)
  assert.equal(isProjectChatImagePath(`${projectChatImagePrefix(projectId, userId)}../capture.png`, projectId, userId), false)
})

test('parses body-only, image-only, text plus images, and rejects empty/duplicate/wrong-prefix payloads', () => {
  const path = buildProjectChatImagePath(projectId, userId, 'capture.png', uuid)
  assert.deepEqual(parseProjectChatMessageInput({ body: 'hello' }, projectId, userId), {
    ok: true,
    data: { body: 'hello', images: [] },
  })
  assert.deepEqual(parseProjectChatMessageInput({ body: null, images: [{ path, name: 'capture.png' }] }, projectId, userId), {
    ok: true,
    data: { body: null, images: [{ path, name: 'capture.png' }] },
  })
  assert.equal(parseProjectChatMessageInput({ body: 'hello', images: [{ path, name: 'capture.png' }] }, projectId, userId).ok, true)
  assert.equal(parseProjectChatMessageInput({ body: '  ' }, projectId, userId).ok, false)
  assert.equal(parseProjectChatMessageInput({ body: 'x', images: [{ path, name: 'capture.png' }, { path, name: 'capture.png' }] }, projectId, userId).ok, false)
  assert.equal(parseProjectChatMessageInput({ body: 'x', images: [{ path: path.replace(userId, 'other-user'), name: 'capture.png' }] }, projectId, userId).ok, false)
})

test('storage metadata accepts SDK top-level and nested forms but only allowed MIME values', () => {
  assert.deepEqual(extractProjectChatStorageMetadata({ size: 12, contentType: 'image/png' }), { size: 12, mimeType: 'image/png' })
  assert.deepEqual(extractProjectChatStorageMetadata({ metadata: { contentLength: '13', mimetype: 'image/webp' } }), { size: 13, mimeType: 'image/webp' })
  assert.deepEqual(extractProjectChatStorageMetadata({ size: 1, contentType: 'image/svg+xml' }), { size: 1, mimeType: null })
  assert.equal(normalizeProjectChatImageMimeType('x.png', 'image/jpeg'), null)
})
