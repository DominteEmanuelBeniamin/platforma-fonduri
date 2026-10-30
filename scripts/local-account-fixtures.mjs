// Privileged test bootstrap only; never import this module into application code.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

/** The reset and development commands target only this project's local stack. */
export function assertLocalStack(env) {
  assert.notEqual(env.NODE_ENV, 'production', 'Local commands refuse production')
  assert.ok(!env.VERCEL_ENV || env.VERCEL_ENV === 'development', 'Local commands refuse hosted environments')
  const urls = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'].map(key => {
    assert.ok(env[key], 'Missing local configuration: ' + key)
    const url = new URL(env[key])
    assert.ok(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      && url.port === '54321' && url.pathname === '/' && !url.username && !url.password && !url.search && !url.hash,
    key + ' must use the local Supabase stack on port 54321')
    return url.origin
  })
  assert.equal(urls[0], urls[1], 'Server and browser must use the same local Supabase')
}

export function localFixtureDatabase(name = 'postgres') {
  assert.ok(name === 'postgres' || /^issue110_phase5_[a-f0-9]{12}$/.test(name), 'Unexpected local fixture database')
  return name
}

/** Stable synthetic CUI with a valid checksum for a fixture identity. */
export function fixtureCif(identity) {
  const hash = createHash('sha256').update(identity).digest().readUInt32BE(0)
  const body = String(100_000_000 + hash % 900_000_000)
  const sum = [...body].reduce((total, digit, i) => total + Number(digit) * Number('753217532'[i]), 0)
  const check = sum * 10 % 11
  return 'RO' + body + (check === 10 ? 0 : check)
}

/** Finish exactly one local fixture in the same UPDATE as its role and CIF. */
export async function finalizeLocalFixture(service, id, profile) {
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(service.supabaseUrl).hostname), 'Fixture bootstrap requires local Supabase')
  assert.ok(['admin', 'consultant', 'client'].includes(profile.role), 'Explicit fixture role required')
  const result = await service.from('profiles').update({
    ...profile,
    ...(profile.role === 'client' ? { cif: profile.cif ?? fixtureCif(id) } : {}),
    creation_pending: false, is_active: true,
  }).eq('id', id).select('id,role,cif,creation_pending,is_active').single()
  assert.equal(result.error, null, 'Local fixture profile: ' + (result.error?.code || ''))
  assert.equal(result.data.id, id)
  assert.equal(result.data.creation_pending, false)
  assert.equal(result.data.is_active, true)
  return result.data
}
