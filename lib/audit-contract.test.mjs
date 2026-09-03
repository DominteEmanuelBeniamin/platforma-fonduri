import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { auditContractProblems } from './audit-contract-checks.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

async function readText(relativePath) {
  return readFile(join(root, relativePath), 'utf8')
}

async function readTextIfExists(relativePath) {
  try {
    return await readText(relativePath)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

async function sourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await sourceFiles(path))
    else if (/\.(?:[cm]?[jt]sx?)$/.test(entry.name)) files.push(path)
  }
  return files
}

function skipTrivia(source, start) {
  let cursor = start
  while (cursor < source.length) {
    if (/\s/.test(source[cursor])) {
      cursor += 1
      continue
    }
    if (source.startsWith('//', cursor)) {
      const lineEnd = source.indexOf('\n', cursor + 2)
      cursor = lineEnd < 0 ? source.length : lineEnd + 1
      continue
    }
    if (source.startsWith('/*', cursor)) {
      const commentEnd = source.indexOf('*/', cursor + 2)
      cursor = commentEnd < 0 ? source.length : commentEnd + 2
      continue
    }
    break
  }
  return cursor
}

function callEnd(source, start) {
  if (source[start] !== '(') return -1
  let depth = 0
  let quote = null
  for (let cursor = start; cursor < source.length; cursor += 1) {
    const character = source[cursor]
    if (quote) {
      if (character === '\\') cursor += 1
      else if (character === quote) quote = null
      continue
    }
    if (character === '\'' || character === '"' || character === '`') {
      quote = character
      continue
    }
    if (source.startsWith('//', cursor)) {
      const lineEnd = source.indexOf('\n', cursor + 2)
      cursor = lineEnd < 0 ? source.length : lineEnd
      continue
    }
    if (source.startsWith('/*', cursor)) {
      const commentEnd = source.indexOf('*/', cursor + 2)
      cursor = commentEnd < 0 ? source.length : commentEnd + 1
      continue
    }
    if (character === '(') depth += 1
    if (character === ')' && --depth === 0) return cursor + 1
  }
  return -1
}

function auditChainHasMutation(source, tableName) {
  const escapedTableName = tableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const from = new RegExp(`\\.from\\s*\\(\\s*['"]${escapedTableName}['"]\\s*\\)`, 'g')

  for (const match of source.matchAll(from)) {
    let cursor = match.index + match[0].length
    while (cursor < source.length) {
      cursor = skipTrivia(source, cursor)
      if (source[cursor] !== '.') break
      cursor = skipTrivia(source, cursor + 1)
      const methodStart = cursor
      while (/[$\w]/.test(source[cursor] ?? '')) cursor += 1
      const method = source.slice(methodStart, cursor)
      cursor = skipTrivia(source, cursor)
      if (source[cursor] !== '(') break
      if (method === 'delete' || method === 'update') return true
      cursor = callEnd(source, cursor)
      if (cursor < 0) break
    }
  }
  return false
}

