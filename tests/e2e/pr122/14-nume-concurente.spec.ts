import { test, expect } from './fixtures'
import { anon, config, q, seedTemplate, sql, sqlJson, tag } from './support'

for (const operation of ['create', 'rename', 'tree', 'duplicate'] as const) {
  test(`numele șabloanelor rămân unice la ${operation} concurent`, async ({ team, seeds }) => {
    const auth = anon()
    const { data, error } = await auth.auth.signInWithPassword({ email: team.admin.email, password: team.admin.password })
    if (error || !data.session) throw error ?? new Error('Missing test session')
    const headers = { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' }
    const name = `E2E122 concurență ${tag()}`
    const templates: Awaited<ReturnType<typeof seedTemplate>>[] = []
    for (let i = 0; i < 2; i++) {
      const template = await seedTemplate({ label: `sursă ${tag()}`, phases: [] })
      seeds.templates.add(template.id)
      templates.push(template)
    }
    const calls = templates.map((template, i) => {
      const url = operation === 'create' ? '/api/admin/templates'
        : operation === 'duplicate' ? `/api/admin/templates/${templates[0].id}/duplicate`
          : `/api/admin/templates/${template.id}${operation === 'tree' ? '/tree' : ''}`
      const body = operation === 'create' ? { name, slug: `concurrent-${tag()}-${i}` }
        : operation === 'tree' ? { name, phases: [{ id: `new-phase-${i}`, name: 'Faza nouă', activities: [] }] }
          : { name }
      return fetch(new URL(url, config.baseUrl), {
        method: operation === 'rename' ? 'PATCH' : operation === 'tree' ? 'PUT' : 'POST',
        headers, body: JSON.stringify(body),
      }).then(async response => ({ status: response.status, body: await response.json() }))
    })
    const results = await Promise.all(calls)
    for (const result of results) if (result.body.template?.id) seeds.templates.add(result.body.template.id)
    if (operation === 'duplicate') {
      expect(results.map(r => r.status)).toContain(201)
      expect(results.every(r => r.status === 201 || r.status === 409), JSON.stringify(results)).toBe(true)
      const copies = sqlJson<{ id: string; name: string }[]>(`select coalesce(json_agg(json_build_object('id', id, 'name', name)), '[]') from project_templates where slug like (select slug || '-copy%' from project_templates where id=${q(templates[0].id)})`)
      for (const copy of copies) seeds.templates.add(copy.id)
      expect(new Set(copies.map(copy => copy.name)).size).toBe(copies.length)
    } else {
      expect(results.map(r => r.status).sort(), JSON.stringify(results)).toEqual([operation === 'create' ? 201 : 200, 409])
      expect(Number(sql(`select count(*) from project_templates where name=${q(name)}`))).toBe(1)
      const loser = results.findIndex(r => r.status === 409)
      expect(results[loser].body.code).toBe('template_name_taken')
      if (operation === 'tree') expect(Number(sql(`select count(*) from template_phases where template_id=${q(templates[loser].id)}`))).toBe(0)
    }
  })
}
