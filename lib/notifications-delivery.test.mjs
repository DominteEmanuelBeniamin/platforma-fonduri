import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import * as notificationUtils from './notification-utils.ts'
import * as reviewNotification from './review-notification.ts'

const nodeRequire = createRequire(import.meta.url)
const typescript = nodeRequire('typescript')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function loadTsModule(file, stubs) {
  const source = readFileSync(file, 'utf8')
  const output = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: file,
  }).outputText
  const loadedModule = { exports: {} }
  const localRequire = specifier => {
    if (Object.prototype.hasOwnProperty.call(stubs, specifier)) return stubs[specifier]
    return nodeRequire(specifier)
  }
  new Function('require', 'module', 'exports', output)(localRequire, loadedModule, loadedModule.exports)
  return loadedModule.exports
}

class NotificationQuery {
  constructor(db, table) {
    this.db = db
    this.table = table
    this.filters = []
    this.operation = 'select'
  }
  select() { return this }
  eq(column, value) { this.filters.push(row => row[column] === value); return this }
  in(column, values) { this.filters.push(row => values.includes(row[column])); return this }
  maybeSingle() { return Promise.resolve({ data: this.result()[0] ?? null, error: null }) }
  upsert(rows) {
    this.operation = 'upsert'
    this.db.upsertRows = rows
    this.db.profiles.find(profile => profile.id === this.db.deactivatedRecipient).is_active = false
    this.db.insertedRows = rows.filter(row =>
      this.db.profiles.find(profile => profile.id === row.user_id)?.is_active === true,
    ).map(row => {
      const saved = { ...row, id: '30000000-0000-4000-8000-000000000001' }
      this.db.notifications.push(saved)
      return saved
    })
    return this
  }
  result() {
    if (this.operation === 'upsert') return this.db.insertedRows.map(row => ({ id: row.id }))
    return (this.db[this.table] ?? []).filter(row => this.filters.every(filter => filter(row)))
  }
  then(resolve, reject) { return Promise.resolve({ data: this.result(), error: null }).then(resolve, reject) }
}

test('recordNotification returns only persisted active recipients after a concurrent deactivation', async () => {
  const inactiveRecipient = '10000000-0000-4000-8000-000000000001'
  const activePeer = '10000000-0000-4000-8000-000000000002'
  const projectId = '20000000-0000-4000-8000-000000000001'
  const db = {
    deactivatedRecipient: inactiveRecipient,
    projects: [{ id: projectId, client_id: null }],
    project_members: [
      { project_id: projectId, consultant_id: inactiveRecipient },
      { project_id: projectId, consultant_id: activePeer },
    ],
    profiles: [
      { id: inactiveRecipient, role: 'consultant', is_active: true, full_name: 'Va fi dezactivat' },
      { id: activePeer, role: 'consultant', is_active: true, full_name: 'Actor activ', email: 'active@example.test' },
    ],
    notifications: [],
  }
  const admin = { from: table => new NotificationQuery(db, table) }
  const notifications = loadTsModule(resolve(root, 'app/api/_utils/notifications.ts'), {
    '@/lib/notification-utils': notificationUtils,
  })

  const result = await notifications.recordNotification(admin, {
    projectId,
    type: 'assignment',
    entityType: 'activity',
    entityId: '20000000-0000-4000-8000-000000000002',
    title: 'Activitate atribuită',
    actorId: activePeer,
    entityLabel: 'Activitate',
    recipientIds: [inactiveRecipient, activePeer],
    includeAdmins: false,
  })

  assert.deepEqual(result.recipientIds, [activePeer])
  assert.deepEqual(result.insertedIds, ['30000000-0000-4000-8000-000000000001'])
  assert.deepEqual(db.upsertRows.map(row => row.actor_id), [activePeer, activePeer])
  assert.deepEqual(db.notifications.map(row => row.user_id), [activePeer])
})