function hasPublishClassification(source) {
  const normalized = source.replace(/\s+/g, ' ')
  const direct = /(?:actionType\s*:\s*|(?:const|let|var)\s+\w+\s*=\s*)visibility\s*===\s*['"]published['"]\s*\?\s*['"]publish['"]\s*:\s*['"]update['"]/.test(normalized)
  if (direct) return true

  const named = normalized.match(/(?:const|let|var)\s+(\w+)\s*=\s*visibility\s*===\s*['"]published['"]\s*\?\s*['"]publish['"]\s*:\s*['"]update['"]/)
  if (named) {
    const action = new RegExp(`actionType\\s*:\\s*${named[1]}\\b`)
    if (action.test(normalized)) return true
  }

  // Also allow a named boolean used by the log call, while keeping the
  // publish/update choice tied to the visibility transition.
  const flag = normalized.match(/(?:const|let|var)\s+(\w*(?:publish|publishing)\w*)\s*=\s*visibility\s*===\s*['"]published['"]/i)
  if (flag) {
    const choice = new RegExp(`actionType\\s*:\\s*${flag[1]}\\s*\\?\\s*['"]publish['"]\\s*:\\s*['"]update['"]`)
    if (choice.test(normalized)) return true
  }

  return false
}

test('catalogul audit are etichetele obligatorii în română', async () => {
  const { AUDIT_ACTION_LABELS, AUDIT_ENTITY_LABELS } = await import('./audit-catalog.ts')

  const requiredActions = {
    login: 'Autentificare',
    logout: 'Deconectare',
    create: 'Creare',
    add: 'Adăugare',
    update: 'Modificare',
    publish: 'Publicare',
    propagate: 'Propagare',
    delete: 'Ștergere',
    download: 'Descărcare',
    notify: 'Notificare',
    deadline_reminder_digest: 'Digest de remindere',
  }
  const requiredEntities = {
    file: 'Fișier',
    phase_reorder: 'Reordonare faze',
    activity_reorder: 'Reordonare activități',
    document_request_reorder: 'Reordonare cereri de documente',
  }

  for (const [key, label] of Object.entries(requiredActions)) {
    assert.equal(AUDIT_ACTION_LABELS[key], label, `etichetă acțiune: ${key}`)
  }
  for (const [key, label] of Object.entries(requiredEntities)) {
    assert.equal(AUDIT_ENTITY_LABELS[key], label, `etichetă entitate: ${key}`)
  }
  for (const [key, label] of Object.entries({ ...AUDIT_ACTION_LABELS, ...AUDIT_ENTITY_LABELS })) {
    assert.equal(typeof label, 'string', `etichetă text: ${key}`)
    assert.ok(label.trim(), `etichetă nevidă: ${key}`)
  }
})

test('contractul audit nu expune rute sau mutații de ștergere', async () => {
  assert.equal(existsSync(join(root, 'app/api/audit/[id]/route.ts')), false)

  const apiFiles = await sourceFiles(join(root, 'app/api'))
  for (const file of apiFiles) {
    const source = await readFile(file, 'utf8')
    assert.equal(
      auditChainHasMutation(source, 'audit_logs'),
      false,
      `${file} mută audit_logs`,
    )
  }

  const legacyPath = 'app/api/projects/[id]/activities/[activityId]/documents/route.ts'
  const legacy = await readTextIfExists(legacyPath)
  if (legacy !== null) {
    assert.equal(auditChainHasMutation(legacy, 'project_activities'), false)
  }
})

test('rutele PATCH clasifică publicarea după vizibilitate și păstrează update', async () => {
  const routes = [
    'app/api/projects/[id]/phases/[phaseId]/route.ts',
    'app/api/projects/[id]/phases/[phaseId]/activities/[activityId]/route.ts',
    'app/api/document-requests/[requestId]/route.ts',
  ]

  for (const route of routes) {
    const source = await readText(route)
    assert.match(source, /visibility\s*===\s*['"]published['"]/, `${route}: tranziție publish`)
    assert.equal(hasPublishClassification(source), true, `${route}: clasificare publish/update`)
    assert.match(source, /logAction\s*\(/, `${route}: audit după PATCH`)
  }
})

test('migrarea audit append-only protejează update și delete pe fiecare rând', async () => {
  const migrationDir = join(root, 'supabase/migrations')
  const migrations = (await readdir(migrationDir))
    .filter(name => /_audit_logs_append_only\.sql$/i.test(name))
    .sort()
  assert.ok(migrations.length, 'lipsește migrarea audit_logs append-only')

  const texts = await Promise.all(migrations.map(name => readFile(join(migrationDir, name), 'utf8')))
  assert.ok(texts.some(text => {
    const normalized = text.replace(/\s+/g, ' ')
    return /before\s+update\s+or\s+delete\s+on\s+public\.audit_logs/i.test(normalized)
      && /for\s+each\s+row/i.test(normalized)
      && /raise\s+exception/i.test(normalized)
      && /append.only|restrict_violation|prevent_audit_logs_mutation/i.test(normalized)
  }), 'migrarea nu descrie protecția append-only')
})

/**
 * Contractul de mai jos e chiar ce a întors `public.audit_logs_contract()` pe un
 * Postgres 15 în care au fost aplicate migrările `20260902000000` (append-only)
 * și `20260903000000` (probele), peste un `audit_logs` cu structura din
 * producție. Nu e scris de mână: dacă funcția își schimbă forma, testele astea
 * trebuie reînnoite din DB, nu ajustate până trec.
 */
const REAL_CONTRACT = {
  "columns": [
    {
      "name": "id",
      "type": "uuid",
      "nullable": false
    },
    {
      "name": "user_id",
      "type": "uuid",
      "nullable": true
    },
    {
      "name": "action_type",
      "type": "text",
      "nullable": false
    },
    {
      "name": "entity_type",
      "type": "text",
      "nullable": false
    },
    {
      "name": "entity_id",
      "type": "uuid",
      "nullable": true
    },
    {
      "name": "entity_name",
      "type": "text",
      "nullable": true
    },
    {
      "name": "old_values",
      "type": "jsonb",
      "nullable": true
    },
    {
      "name": "new_values",
      "type": "jsonb",
      "nullable": true
    },
    {
      "name": "description",
      "type": "text",
      "nullable": true
    },
    {
      "name": "ip_address",
      "type": "text",
      "nullable": true
    },
    {
      "name": "user_agent",
      "type": "text",
      "nullable": true
    },
    {
      "name": "created_at",
      "type": "timestamp with time zone",
      "nullable": true
    }
  ],
  "indexes": [
    "audit_logs_pkey",
    "idx_audit_logs_action_created",
    "idx_audit_logs_created",
    "idx_audit_logs_entity",
    "idx_audit_logs_user_created"
  ],
  "table_exists": true,
  "append_only_trigger": {
    "before": true,
    "enabled": true,
    "on_delete": true,
    "on_update": true,
    "row_level": true
  }
}

test('contractul real, citit din Postgres, nu produce nicio problemă', () => {
  assert.deepEqual(auditContractProblems(REAL_CONTRACT), [])
})

test('lipsurile structurale sunt raportate una câte una', () => {
  assert.deepEqual(auditContractProblems({ table_exists: false }), ['public.audit_logs nu există'])
  assert.deepEqual(auditContractProblems(null), ['contractul audit nu a putut fi citit'])

  const faraIndex = {
    ...REAL_CONTRACT,
    indexes: REAL_CONTRACT.indexes.filter(name => name !== 'idx_audit_logs_created'),
  }
  assert.deepEqual(auditContractProblems(faraIndex), [
    'indexuri lipsă pe public.audit_logs: idx_audit_logs_created',
  ])

  const faraColoana = {
    ...REAL_CONTRACT,
    columns: REAL_CONTRACT.columns.filter(column => column.name !== 'old_values'),
  }
  assert.deepEqual(auditContractProblems(faraColoana), [
    'coloane lipsă în public.audit_logs: old_values',
  ])
})

test('tipul și nullability fiecărei coloane fac parte din contract', () => {
  const entityIdText = {
    ...REAL_CONTRACT,
    columns: REAL_CONTRACT.columns.map(column => (
      column.name === 'entity_id' ? { ...column, type: 'text' } : column
    )),
  }
  assert.deepEqual(auditContractProblems(entityIdText), [
    'coloana public.audit_logs.entity_id are tipul text; așteptat uuid',
  ])

  const createdAtNotNull = {
    ...REAL_CONTRACT,
    columns: REAL_CONTRACT.columns.map(column => (
      column.name === 'created_at' ? { ...column, nullable: false } : column
    )),
  }
  assert.deepEqual(auditContractProblems(createdAtNotNull), [
    'coloana public.audit_logs.created_at este NOT NULL; așteptat nullable',
  ])

  const contractIncomplet = {
    ...REAL_CONTRACT,
    columns: REAL_CONTRACT.columns.map(column => (
      column.name === 'user_id' ? { name: column.name } : column
    )),
  }
  assert.deepEqual(auditContractProblems(contractIncomplet), [
    'coloana public.audit_logs.user_id are tipul undefined; așteptat uuid',
    'coloana public.audit_logs.user_id este undefined; așteptat nullable',
  ])
})

test('un trigger prezent, dar cu contractul greșit, nu trece', () => {
  // Cazul care contează: un trigger care există și pare în regulă la o
  // verificare de prezență, dar e AFTER și doar pe UPDATE — deci nu apără nimic.
  const slab = {
    ...REAL_CONTRACT,
    append_only_trigger: { row_level: true, before: false, on_update: true, on_delete: false, enabled: true },
  }
  assert.deepEqual(auditContractProblems(slab), [
    'triggerul audit_logs_append_only nu respectă contractul (lipsește: BEFORE, ON DELETE)',
  ])

  const dezactivat = { ...REAL_CONTRACT, append_only_trigger: { ...REAL_CONTRACT.append_only_trigger, enabled: false } }
  assert.deepEqual(auditContractProblems(dezactivat), [
    'triggerul audit_logs_append_only nu respectă contractul (lipsește: activat)',
  ])

  assert.deepEqual(auditContractProblems({ ...REAL_CONTRACT, append_only_trigger: null }), [
    'triggerul audit_logs_append_only lipsește de pe public.audit_logs',
  ])
})
