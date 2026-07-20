const isPublished = item => item?.visibility === 'published'

const one = relation => Array.isArray(relation) ? relation[0] : relation

function isClientVisiblePhase(phase) {
  return isPublished(phase)
}

function isClientVisibleActivity(activity) {
  return isPublished(activity) && isPublished(one(activity?.phase))
}

function isClientVisibleDocument(request) {
  if (!isPublished(request)) return false
  if (!request?.activity_id) return true

  return isClientVisibleActivity(one(request.activity))
}

module.exports = {
  isPublished,
  isClientVisiblePhase,
  isClientVisibleActivity,
  isClientVisibleDocument,
}
