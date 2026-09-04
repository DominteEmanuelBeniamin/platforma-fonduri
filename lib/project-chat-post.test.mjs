import assert from 'node:assert/strict'
import test from 'node:test'
import { removeUnreferencedProjectChatImages } from '../app/api/_utils/project-chat-image-refs.ts'
import { insertProjectChatMessageWithCleanup } from './project-chat-post.ts'

test('cleans exactly once when Supabase returns an insert error', async () => {
  const insertError = new Error('insert rejected')
  let cleanupCalls = 0

  const result = await insertProjectChatMessageWithCleanup(
    async () => ({ data: null, error: insertError }),
    async () => { cleanupCalls += 1 },
  )

  assert.deepEqual(result, { ok: false, kind: 'result', error: insertError })
  assert.equal(cleanupCalls, 1)
})

test('cleans exactly once when an insert has neither error nor returned data', async () => {
  let cleanupCalls = 0

  const result = await insertProjectChatMessageWithCleanup(
    async () => ({ data: null, error: null }),
    async () => { cleanupCalls += 1 },
  )

  assert.deepEqual(result, { ok: false, kind: 'result', error: null })
  assert.equal(cleanupCalls, 1)
})

test('cleans exactly once when the insert transport throws', async () => {
  const transportError = new Error('response lost')
  let cleanupCalls = 0

  const result = await insertProjectChatMessageWithCleanup(
    async () => { throw transportError },
    async () => { cleanupCalls += 1 },
  )

  assert.deepEqual(result, { ok: false, kind: 'transport', error: transportError })
  assert.equal(cleanupCalls, 1)
})

test('ambiguous transport cleanup keeps an image referenced by the committed message', async () => {
  const path = 'projects/project/chat/user/image.png'
  const removals = []
  let referenceQueries = 0
  const query = {
    select() { return this },
    eq() { return this },
    is() { return this },
    async or() {
      referenceQueries += 1
      return {
        data: [{ images: [{ path, name: 'image.png', mimeType: 'image/png', size: 4 }] }],
        error: null,
      }
    },
  }
  const admin = {
    from(table) {
      assert.equal(table, 'project_chat_messages')
      return query
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, 'project-files')
        return {
          async remove(paths) {
            removals.push(paths)
            return { error: null }
          },
        }
      },
    },
  }

  const result = await insertProjectChatMessageWithCleanup(
    async () => { throw new Error('response lost after commit') },
    async () => {
      await removeUnreferencedProjectChatImages(admin, 'project', [path])
    },
  )

  assert.equal(result.ok, false)
  assert.equal(result.kind, 'transport')
  assert.equal(referenceQueries, 1)
  assert.deepEqual(removals, [])
})

test('confirmed insert does not clean uploaded images', async () => {
  const row = { id: 'message' }
  let cleanupCalls = 0

  const result = await insertProjectChatMessageWithCleanup(
    async () => ({ data: row, error: null }),
    async () => { cleanupCalls += 1 },
  )

  assert.deepEqual(result, { ok: true, data: row })
  assert.equal(cleanupCalls, 0)
})
