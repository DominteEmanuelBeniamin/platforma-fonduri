import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// A separate capture server verifies the same endpoints used by the local inbox.
test('local inbox lists single and batch emails without logging reads', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bonie-inbox-'))
  const log = path.join(dir, 'emails.jsonl')
  const child = spawn(process.execPath, ['tests/e2e/helpers/resend-mock.mjs', '0', log], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Capture server startup timed out')), 10000)
      child.on('error', reject)
      child.stdout.on('data', chunk => {
        const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/)
        if (match) { clearTimeout(timer); resolve(match[0]) }
      })
    })
    const send = (route, body) => fetch(url + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const first = await send('/emails', { to: 'one@example.invalid', subject: '<b>Text only</b>', html: '<p>Hello</p>', text: 'Hello' })
    assert.ok((await first.json()).id)
    const batch = await send('/emails/batch', [{ to: 'two@example.invalid', subject: 'Batch 1' }, { to: 'three@example.invalid', subject: 'Batch 2' }])
    assert.equal((await batch.json()).data.length, 2)
    const response = await fetch(url + '/api/emails')
    assert.equal(response.headers.get('cache-control'), 'no-store')
    const rows = await response.json()
    assert.deepEqual(rows.map(row => row.body.subject), ['Batch 2', 'Batch 1', '<b>Text only</b>'])
    assert.equal(rows[2].body.text, 'Hello')
    const page = await fetch(url)
    assert.match(await page.text(), /Emailuri locale/)
    assert.equal(fs.readFileSync(log, 'utf8').trim().split('\n').length, 2)
  } finally {
    child.kill()
    await new Promise(resolve => child.once('exit', resolve))
    if (fs.existsSync(log)) fs.unlinkSync(log)
    fs.rmdirSync(dir)
  }
})