test('notify-client undoes its claim if the insert guard skips a deactivated client', async () => {
  const clientId = '60000000-0000-4000-8000-000000000001'
  const actorId = '60000000-0000-4000-8000-000000000002'
  const projectId = '60000000-0000-4000-8000-000000000003'
  const phase = { id: '60000000-0000-4000-8000-000000000004', project_id: projectId, name: 'Fază publicată', visibility: 'published', client_notified_at: null }
  const calls = { sends: 0, notificationInputs: [], claimUpdates: [] }
  const tables = { project_phases: [phase] }
  const admin = {
    from(table) {
      const state = { filters: [], update: null, selected: '' }
      const builder = {
        select(value = '') { state.selected = value; return builder },
        eq(column, value) { state.filters.push(row => row[column] === value); return builder },
        in(column, values) { state.filters.push(row => values.includes(row[column])); return builder },
        is(column, value) { state.filters.push(row => row[column] === value); return builder },
        update(values) { state.update = values; calls.claimUpdates.push(values); return builder },
        result() {
          if (table === 'projects') return [{ id: projectId, title: 'Proiect', client: { id: clientId, full_name: null, email: 'client@example.test', is_active: true } }]
          if (table === 'profiles') return [{ is_active: true }]
          const rows = tables[table] ?? []
          const matched = rows.filter(row => state.filters.every(filter => filter(row)))
          if (state.update) for (const row of matched) Object.assign(row, state.update)
          return state.selected ? matched.map(row => ({ ...row })) : []
        },
        maybeSingle() { return Promise.resolve({ data: builder.result()[0] ?? null, error: null }) },
        then(resolve, reject) { return Promise.resolve({ data: builder.result(), error: null }).then(resolve, reject) },
      }
      return builder
    },
  }
  class Resend {
    constructor() {
      this.emails = { send: async () => { calls.sends += 1; return { error: null } } }
    }
  }
  const route = loadTsModule(resolve(root, 'app/api/projects/[id]/notify-client/route.ts'), {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    resend: { Resend },
    '@/app/api/_utils/auth': {
      requireProjectAccess: async () => ({ ok: true, user: { id: actorId }, profile: { id: actorId, role: 'admin', email: 'admin@example.test' } }),
    },
    '@/app/api/_utils/audit': { logAction: async () => {} },
    '@/app/api/_utils/notifications': {
      recordNotification: async (...args) => {
        calls.notificationInputs.push(args[1])
        return { recipientIds: [], insertedIds: [] }
      },
      deleteNotificationsByIds: async () => ({ deleted: 0 }),
    },
    '@/app/api/_utils/supabase': { createSupabaseServiceClient: () => admin },
    '@/app/api/_utils/email': {
      escapeHtml: value => value,
      resendFromAddress: () => 'test@example.test',
      sanitizeHeaderText: value => value,
    },
    '@/lib/client-visibility': nodeRequire(resolve(root, 'lib/client-visibility.js')),
    '@/lib/notification-utils': notificationUtils,
    '@/lib/review-notification': reviewNotification,
  })

  const response = await route.POST(
    new Request('http://localhost/api/projects/x/notify-client', { method: 'POST' }),
    { params: Promise.resolve({ id: projectId }) },
  )

  const responseBody = await response.json()
  assert.equal(response.status, 409, JSON.stringify(responseBody))
  assert.equal(phase.client_notified_at, null)
  assert.equal(calls.sends, 0)
  assert.equal(calls.notificationInputs[0].actorId, actorId)
  assert.equal(calls.claimUpdates.length, 2)
  assert.notEqual(calls.claimUpdates[0].client_notified_at, null)
  assert.equal(calls.claimUpdates[1].client_notified_at, null)
})

test('assignment emails recheck recipients per provider batch, omit inactive users and keep active peers', async () => {
  const ids = Array.from({ length: 102 }, (_, index) =>
    '70000000-0000-4000-8000-' + String(index + 1).padStart(12, '0'),
  )
  const profiles = ids.map(id => ({
    id,
    full_name: 'Consultant',
    email: id + '@example.test',
    is_active: true,
  }))
  let queryNumber = 0
  const sentBatches = []
  const admin = {
    from(table) {
      assert.equal(table, 'profiles')
      let requestedIds = []
      const builder = {
        select() { return builder },
        in(_column, values) { requestedIds = values; return builder },
        then(resolve, reject) {
          queryNumber += 1
          if (queryNumber === 2) profiles[0].is_active = false
          if (queryNumber === 3) profiles[101].is_active = false
          const data = profiles.filter(profile => requestedIds.includes(profile.id))
            .map(profile => ({ ...profile }))
          return Promise.resolve({ data, error: null }).then(resolve, reject)
        },
      }
      return builder
    },
  }
  class Resend {
    constructor() {
      this.batch = {
        send: async emails => {
          sentBatches.push(emails.map(email => email.to))
          return { error: null }
        },
      }
    }
  }
  const emailModule = loadTsModule(resolve(root, 'app/api/_utils/activity-assignment-email.ts'), {
    resend: { Resend },
    './supabase': { createSupabaseServiceClient: () => admin },
    './email': {
      escapeHtml: value => value,
      resendFromAddress: () => 'test@example.test',
      sanitizeHeaderText: value => value,
    },
  })
  const items = ids.map((consultantId, index) => ({
    consultantId,
    activityName: 'Activitate ' + index,
    phaseName: 'Fază',
    projectId: '70000000-0000-4000-8000-000000000200',
    projectTitle: 'Proiect',
    deadlineAt: null,
    idempotencyKey: 'assignment-' + index,
  }))

  await emailModule.sendActivityAssignedEmails(items)

  assert.equal(sentBatches.length, 2)
  assert.equal(sentBatches[0].length, 99)
  assert.equal(sentBatches[0].includes(ids[0] + '@example.test'), false)
  assert.equal(sentBatches[1].length, 1)
  assert.equal(sentBatches[1][0], ids[100] + '@example.test')
  assert.equal(sentBatches[1].includes(ids[101] + '@example.test'), false)
})
