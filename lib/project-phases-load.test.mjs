import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { isClientVisibleActivity, isClientVisiblePhase } from './client-visibility.js'

function route(role, phases, activities, failure = null) {
  const calls = []
  const admin = { from(table) {
    const query = { select() { return this }, eq() { return this }, in(key, ids) { calls.push({ key, ids }); return this },
      order() { return table === 'project_phases' ? Promise.resolve({ data: phases, error: null }) : this },
      range(from, to) { return Promise.resolve({ data: activities.slice(from, to + 1), error: failure }) } }
    return query
  } }
  const modules = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@supabase/supabase-js': { createClient: () => admin },
    '@/app/api/_utils/auth': { requireProjectAccess: async () => ({ ok: true, access: { role } }) },
    '@/app/api/_utils/audit': {}, '@/lib/slug': {}, '@/lib/completion': {},
    '@/lib/client-visibility': { isClientVisibleActivity, isClientVisiblePhase },
  }
  const source = ts.transpileModule(fs.readFileSync('app/api/projects/[id]/phases/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports = {}
  new Function('require', 'exports', source)(name => { assert.ok(name in modules, name); return modules[name] }, exports)
  return { get: () => exports.GET(new Request('http://localhost/'), { params: Promise.resolve({ id: 'project' }) }), calls }
}

test('loads all phase activities in one query and retains grouping and order', async () => {
  const r = route('admin', [{ id: 'a' }, { id: 'b' }], [{ id: 'b1', phase_id: 'b' }, { id: 'a1', phase_id: 'a' }, { id: 'a2', phase_id: 'a' }])
  const body = await (await r.get()).json()
  assert.deepEqual(r.calls, [{ key: 'phase_id', ids: ['a', 'b'] }])
  assert.deepEqual(body.phases.map(p => p.activities.map(a => a.id)), [['a1', 'a2'], ['b1']])
})
test('empty project avoids the activity query', async () => {
  const r = route('admin', [], [])
  assert.deepEqual(await (await r.get()).json(), { phases: [] })
  assert.equal(r.calls.length, 0)
})
test('large projects retain activities beyond the API row limit', async () => {
  const activities = Array.from({ length: 1001 }, (_, i) => ({ id: String(i), phase_id: 'a' }))
  const r = route('admin', [{ id: 'a' }], activities)
  const body = await (await r.get()).json()
  assert.equal(body.phases[0].activities.length, 1001)
  assert.equal(r.calls.length, 2)
})
test('batched loading still hides drafts and completion authors from clients', async () => {
  const r = route('client', [{ id: 'a', visibility: 'published', completed_by: 'private' }, { id: 'b', visibility: 'draft' }], [
    { id: 'a1', phase_id: 'a', visibility: 'published', completed_by: 'private' },
    { id: 'a2', phase_id: 'a', visibility: 'draft' },
  ])
  const body = await (await r.get()).json()
  assert.equal(body.phases.length, 1)
  assert.deepEqual(body.phases[0].activities.map(a => a.id), ['a1'])
  assert.equal(JSON.stringify(body).includes('private'), false)
})
