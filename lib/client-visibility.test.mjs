import assert from 'node:assert/strict'
import test from 'node:test'
import visibility from './client-visibility.js'

const { isClientVisibleActivity, isClientVisibleDocument, isClientVisiblePhase } = visibility

test('client visibility respects the complete parent chain', () => {
  const publishedPhase = { visibility: 'published' }
  const draftPhase = { visibility: 'draft' }
  const publishedActivity = { visibility: 'published', phase: publishedPhase }

  assert.equal(isClientVisiblePhase(publishedPhase), true)
  assert.equal(isClientVisibleActivity(publishedActivity), true)
  assert.equal(isClientVisibleActivity({ ...publishedActivity, phase: draftPhase }), false)
  assert.equal(isClientVisibleDocument({ visibility: 'published', activity_id: null }), true)
  assert.equal(isClientVisibleDocument({ visibility: 'draft', activity_id: null }), false)
  assert.equal(isClientVisibleDocument({ visibility: 'published', activity_id: 'a', activity: publishedActivity }), true)
  assert.equal(isClientVisibleDocument({ visibility: 'published', activity_id: 'a', activity: { ...publishedActivity, phase: draftPhase } }), false)
})
