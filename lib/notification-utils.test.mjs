import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  buildAssignmentEmailIdempotencyKey,
  buildNotificationEventKey,
  buildManualReminderNotificationMetadata,
  buildPublicationEmailIdempotencyKey,
  buildPublicationNotificationMetadata,
  decodeNotificationCursor,
  encodeNotificationCursor,
  isUuid,
  isRealAssignmentChange,
  shouldReleaseClaimsAfterNotificationCleanup,
  selectEligibleNotificationRecipients,
} from './notification-utils.ts'

const projectId = '11111111-1111-4111-8111-111111111111'
const entityId = '22222222-2222-4222-8222-222222222222'
const notificationId = '33333333-3333-4333-8333-333333333333'
const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations')
const atomicityMigration = readFileSync(
  resolve(migrationsDir, '20260822000000_notification_atomicity.sql'),
  'utf8',
)
const fixesMigration = readFileSync(
  resolve(migrationsDir, '20260823000000_notification_center_fixes.sql'),
  'utf8',
)

test('helperul SQL folosește coloana event_key din schema notifications', () => {
  const columns = atomicityMigration.match(
    /insert into public\.notifications\s*\(([^)]*)\)\s*select/s,
  )?.[1]
  assert.ok(columns)
  assert.match(columns, /\bevent_key\b/)
  assert.doesNotMatch(columns, /\bnotification_event_key\b/)
  assert.match(atomicityMigration, /on conflict \(user_id, event_key\) do nothing/)
})

test('cheia notificării este stabilă și folosește cheia explicită când există', () => {
  const input = { projectId, type: 'assignment', entityType: 'activity', entityId }
  assert.equal(buildNotificationEventKey(input), `assignment:${projectId}:activity:${entityId}`)
  assert.equal(buildNotificationEventKey({ ...input, eventKey: '  activity-assigned:v1  ' }), 'activity-assigned:v1')
  assert.equal(buildNotificationEventKey(input), buildNotificationEventKey({ ...input }))
})

test('cheia de idempotență a emailului de assignment este stabilă și distinctă la reasignare', () => {
  const input = {
    projectId,
    entityType: 'activity',
    entityId,
    recipientId: notificationId,
    version: '2026-08-21T12:30:00.000Z',
  }
  const first = buildAssignmentEmailIdempotencyKey(input)
  assert.equal(first, buildAssignmentEmailIdempotencyKey({ ...input }))
  assert.notEqual(first, buildAssignmentEmailIdempotencyKey({ ...input, version: '2026-08-21T12:31:00.000Z' }))
  assert.notEqual(first, buildAssignmentEmailIdempotencyKey({ ...input, recipientId: entityId }))
  assert.match(first, /^assignment-email-v1-[0-9a-f]{64}$/)
})

test('trigger-ele de assignment folosesc o cheie deterministă, nu tranzacția curentă', () => {
  assert.doesNotMatch(fixesMigration, /txid_current\(\)/)
  const keys = fixesMigration.match(/'assignment-v1:%s:%s:%s:%s'/g) ?? []
  assert.equal(keys.length, 2)
  assert.equal(
    (fixesMigration.match(/coalesce\(old\.assigned_to::text, 'none'\)/g) ?? []).length,
    2,
  )
})

test('assignment produce eveniment doar pentru o schimbare nouă non-nullă', () => {
  assert.equal(isRealAssignmentChange(null, null), false)
  assert.equal(isRealAssignmentChange('consultant-1', 'consultant-1'), false)
  assert.equal(isRealAssignmentChange(null, 'consultant-1'), true)
  assert.equal(isRealAssignmentChange('consultant-1', 'consultant-2'), true)
  assert.equal(isRealAssignmentChange('consultant-1', null), false)
  assert.equal(isRealAssignmentChange(null, undefined), false)
})

