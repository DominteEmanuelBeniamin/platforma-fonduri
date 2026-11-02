import assert from 'node:assert/strict'
import test from 'node:test'
import { createRouteLoader } from '../scripts/issue-110-route-loader.mjs'

const fileId = '20000000-0000-4000-8000-000000000001'
const actorId = '20000000-0000-4000-8000-000000000002'

function route({ readable = true, fileSize = 2048, blobSize = 2048, sentToday = 0, sendError = null, delivery = 'ok', senderEmail = 'ana@bonie.ro' } = {}) {
  const sent = [], audit = [], reads = []
  const file = { id: fileId, storage_path: 'projects/p/f.pdf', original_name: 'Certificat.pdf', mime_type: 'application/pdf', file_size: fileSize }
  const admin = {
    from(table) {
      const query = {
        select() { return query }, eq() { return query }, gte() { return query },
        then(resolve) { resolve({ count: sentToday, error: null }) },
        async maybeSingle() { return { data: table === 'profiles' ? { full_name: 'Ana Popescu', email: senderEmail } : null, error: null } },
      }
      return query
    },
    storage: { from: () => ({ async download() { reads.push('storage'); return { data: new Blob([new Uint8Array(blobSize)]), error: null } } }) },
  }
  const load = createRouteLoader({
    'app/api/_utils/file-access.ts': {
      async readableFile() {
        reads.push('file')
        return readable
          ? { ok: true, value: { access: { user: { id: actorId }, profile: { role: 'client', email: senderEmail } }, file, fileName: 'Certificat.pdf', projectId: 'p', projectTitle: 'Agro Verde', requirementName: 'Certificat de urbanism' } }
          : { ok: false, response: Response.json({ error: 'File not found' }, { status: 404 }) }
      },
    },
    'app/api/_utils/supabase.ts': { createSupabaseServiceClient: () => admin },
    'app/api/_utils/audit.ts': { logAction: async entry => audit.push(entry) },
    'app/api/_utils/email.ts': {
      escapeHtml: value => value, sanitizeHeaderText: value => value, resendFromAddress: () => 'Bonie <notificari@bonie.ro>',
      resolveReminderDelivery: email => delivery === 'ok'
        ? { ok: true, data: { intendedEmail: email, deliveryEmail: email, overridden: false } }
        : { ok: false, error: { code: 'configuration', message: 'x' } },
    },
    resend: { Resend: class { emails = { send: async email => { sent.push(email); return sendError ? { data: null, error: sendError } : { data: { id: 'msg-1' }, error: null } } } } },
  })
  const { POST } = load('app/api/files/[fileId]/email/route.ts')
  const call = body => POST(new Request('http://127.0.0.1/api/files/x/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), { params: Promise.resolve({ fileId }) })
  return { call, sent, audit, reads }
}

const valid = { to: 'registratura@anaf.ro, contabil@firma.ro', subject: 'Certificat de urbanism', message: 'Bună ziua,\nvă transmit documentul.', copyToMe: true }

test('bad recipients or subject are refused before the file is read', async () => {
  for (const body of [{ ...valid, to: '' }, { ...valid, to: 'anaf' }, { ...valid, subject: ' ' }, { ...valid, message: 7 }]) {
    const api = route()
    assert.equal((await api.call(body)).status, 400)
    assert.deepEqual(api.reads, [])
  }
})

test('whoever cannot read the file cannot email it', async () => {
  const api = route({ readable: false })
  assert.equal((await api.call(valid)).status, 404)
  assert.equal(api.sent.length, 0)
})

test('files over 25 MB and senders over the daily limit get a clear refusal, nothing is sent', async () => {
  for (const [options, status] of [[{ fileSize: 30 * 1024 * 1024 }, 413], [{ fileSize: null, blobSize: 26 * 1024 * 1024 }, 413], [{ sentToday: 30 }, 429], [{ delivery: 'off' }, 503]]) {
    const api = route(options)
    assert.equal((await api.call(valid)).status, status)
    assert.equal(api.sent.length, 0)
    assert.equal(api.audit.length, 0)
  }
})

test('the email carries the file as an attachment, replies go to the sender who also gets a copy', async () => {
  const api = route()
  const response = await api.call(valid)
  assert.equal(response.status, 200)
  const [email] = api.sent
  assert.deepEqual(email.to, ['registratura@anaf.ro', 'contabil@firma.ro'])
  assert.deepEqual(email.cc, ['ana@bonie.ro'])
  assert.equal(email.replyTo, 'ana@bonie.ro')
  assert.equal(email.subject, 'Certificat de urbanism')
  assert.equal(email.attachments[0].filename, 'Certificat.pdf')
  assert.equal(email.attachments[0].content.length, 2048)
  assert.match(email.text, /^Bună ziua,\nvă transmit documentul\./)
  assert.equal(api.audit[0].actionType, 'email_send')
  assert.deepEqual(api.audit[0].newValues.recipients, ['registratura@anaf.ro', 'contabil@firma.ro'])
})

test('without a copy the sender is only the reply address; a provider refusal is not audited as sent', async () => {
  const quiet = route()
  await quiet.call({ ...valid, copyToMe: false })
  assert.equal(quiet.sent[0].cc, undefined)
  const refused = route({ sendError: { message: 'invalid' } })
  assert.equal((await refused.call(valid)).status, 502)
  assert.equal(refused.audit.length, 0)
})

function attachmentRoute({ readable = true } = {}) {
  const sent = [], audit = [], asked = []
  const admin = {
    from() {
      const query = { select() { return query }, eq() { return query }, gte() { return query }, then(resolve) { resolve({ count: 0, error: null }) }, async maybeSingle() { return { data: { full_name: 'Mihai Ionescu', email: 'mihai@bonie.ro' }, error: null } } }
      return query
    },
    storage: { from: () => ({ async download() { return { data: new Blob([new Uint8Array(512)]), error: null } } }) },
  }
  const load = createRouteLoader({
    'app/api/_utils/attachment-access.ts': {
      async readableAttachment(_request, requestId, attachmentId) {
        asked.push([requestId, attachmentId])
        return readable
          ? { ok: true, value: { access: { user: { id: actorId }, profile: { role: 'consultant', email: 'mihai@bonie.ro' } }, requestId, attachmentId, path: 'templates/attachments/model.pdf', fileName: 'Model plan de afaceri.pdf', missingAt: null, projectId: 'p', projectTitle: 'Agro Verde', requestName: 'Plan de afaceri (model)', isOutgoing: true } }
          : { ok: false, response: Response.json({ error: 'Document request not found' }, { status: 404 }) }
      },
    },
    'app/api/_utils/supabase.ts': { createSupabaseServiceClient: () => admin },
    'app/api/_utils/audit.ts': { logAction: async entry => audit.push(entry) },
    'app/api/_utils/email.ts': {
      escapeHtml: value => value, sanitizeHeaderText: value => value, resendFromAddress: () => 'Bonie <notificari@bonie.ro>',
      resolveReminderDelivery: email => ({ ok: true, data: { intendedEmail: email, deliveryEmail: email, overridden: false } }),
    },
    resend: { Resend: class { emails = { send: async email => { sent.push(email); return { data: { id: 'msg-2' }, error: null } } } } },
  })
  const { POST } = load('app/api/document-requests/[requestId]/attachment/email/route.ts')
  const call = body => POST(new Request('http://127.0.0.1/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), { params: Promise.resolve({ requestId: 'req-1' }) })
  return { call, sent, audit, asked }
}

test('a model or a document sent to the client goes out the same way, with its own name', async () => {
  const api = attachmentRoute()
  const response = await api.call({ ...valid, attachment_id: 'att-1' })
  assert.equal(response.status, 200)
  assert.deepEqual(api.asked, [['req-1', 'att-1']])
  assert.equal(api.sent[0].attachments[0].filename, 'Model plan de afaceri.pdf')
  assert.equal(api.sent[0].replyTo, 'mihai@bonie.ro')
  assert.equal(api.audit[0].entityType, 'document_request')
  assert.equal(api.audit[0].newValues.attachment_id, 'att-1')
})

test('an attachment the sender cannot see is not sent, and a bad form is refused before looking it up', async () => {
  const hidden = attachmentRoute({ readable: false })
  assert.equal((await hidden.call(valid)).status, 404)
  assert.equal(hidden.sent.length, 0)
  const typo = attachmentRoute()
  assert.equal((await typo.call({ ...valid, to: 'anaf' })).status, 400)
  assert.deepEqual(typo.asked, [])
})
