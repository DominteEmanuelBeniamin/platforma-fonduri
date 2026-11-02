import assert from 'node:assert/strict'
import test from 'node:test'

import { parseEmailRecipients } from './email-recipients.ts'

test('recipients can be separated by comma, semicolon, space or new line', () => {
  assert.deepEqual(parseEmailRecipients('contabil@firma.ro, registratura@anaf.ro;  banca@bt.ro\nalt@x.ro'), {
    ok: true, emails: ['contabil@firma.ro', 'registratura@anaf.ro', 'banca@bt.ro', 'alt@x.ro'],
  })
  assert.deepEqual(parseEmailRecipients('<ion@firma.ro>'), { ok: true, emails: ['ion@firma.ro'] })
})

test('the same address is sent once, whatever its case', () => {
  assert.deepEqual(parseEmailRecipients('Ion@Firma.ro, ion@firma.ro'), { ok: true, emails: ['ion@firma.ro'] })
})

test('empty, invalid and too many recipients are refused with a readable reason', () => {
  assert.equal(parseEmailRecipients('  ').ok, false)
  assert.equal(parseEmailRecipients(null).ok, false)
  assert.deepEqual(parseEmailRecipients('ion@firma.ro, anaf'), { ok: false, message: '„anaf” nu e o adresă de email validă.' })
  assert.equal(parseEmailRecipients('a@x.ro b@x.ro c@x.ro d@x.ro e@x.ro f@x.ro').ok, false)
})