test('cursorul păstrează perechea descrescătoare created_at/id și respinge date invalide', () => {
  const cursor = { createdAt: '2026-08-21T12:30:00.000Z', id: notificationId }
  const encoded = encodeNotificationCursor(cursor)
  assert.notEqual(encoded, JSON.stringify(cursor))
  assert.deepEqual(decodeNotificationCursor(encoded), cursor)
  assert.equal(decodeNotificationCursor('not-a-cursor'), null)
  assert.equal(
    decodeNotificationCursor(encodeNotificationCursor({ createdAt: 'not-a-date', id: notificationId })),
    null,
  )
  // `created_at` ajunge textual într-un filtru `or=(...)`, unde virgula separă
  // termenii. `Date.parse` citește „Jan 1, 2026”, PostgREST ar citi altceva.
  for (const createdAt of ['Jan 1, 2026', '2026-08-21T12:30:00.000Z,extra', '2026-08-21 12:30:00']) {
    assert.equal(
      decodeNotificationCursor(encodeNotificationCursor({ createdAt, id: notificationId })),
      null,
      createdAt,
    )
  }
  // Formele pe care le scrie chiar Postgres trec.
  for (const createdAt of ['2026-08-21T12:30:00Z', '2026-08-21T12:30:00.123456+00:00', '2026-08-21T12:30:00+03:00']) {
    assert.deepEqual(
      decodeNotificationCursor(encodeNotificationCursor({ createdAt, id: notificationId })),
      { createdAt, id: notificationId },
      createdAt,
    )
  }
})

test('metadata publication sortează elementele, iar digestul review-only nu produce publication', () => {
  const input = {
    projectId,
    clientId: '99999999-9999-4999-8999-999999999999',
    items: [
      { entityType: 'document_request', entityId },
      { entityType: 'phase', entityId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    ],
  }
  const reversed = buildPublicationNotificationMetadata({ ...input, items: [...input.items].reverse() })
  const metadata = buildPublicationNotificationMetadata(input)
  assert.deepEqual(metadata, reversed)
  assert.equal(metadata?.itemCount, 2)
  assert.deepEqual(metadata?.target, { entityType: 'project', entityId: projectId })
  assert.equal(buildPublicationNotificationMetadata({ ...input, items: [] }), null)
  assert.ok(buildPublicationEmailIdempotencyKey({
    ...input,
    items: [...input.items, { entityType: 'document_request', entityId: notificationId }],
  }).length < 256)
})

test('reminderul manual folosește aceeași cheie pentru același sendIndex și alta pentru următorul', () => {
  const base = {
    projectId,
    requestId: entityId,
    recipientId: notificationId,
    threshold: '3_days',
    deadlineAt: '2026-08-24T12:00:00.000Z',
  }
  const first = buildManualReminderNotificationMetadata({ ...base, sendIndex: 0 })
  const retry = buildManualReminderNotificationMetadata({ ...base, sendIndex: 0 })
  const later = buildManualReminderNotificationMetadata({ ...base, sendIndex: 1 })
  assert.deepEqual(first, retry)
  assert.notEqual(first.eventKey, later.eventKey)
  assert.notEqual(first.idempotencyKey, later.idempotencyKey)
  assert.ok(first.eventKey.length < 256)
  assert.ok(first.idempotencyKey.length < 256)
})

test('validarea UUID nu acceptă identificatori aproape validați', () => {
  assert.equal(isUuid(projectId), true)
  assert.equal(isUuid('11111111-1111-4111-8111-11111111111'), false)
  assert.equal(isUuid('project-id'), false)
})

test('claims sunt eliberate doar după compensarea rândurilor noi', () => {
  assert.equal(shouldReleaseClaimsAfterNotificationCleanup([], false), true)
  assert.equal(shouldReleaseClaimsAfterNotificationCleanup([notificationId], true), true)
  assert.equal(shouldReleaseClaimsAfterNotificationCleanup([notificationId], false), false)
})

test('destinatarii respectă membership-ul, clientul proiectului și adminii fără a elimina self', () => {
  const self = '44444444-4444-4444-8444-444444444444'
  const removedConsultant = '55555555-5555-4555-8555-555555555555'
  const projectClient = '66666666-6666-4666-8666-666666666666'
  const foreignClient = '77777777-7777-4777-8777-777777777777'
  const admin = '88888888-8888-4888-8888-888888888888'
  const profiles = [
    { id: self, role: 'consultant', is_active: true },
    { id: removedConsultant, role: 'consultant', is_active: true },
    { id: projectClient, role: 'client', is_active: true },
    { id: foreignClient, role: 'client', is_active: true },
    { id: admin, role: 'admin', is_active: true },
  ]

  assert.deepEqual(
    selectEligibleNotificationRecipients({
      projectClientId: projectClient,
      profiles,
      memberIds: [self],
      requestedIds: [self, removedConsultant, projectClient, foreignClient, admin],
      adminIds: [admin, admin],
      includeAdmins: true,
    }),
    [self, projectClient, admin],
  )

  assert.deepEqual(
    selectEligibleNotificationRecipients({
      projectClientId: projectClient,
      profiles,
      memberIds: [self],
      requestedIds: [],
      adminIds: [admin, admin],
      includeAdmins: true,
      fallbackToProjectMembers: true,
    }),
    [self, admin],
  )
})
