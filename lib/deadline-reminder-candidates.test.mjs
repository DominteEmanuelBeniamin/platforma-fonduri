import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildReminderDigestIdempotencyKey,
  buildReminderNotificationEventKey,
  groupReminderCandidatesByProject,
  hasReminderRecipient,
  selectDeadlineReminderCandidates,
} from './deadline-reminder-candidates.ts'

const now = new Date('2026-08-14T09:00:00.000Z')

function candidate(overrides = {}) {
  return {
    entityType: 'request',
    entityId: 'request-1',
    projectId: 'project-1',
    projectTitle: 'Proiect test',
    name: 'Document',
    description: null,
    deadlineAt: '2026-08-13T09:00:00.000Z',
    threshold: 'overdue',
    days: -1,
    recipientId: 'client-1',
    recipientEmail: 'client@example.com',
    recipientName: 'Client',
    recipientKind: 'client',
    url: 'https://example.com/projects/project-1',
    ...overrides,
  }
}

function baseInput(overrides = {}) {
  return {
    now,
    appUrl: 'https://example.com',
    projects: [{
      id: 'project-1',
      title: 'Proiect test',
      status: 'implementare',
      general_consultant_id: 'consultant-1',
      client: { id: 'client-1', full_name: 'Client', email: 'client@example.com' },
    }],
    phases: [{ id: 'phase-1', project_id: 'project-1', visibility: 'published' }],
    requests: [],
    activities: [],
    members: [],
    profiles: new Map([
      ['consultant-1', { id: 'consultant-1', full_name: 'Consultant', email: 'consultant@example.com' }],
    ]),
    ...overrides,
  }
}

test('overdue request targets both the client and responsible consultant', () => {
  const result = selectDeadlineReminderCandidates(baseInput({
    requests: [{
      id: 'request-1', project_id: 'project-1', activity_id: null, name: 'Document', description: null,
      deadline_at: '2026-08-13T09:00:00.000Z', status: 'pending', visibility: 'published', is_outgoing: false,
      deleted_at: null, assigned_to: null, activity: null,
    }],
  }))
  assert.equal(result.candidates.length, 2)
  assert.deepEqual(result.candidates.map(candidate => candidate.recipientKind).sort(), ['client', 'consultant'])
})

test('missing consultant does not remove the overdue client candidate', () => {
  const result = selectDeadlineReminderCandidates(baseInput({
    projects: [{
      id: 'project-1', title: 'Proiect test', status: 'implementare', general_consultant_id: null,
      client: { id: 'client-1', full_name: 'Client', email: 'client@example.com' },
    }],
    requests: [{
      id: 'request-1', project_id: 'project-1', activity_id: null, name: 'Document', description: null,
      deadline_at: '2026-08-13T09:00:00.000Z', status: 'rejected', visibility: 'published', is_outgoing: false,
      deleted_at: null, assigned_to: null, activity: null,
    }],
  }))
  assert.equal(result.candidates.length, 1)
  assert.equal(result.candidates[0].recipientKind, 'client')
  assert.equal(result.failures[0].code, 'missing_recipient')
})

test('unassigned activity reaches every project member', () => {
  const result = selectDeadlineReminderCandidates(baseInput({
    members: [
      { project_id: 'project-1', consultant_id: 'consultant-1', profile: null },
      { project_id: 'project-1', consultant_id: 'consultant-2', profile: { id: 'consultant-2', full_name: 'Second', email: 'second@example.com' } },
    ],
    activities: [{
      id: 'activity-1', phase_id: 'phase-1', name: 'Activitate', description: null,
      deadline_at: '2026-08-15T09:00:00.000Z', status: 'in_progress', visibility: 'published', assigned_to: null,
    }],
  }))
  assert.equal(result.candidates.length, 2)
  assert.equal(result.failures.length, 0)
})

test('disabled project produces no automatic reminders for clients or consultants', () => {
  const result = selectDeadlineReminderCandidates(baseInput({
    projects: [{
      ...baseInput().projects[0],
      automatic_reminders_enabled: false,
    }],
    requests: [{
      id: 'request-1', project_id: 'project-1', activity_id: null, name: 'Document', description: null,
      deadline_at: '2026-08-13T09:00:00.000Z', status: 'pending', visibility: 'published', is_outgoing: false,
      deleted_at: null, assigned_to: null, activity: null,
    }],
    activities: [{
      id: 'activity-1', phase_id: 'phase-1', name: 'Activitate', description: null,
      deadline_at: '2026-08-15T09:00:00.000Z', status: 'in_progress', visibility: 'published', assigned_to: 'consultant-1',
    }],
  }))

  assert.equal(result.candidates.length, 0)
  assert.equal(result.failures.length, 0)
})

test('grupează notificările in-app pe proiect, păstrând proiectele distincte', () => {
  const groups = groupReminderCandidatesByProject([
    candidate({ projectId: 'project-2', entityId: 'request-2' }),
    candidate({ projectId: 'project-1' }),
  ])
  assert.deepEqual(groups.map(group => group.projectId), ['project-1', 'project-2'])
  assert.equal(groups[0].items.length, 1)
  assert.equal(groups[1].items.length, 1)
})

test('cheile rămân stabile indiferent de ordine sau retry', () => {
  const first = candidate()
  const second = candidate({ entityType: 'activity', entityId: 'activity-1', threshold: '1_day', days: 1 })
  assert.equal(
    buildReminderNotificationEventKey([first, second]),
    buildReminderNotificationEventKey([{ ...second }, { ...first }]),
  )
  assert.equal(
    buildReminderDigestIdempotencyKey([first, second]),
    buildReminderDigestIdempotencyKey([{ ...second }, { ...first }]),
  )
  const manyItems = Array.from({ length: 1000 }, (_, index) => candidate({
    entityId: `request-${index}`,
    deadlineAt: `2026-08-${String((index % 28) + 1).padStart(2, '0')}T09:00:00.000Z`,
  }))
  const eventKey = buildReminderNotificationEventKey(manyItems)
  assert.equal(eventKey.length, 'deadline-notification-v1-'.length + 64)
  assert.ok(eventKey.length < 256)
})

test('evenimentul in-app este egal pentru destinatari diferiți, dar digestul email rămâne separat', () => {
  const client = candidate({ recipientKind: 'client', recipientId: 'client-1' })
  const consultant = candidate({ recipientKind: 'consultant', recipientId: 'consultant-1' })
  assert.equal(
    buildReminderNotificationEventKey([client]),
    buildReminderNotificationEventKey([consultant]),
  )
  assert.notEqual(
    buildReminderDigestIdempotencyKey([client]),
    buildReminderDigestIdempotencyKey([consultant]),
  )
})

test('event key diferă la proiect, entitate, threshold sau deadline diferite', () => {
  const base = candidate()
  const variations = [
    { projectId: 'project-2' },
    { entityId: 'request-2' },
    { threshold: '1_day' },
    { deadlineAt: '2026-08-14T09:00:00.000Z' },
  ]
  for (const variation of variations) {
    assert.notEqual(
      buildReminderNotificationEventKey([base]),
      buildReminderNotificationEventKey([{ ...base, ...variation }]),
    )
  }
})

test('emailul cere păstrarea destinatarului logic în rezultatul notificării', () => {
  assert.equal(hasReminderRecipient(['client-1', 'admin-1'], 'client-1'), true)
  assert.equal(hasReminderRecipient(['admin-1'], 'client-1'), false)
})
