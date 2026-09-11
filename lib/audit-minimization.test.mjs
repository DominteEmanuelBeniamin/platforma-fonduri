import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import http from 'node:http'
import test from 'node:test'

import {
  logChatMessageAction,
  logProjectAction,
  logUserAction,
  sanitizeAuditPayload,
  sanitizeAuditText,
  truncatePayload,
} from '../app/api/_utils/audit.ts'
import { logReminderDigestAudit } from '../app/api/_utils/reminder-audit.ts'

test('redactarea recursivă elimină conținutul și datele sensibile', () => {
  const clean = sanitizeAuditPayload({
    role: 'client',
    full_name: 'Ana Popescu',
    fullname: 'Ana Popescu',
    nume: 'Ana Popescu',
    password: 'secret',
    signedUrl: 'https://signed.example/file?token=secret',
    accessToken: 'token-value',
    profile: {
      body: 'mesaj privat',
      email: 'user@example.com',
      telefon: '+40123456789',
      iban: 'RO00BANK',
      address: 'Strada Secretă 1',
      bank_account: '123',
      nested: {
        content: 'secret content',
        image_names: ['invoice.pdf'],
        locator: {
          original_name: 'invoice.pdf',
          attachmentOriginalName: 'invoice.pdf',
          storagePath: 'projects/project-id/invoice.pdf',
          attachment_path: 'projects/project-id/invoice.pdf',
          file_path: 'projects/project-id/invoice.pdf',
          image_path: 'projects/project-id/invoice.pdf',
          relativePath: 'invoice.pdf',
          name: 'ordinary business name',
          path: 'ordinary/business/path',
        },
      },
    },
    items: [{ preview: 'preview', project_id: 'project-id' }],
    description: 'free text description',
    comments: 'free text comments',
    notes: 'free text notes',
    observatii: 'free text observations',
    reviewReason: 'free text reason',
  })

  assert.deepEqual(clean, {
    role: 'client',
    password: '[redacted]',
    signedUrl: '[redacted]',
    accessToken: '[redacted]',
    profile: { nested: { locator: { name: 'ordinary business name', path: 'ordinary/business/path' } } },
    items: [{ project_id: 'project-id' }],
  })
  assert.equal(clean.full_name, undefined)
  assert.equal(clean.fullname, undefined)
  assert.equal(clean.nume, undefined)
  assert.equal(clean.description, undefined)
  assert.equal(clean.comments, undefined)
  assert.equal(clean.notes, undefined)
  assert.equal(clean.observatii, undefined)
  assert.equal(clean.reviewReason, undefined)
})

test('payloadurile trunchiate nu păstrează preview-ul JSON', () => {
  const clean = truncatePayload({ details: 'x'.repeat(40_000) })
  assert.equal(clean?._truncated, true)
  assert.equal('_preview' in clean, false)
  assert.equal(typeof clean?._original_size, 'number')
})

test('descrierile maschează adresele de email și tokenurile', () => {
  const clean = sanitizeAuditText(
    'Admin user@example.com a folosit Bearer eyJheader.payload.signature',
  )
  assert.equal(clean, 'Admin [email redacted] a folosit Bearer [token redacted]')
  assert.equal(clean.includes('user@example.com'), false)
})

