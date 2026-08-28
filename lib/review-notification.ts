import { isClientVisibleDocument } from './client-visibility.js'

type Relation<T> = T | T[] | null | undefined

export type ReviewNotificationRequest = {
  id: string
  status: string | null
  visibility: string | null
  deleted_at: string | null
  activity_id: string | null
  activity?: Relation<{
    id?: string
    visibility: string | null
    phase?: Relation<{ id?: string; visibility: string | null }>
  }>
  [key: string]: unknown
}

export type ReviewNotificationReview = {
  id: string
  requirement_id: string
  action: 'approved' | 'rejected'
  reason: string | null
  reviewed_at: string
  client_notified_at: string | null
  [key: string]: unknown
}

export type ReviewNotificationCandidate = {
  requestId: string
  request: ReviewNotificationRequest
  review: ReviewNotificationReview
  unnotifiedReviewIds: string[]
}

export type ReviewNotificationSelection = {
  candidates: ReviewNotificationCandidate[]
  incompatibleRequestIds: string[]
}

export type ReviewNotificationEvent = {
  requestId: string
  title: string
  entityLabel: string
  eventKey: string
  severity: 'success' | 'danger'
}

function compareReviews(left: ReviewNotificationReview, right: ReviewNotificationReview) {
  const leftTime = Date.parse(left.reviewed_at)
  const rightTime = Date.parse(right.reviewed_at)
  if (leftTime !== rightTime) {
    return (Number.isNaN(rightTime) ? -Infinity : rightTime) - (Number.isNaN(leftTime) ? -Infinity : leftTime)
  }
  if (left.id === right.id) return 0
  return left.id < right.id ? 1 : -1
}

export function selectReviewNotificationCandidates(input: {
  requests: ReviewNotificationRequest[]
  reviews: ReviewNotificationReview[]
}): ReviewNotificationSelection {
  const reviewsByRequest = new Map<string, ReviewNotificationReview[]>()
  for (const review of input.reviews) {
    const reviews = reviewsByRequest.get(review.requirement_id) ?? []
    reviews.push(review)
    reviewsByRequest.set(review.requirement_id, reviews)
  }

  const candidates: ReviewNotificationCandidate[] = []
  const incompatibleRequestIds: string[] = []

  for (const request of input.requests) {
    if (request.deleted_at || !isClientVisibleDocument(request)) continue

    const reviews = (reviewsByRequest.get(request.id) ?? []).slice().sort(compareReviews)
    const latest = reviews[0]
    if (!latest || (request.status !== 'approved' && request.status !== 'rejected')) continue

    if (latest.action !== request.status) {
      incompatibleRequestIds.push(request.id)
      continue
    }
    if (latest.client_notified_at !== null) continue

    candidates.push({
      requestId: request.id,
      request,
      review: latest,
      unnotifiedReviewIds: reviews
        .filter(review => review.client_notified_at === null)
        .map(review => review.id),
    })
  }

  return { candidates, incompatibleRequestIds }
}

export function buildReviewNotificationEvents(candidates: ReviewNotificationCandidate[]): ReviewNotificationEvent[] {
  return candidates.map(candidate => {
    const name = typeof candidate.request.name === 'string' && candidate.request.name
      ? candidate.request.name
      : candidate.requestId
    const approved = candidate.review.action === 'approved'
    return {
      requestId: candidate.requestId,
      // Numele stă în `entityLabel`: panoul îl pune pe primul rând, iar titlul
      // rămâne acțiunea, la fel ca la notificarea imediată scrisă din SQL.
      title: `Document ${approved ? 'aprobat' : 'respins'}`,
      entityLabel: name,
      eventKey: `document-review:${candidate.review.id}`,
      severity: approved ? 'success' : 'danger',
    }
  })
}
