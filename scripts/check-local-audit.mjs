// Run with npm run dev and the demo seed: node scripts/check-local-audit.mjs
import assert from 'node:assert/strict'
import nextEnv from '@next/env'
import { createClient } from '@supabase/supabase-js'

nextEnv.loadEnvConfig(process.cwd())
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const app = process.env.SEED_APP_URL || 'http://localhost:3000'
for (const value of [url, app]) assert.ok(['127.0.0.1', 'localhost'].includes(new URL(value).hostname), 'Local endpoints only')
const client = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const { data, error } = await client.auth.signInWithPassword({
  email: process.argv[2] || 'admin@test.local', password: process.argv[3] || 'Parola123!',
})
assert.equal(error, null, error?.message)
try {
  for (const query of ['page=1&limit=30', 'page=1&limit=100', 'user_id=00000000-0000-0000-0000-000000000000']) {
    const response = await fetch(`${app}/api/audit?${query}`, {
      headers: { Authorization: `Bearer ${data.session.access_token}` },
    })
    const body = await response.json()
    assert.equal(response.status, 200, body.error)
    assert.ok(Array.isArray(body.logs))
    for (const log of body.logs) {
      assert.ok(Object.hasOwn(log, 'user'))
      if (log.user) assert.equal(log.user.id, log.user_id)
    }
    if (query.startsWith('user_id=')) assert.equal(body.logs.length, 0)
  }
  console.log('Audit API: pagina, exportul si filtrul fara rezultate raspund cu HTTP 200.')
} finally {
  await client.auth.signOut({ scope: 'local' })
}