async function fakePostgrest() {
  const state = { rows: [] }
  const server = http.createServer((request, response) => {
    let body = ''
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      const payload = body ? JSON.parse(body) : null
      state.rows.push(...(Array.isArray(payload) ? payload : [payload]))
      response.writeHead(201, { 'Content-Type': 'application/json' })
      response.end('[]')
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
  return { state, close: () => new Promise(resolve => server.close(resolve)) }
}

test('wrapperele legacy folosesc aceeași cale auditRow', async () => {
  const { state, close } = await fakePostgrest()
  try {
    await logUserAction({
      adminId: 'admin-id', actionType: 'create', userId: 'user-id', userEmail: 'user@example.com',
      newValues: { email: 'user@example.com', role: 'client' }, description: 'user@example.com a creat utilizatorul',
      ipAddress: '127.0.0.1', userAgent: 'test',
    })
    await logProjectAction({
      adminId: 'admin-id', actionType: 'create', projectId: 'project-id', projectTitle: 'Project',
      newValues: { client_email: 'user@example.com', title: 'Project' }, description: 'user@example.com a creat proiectul',
      ipAddress: '127.0.0.1', userAgent: 'test',
    })
    await logChatMessageAction({
      actorId: 'admin-id', actionType: 'create', projectId: 'project-id', messageId: 'message-id',
      messagePreview: 'mesajul nu trebuie păstrat', newValues: { body_preview: 'mesajul nu trebuie păstrat' },
      description: 'user@example.com a trimis un mesaj', ipAddress: '127.0.0.1', userAgent: 'test',
    })

    assert.equal(state.rows.length, 3)
    assert.equal(state.rows[0].entity_name, 'user:user-id')
    assert.equal(state.rows[0].new_values.email, undefined)
    assert.equal(state.rows[1].new_values.client_email, undefined)
    assert.equal(state.rows[2].entity_name, 'message:message-id')
    assert.equal(state.rows[2].new_values.body_preview, undefined)
    assert.equal(state.rows[2].description, '[email redacted] a trimis un mesaj')
  } finally {
    await close()
  }
})

test('auditul reminderelor nu păstrează numele elementelor', async () => {
  const { state, close } = await fakePostgrest()
  try {
    const error = await logReminderDigestAudit({
      from: () => ({
        insert: async payload => {
          state.rows.push(payload)
          return { error: null }
        },
      }),
    }, {
      runId: 'run-id',
      providerId: null,
      recipientId: 'recipient-id',
      recipientEmail: 'recipient@example.com',
      recipientKind: 'client',
      deliveryOverridden: false,
      items: [{
        entityType: 'activity',
        entityId: 'activity-id',
        projectId: 'project-id',
        projectTitle: 'Project',
        name: 'Titlu cu date personale',
        description: null,
        deadlineAt: '2026-09-12T00:00:00.000Z',
        threshold: 'due_soon',
        days: 1,
        recipientId: 'recipient-id',
        recipientEmail: 'recipient@example.com',
        recipientName: null,
        recipientKind: 'client',
        url: '/activity/activity-id',
      }],
    })

    assert.equal(error, null)
    assert.equal(state.rows.length, 1)
    assert.equal(state.rows[0].new_values.items[0].name, undefined)
  } finally {
    await close()
  }
})

test('accesul la fișiere este identificator-only și nu reține locatorii', () => {
  const source = readFileSync(new URL('../app/api/files/[fileId]/signed-download/route.ts', import.meta.url), 'utf8')
  assert.match(source, /entityName:\s*`file:\$\{fileId\}`/)
  assert.match(source, /description:\s*`\$\{inline \? 'Vizualizare' : 'Descarcare'\} fisier`/)
  assert.doesNotMatch(source, /entityName:\s*getDownloadName/)
  assert.doesNotMatch(source, /storage_path:\s*typedFileRow\.storage_path/)
  assert.doesNotMatch(source, /project_title|document_request_name|projectTitle|requirementName/)

  const bulkSource = readFileSync(new URL('../app/api/files/bulk-archive/route.ts', import.meta.url), 'utf8')
  assert.match(bulkSource, /entityName:\s*`file:\$\{entry\.id\}`/)
  assert.match(bulkSource, /description:\s*'Descarcare fisiere in arhiva'/)
  assert.doesNotMatch(bulkSource, /entityName:\s*entry\.entryName/)
  assert.doesNotMatch(bulkSource, /storage_path:\s*entry\.storage_path/)
  assert.doesNotMatch(bulkSource, /zip_name:\s*zipFileName/)
  assert.doesNotMatch(bulkSource, /description:\s*`Descarcare in arhiva \$\{zipFileName\}/)
})
