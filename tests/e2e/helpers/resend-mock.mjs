// Server local care imită API-ul Resend, pentru testele care verifică emailurile.
// Nu trimite nimic: scrie fiecare cerere într-un fișier JSONL și răspunde ca Resend.
//
//   node tests/e2e/helpers/resend-mock.mjs 4010 playwright-report/dovezi/resend.jsonl
//
// Aplicația se pornește cu RESEND_API_KEY=re_test_local și
// RESEND_BASE_URL=http://127.0.0.1:4010, iar suitele primesc
// E2E_RESEND_LOG=<același fișier>.
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const port = Number(process.argv[2] ?? 4010)
const file = process.argv[3] ?? path.join('playwright-report', 'dovezi', 'resend.jsonl')
fs.mkdirSync(path.dirname(file), { recursive: true })

http.createServer((request, response) => {
  let raw = ''
  request.on('data', chunk => { raw += chunk })
  request.on('end', () => {
    let body = null
    try {
      body = raw ? JSON.parse(raw) : null
    } catch {
      body = raw
    }
    fs.appendFileSync(file, JSON.stringify({
      at: new Date().toISOString(),
      method: request.method,
      path: request.url,
      idempotencyKey: request.headers['idempotency-key'] ?? null,
      body,
    }) + '\n')

    response.setHeader('Content-Type', 'application/json')
    if (request.url?.startsWith('/emails/batch')) {
      const emails = Array.isArray(body) ? body : []
      response.end(JSON.stringify({ data: emails.map(() => ({ id: randomUUID() })) }))
      return
    }
    response.end(JSON.stringify({ id: randomUUID() }))
  })
}).listen(port, '127.0.0.1', () => {
  console.log(`Resend de test pe http://127.0.0.1:${port}, emailurile în ${file}`)
})
