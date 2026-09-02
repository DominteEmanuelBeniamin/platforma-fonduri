import assert from 'node:assert/strict'
import test from 'node:test'
import { serializeProjectChatMessages } from '../app/api/_utils/project-chat-messages.ts'

const image = (path, name) => ({ path, name, mimeType: 'image/png', size: 4 })
const row = (id, body, images, deleted_at = null) => ({
  id,
  project_id: 'project',
  created_by: 'user',
  body,
  images,
  created_at: '2026-09-01T00:00:00.000Z',
  edited_at: null,
  deleted_at,
})

test('deleted messages are masked and never included in the signing batch', async () => {
  const calls = []
  const admin = {
    storage: {
      from() {
        return {
          createSignedUrls(paths, ttl) {
            calls.push({ paths, ttl })
            return Promise.resolve({ data: paths.map(path => ({ path, signedUrl: `signed:${path}` })), error: null })
          },
        }
      },
    },
  }
  const [deleted, active] = await serializeProjectChatMessages([
    row('deleted', 'secret', [image('deleted.png', 'deleted.png')], '2026-09-01T00:01:00.000Z'),
    row('active', 'hello', [image('active.png', 'active.png')]),
  ], admin)

  assert.equal(deleted.body, null)
  assert.deepEqual(deleted.images, [])
  assert.equal(deleted.is_deleted, true)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].paths, ['active.png'])
  assert.equal(calls[0].ttl, 3600)
  assert.equal(active.images[0].signedUrl, 'signed:active.png')
})

test('active images use one signing call and preserve an individual signing failure', async () => {
  const calls = []
  const admin = {
    storage: {
      from() {
        return {
          createSignedUrls(paths, ttl) {
            calls.push({ paths, ttl })
            return Promise.resolve({
              data: [
                { path: paths[0], signedUrl: 'signed:first.png' },
                { path: paths[1], signedUrl: null, error: 'missing' },
              ],
              error: null,
            })
          },
        }
      },
    },
  }
  const [message] = await serializeProjectChatMessages([
    row('active', 'hello', [image('first.png', 'first.png'), image('second.png', 'second.png')]),
  ], admin)

  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].paths, ['first.png', 'second.png'])
  assert.equal(calls[0].ttl, 3600)
  assert.equal(message.images[0].signedUrl, 'signed:first.png')
  assert.equal(message.images[1].signedUrl, null)
  assert.equal(message.images[1].signedUrlExpiresAt, null)
})
