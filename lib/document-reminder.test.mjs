import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getDaysUntilDeadline,
  getManualReminderType,
  getReminderType,
  sameReminderDeadline,
} from './document-reminder.ts'
import { renderReminderDigest } from './reminder-email.ts'

const now = new Date('2026-08-13T09:00:00.000Z')

function deadlineAfter(days) {
  const date = new Date(now)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString()
}

test('uses the canonical reminder boundaries', () => {
  assert.equal(getReminderType(deadlineAfter(8), now), null)
  assert.equal(getReminderType(deadlineAfter(7), now), '1_week')
  assert.equal(getReminderType(deadlineAfter(3), now), '3_days')
  assert.equal(getReminderType(deadlineAfter(2), now), '3_days')
  assert.equal(getReminderType(deadlineAfter(1), now), '1_day')
  assert.equal(getReminderType(deadlineAfter(0), now), 'same_day')
  assert.equal(getReminderType(deadlineAfter(-1), now), 'overdue')
  assert.equal(getManualReminderType(deadlineAfter(8), now), '1_week')
})

test('counts calendar days across the Bucharest DST transition', () => {
  const beforeDst = new Date('2026-03-28T22:30:00.000Z')
  const nextLocalDay = '2026-03-29T22:30:00.000Z'
  assert.equal(getDaysUntilDeadline(nextLocalDay, beforeDst), 1)
})

test('a changed deadline rearms the schedule even within the same threshold', () => {
  const fourDays = deadlineAfter(4)
  const fiveDays = deadlineAfter(5)
  assert.equal(getReminderType(fourDays, now), '1_week')
  assert.equal(getReminderType(fiveDays, now), '1_week')
  assert.equal(sameReminderDeadline(fourDays, fiveDays), false)
  assert.equal(sameReminderDeadline(fourDays, '2026-08-17T12:00:00+03:00'), true)
})

test('email renderer uses actual days remaining and escaped deep links', () => {
  const content = renderReminderDigest({
    audience: 'client',
    recipientName: null,
    dashboardUrl: 'https://example.com',
    items: [{
      entityType: 'request',
      entityId: 'request-id',
      name: '<Document test>',
      description: null,
      deadlineAt: deadlineAfter(2),
      projectTitle: 'Proiect test',
      threshold: '3_days',
      days: 2,
      url: 'https://example.com/projects/project-id?document=a&x=1',
    }],
  })
  assert.match(content.subject, /2 zile/)
  assert.match(content.text, /2 zile/)
  assert.match(content.html, /&lt;Document test&gt;/)
  assert.match(content.html, /&amp;x=1/)
  assert.doesNotMatch(content.text + content.html, /Reminder 3 zile/)
  assert.doesNotMatch(content.text + content.html, /expirat/i)
})

function reminderEmailItem(overrides = {}) {
  return {
    entityType: 'request',
    entityId: 'request-id',
    name: 'Document test',
    description: null,
    deadlineAt: deadlineAfter(2),
    projectTitle: 'Proiect test',
    threshold: '3_days',
    days: 2,
    url: 'https://example.com/projects/project-id?document=request-id',
    ...overrides,
  }
}

test('email renderer uses correct Romanian deadline wording in subject, text, and html', () => {
  const cases = [
    { days: 0, threshold: 'same_day', wording: 'termenul este astăzi', subjectWording: 'termenul este astăzi' },
    { days: 1, threshold: '1_day', wording: 'mai este o zi', subjectWording: 'mai este o zi' },
    { days: 2, threshold: '3_days', wording: 'mai sunt 2 zile', subjectWording: 'mai sunt 2 zile' },
    { days: -1, threshold: 'overdue', wording: 'termen depășit cu o zi', subjectWording: 'cu o zi' },
    { days: -2, threshold: 'overdue', wording: 'termen depășit cu 2 zile', subjectWording: 'cu 2 zile' },
  ]

  for (const reminder of cases) {
    const content = renderReminderDigest({
      audience: 'client',
      recipientName: null,
      dashboardUrl: 'https://example.com',
      items: [reminderEmailItem({
        deadlineAt: deadlineAfter(reminder.days),
        threshold: reminder.threshold,
        days: reminder.days,
      })],
    })

    assert.ok(content.subject.includes(reminder.subjectWording), reminder.subjectWording)
    assert.ok(content.text.includes(reminder.wording), reminder.wording)
    assert.ok(content.html.includes(reminder.wording), reminder.wording)
    if (reminder.threshold === 'overdue') {
      assert.ok(content.subject.includes(`— ${reminder.subjectWording} —`), content.subject)
      assert.equal((content.subject.match(/termen depășit/gi) ?? []).length, 1)
    }
  }
})

test('email renderer uses singular and plural introductions', () => {
  const clientSingle = renderReminderDigest({
    audience: 'client',
    recipientName: null,
    dashboardUrl: 'https://example.com',
    items: [reminderEmailItem()],
  })
  assert.match(clientSingle.text, /Aveți un document care necesită atenție\./)
  assert.match(clientSingle.html, /Aveți un document care necesită atenție\./)

  const clientPlural = renderReminderDigest({
    audience: 'client',
    recipientName: null,
    dashboardUrl: 'https://example.com',
    items: [reminderEmailItem(), reminderEmailItem({ entityId: 'request-id-2', name: 'Al doilea document' })],
  })
  assert.match(clientPlural.text, /Aveți 2 documente care necesită atenție\./)
  assert.match(clientPlural.html, /Aveți 2 documente care necesită atenție\./)

  const consultantSingle = renderReminderDigest({
    audience: 'consultant',
    recipientName: null,
    dashboardUrl: 'https://example.com',
    items: [reminderEmailItem({ entityType: 'activity', threshold: '3_days' })],
  })
  assert.match(consultantSingle.text, /Ai un element de gestionat\./)
  assert.match(consultantSingle.html, /Ai un element de gestionat\./)

  const consultantPlural = renderReminderDigest({
    audience: 'consultant',
    recipientName: null,
    dashboardUrl: 'https://example.com',
    items: [
      reminderEmailItem({ entityType: 'activity' }),
      reminderEmailItem({ entityType: 'activity', entityId: 'activity-id-2', name: 'A doua activitate' }),
    ],
  })
  assert.match(consultantPlural.text, /Ai 2 elemente de gestionat\./)
  assert.match(consultantPlural.html, /Ai 2 elemente de gestionat\./)
})
