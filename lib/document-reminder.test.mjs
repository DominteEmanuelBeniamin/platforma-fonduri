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
