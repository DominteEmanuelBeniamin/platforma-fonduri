import assert from 'node:assert/strict'
import test from 'node:test'
import { reconcileProjectChatComposerSuccess } from './project-chat-composer.ts'

const reconcile = overrides => reconcileProjectChatComposerSuccess({
  attemptId: 'attempt-1',
  activeAttemptId: 'attempt-1',
  sentText: 'Mesaj',
  currentText: 'Mesaj',
  sentAttachmentIds: ['image-1'],
  currentAttachmentIds: ['image-1'],
  ...overrides,
})

test('clears only the text and attachments committed by the active attempt', () => {
  assert.deepEqual(reconcile({
    currentAttachmentIds: ['image-1', 'image-added-later'],
  }), {
    text: '',
    attachmentIds: ['image-added-later'],
  })
})

test('keeps text appended after the POST started as the next draft', () => {
  assert.equal(reconcile({ currentText: 'Mesaj nou' })?.text, ' nou')
})

test('preserves the complete current value after an arbitrary edit', () => {
  assert.equal(reconcile({ currentText: 'Alt mesaj' })?.text, 'Alt mesaj')
})

test('does not let a stale attempt mutate a newer composer', () => {
  assert.equal(reconcile({ activeAttemptId: 'attempt-2' }), null)
})
