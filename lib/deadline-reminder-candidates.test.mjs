import test from 'node:test'
import assert from 'node:assert/strict'
import { selectDeadlineReminderCandidates } from './deadline-reminder-candidates.ts'

const now = new Date('2026-08-14T09:00:00.000Z')

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
