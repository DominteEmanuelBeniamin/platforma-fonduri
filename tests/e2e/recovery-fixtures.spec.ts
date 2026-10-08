import { randomUUID } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { e2eEnv, requireE2EConfig, serviceClient, setLocalFixturePassword } from './helpers/project-state'

const config = requireE2EConfig(e2eEnv())

test('reused fixtures and temporary-password markers accept transactionally prepared passwords', async () => {
  const service = serviceClient()!
  const original = 'Fixture-' + randomUUID()
  const email = 'issue107.fixture.' + randomUUID() + '@example.invalid'
  const creation = await service.auth.admin.createUser({ email, password: original, email_confirm: true })
  expect(creation.error).toBeNull()
  const id = creation.data.user!.id
  const anon = () => createClient(config.supabaseUrl, config.anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  try {
    const preflight = await service.rpc('recovery_preflight')
    expect(preflight.error).toBeNull()
    if (preflight.data.enabled) {
      expect((await service.auth.admin.updateUserById(id, { password: 'Forbidden-' + randomUUID() })).error).not.toBeNull()
    }
    const previous = anon()
    expect((await previous.auth.signInWithPassword({ email, password: original })).error).toBeNull()
    for (const selected of ["Fixture-'\\-$fixture$-" + randomUUID(), 'Reused-' + randomUUID()]) {
      setLocalFixturePassword(id, selected)
      expect((await anon().auth.signInWithPassword({ email, password: selected })).error).toBeNull()
    }
    expect((await anon().auth.signInWithPassword({ email, password: original })).error).not.toBeNull()
    expect((await previous.auth.refreshSession()).error).not.toBeNull()
    expect((await service.from('profiles').update({ must_change_password: true }).eq('id', id)).error).toBeNull()
    const temporary = 'Temporary-' + randomUUID()
    setLocalFixturePassword(id, temporary)
    expect((await anon().auth.signInWithPassword({ email, password: temporary })).error).toBeNull()
    expect((await service.from('profiles').select('must_change_password').eq('id', id).single()).data?.must_change_password).toBe(true)
  } finally {
    expect((await service.auth.admin.deleteUser(id)).error).toBeNull()
  }
})
