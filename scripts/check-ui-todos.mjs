// Cu Supabase local, datele seed și npm run dev: node scripts/check-ui-todos.mjs
// Toate cererile API din browser sunt simulate; publicarea nu scrie în bază.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import nextEnv from '@next/env'
import { createClient } from '@supabase/supabase-js'
import { chromium, expect } from '@playwright/test'

nextEnv.loadEnvConfig(process.cwd())
const app = process.env.SEED_APP_URL || 'http://localhost:3000'
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
for (const endpoint of [app, url]) assert.ok(['localhost', '127.0.0.1'].includes(new URL(endpoint).hostname), 'Doar endpointuri locale')
const auth = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const { data, error } = await auth.auth.signInWithPassword({ email: process.argv[2] || 'admin@test.local', password: process.argv[3] || 'Parola123!' })
assert.equal(error, null, error?.message)
const { data: ownProfile, error: profileError } = await auth.from('profiles').select('role, consultant_level').eq('id', data.user.id).single()
assert.equal(profileError, null, profileError?.message)
assert.equal(ownProfile.role, 'admin', 'Testul folosește contul admin de test')
const storageKey = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`
const phase = { id: 'todo-phase', name: 'Publicitate proiect', project_status_id: 'todo-status', visibility: 'published', order_index: 1, activities: [{ id: 'todo-activity', name: 'Proiect depus', description: 'Descriere proiect', visibility: 'published', order_index: 1, document_requirements: [{ id: 'todo-doc' }] }] }
const template = { id: 'todo-template', name: 'Șablon '.repeat(8) + 'X'.repeat(80), description: 'Descriere lungă pentru proiect. '.repeat(15), status: 'draft', phases: [phase] }
const browser = await chromium.launch()
fs.mkdirSync('test-results', { recursive: true })

try {
  for (const [role, consultant_level, allowed] of [['admin', 'junior', true], ['consultant', 'senior', true], ['consultant', 'junior', false], ['client', 'junior', false]]) {
    const context = await browser.newContext({ baseURL: app, viewport: { width: 1440, height: 900 } })
    await context.addInitScript(({ storageKey, session }) => localStorage.setItem(storageKey, JSON.stringify(session)), { storageKey, session: data.session })
    const page = await context.newPage()
    let releaseProfile
    const ready = new Promise(resolve => { releaseProfile = resolve })
    let formRequests = 0
    let published = false
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/api/**', async route => {
      const { pathname } = new URL(route.request().url())
      let body = {}
      if (pathname === '/api/me') {
        await ready
        body = { profile: { id: data.user.id, role, consultant_level } }
      } else if (pathname === '/api/admin/templates') {
        formRequests++
        body = { templates: [{ ...template, status: published ? 'published' : 'draft' }, { ...template, id: 'todo-published', name: 'Publicat', status: 'published', unpropagated_changes_at: '2026-10-01T12:00:00Z' }] }
      } else if (pathname === '/api/clients' || pathname === '/api/users') {
        formRequests++
        body = { clients: [], users: [] }
      } else if (pathname === '/api/admin/statuses') {
        body = { statuses: [{ id: 'todo-status', name: 'Implementare', color: '#0E4C4A' }] }
      } else if (pathname === '/api/admin/templates/todo-template' && route.request().method() === 'PATCH') {
        assert.deepEqual(route.request().postDataJSON(), { status: 'published' })
        published = true
        body = { template: { ...template, status: 'published' } }
      } else if (pathname === '/api/projects/todo-project') {
        body = { project: { id: 'todo-project', title: 'Proiect de test' } }
      } else if (pathname === '/api/projects/todo-project/phases') {
        body = { phases: [phase] }
      } else if (pathname === '/api/projects/todo-project/document-requests') {
        body = { requests: [{ id: 'todo-doc', name: 'Ghid de implementare', description: 'Document pentru proiect', activity_id: 'todo-activity', project_id: 'todo-project', status: 'pending', visibility: 'published', documents: [] }] }
      }
      await route.fulfill({ json: body })
    })
    try {
      await page.goto('/projects/new', { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('status').filter({ hasText: 'Se verifică accesul la dosarul nou' })).toBeVisible()
      assert.equal(await page.getByRole('heading', { name: 'Dosar nou', exact: true }).count(), 0, 'Formularul nu apare înaintea profilului')
      assert.equal(formRequests, 0, 'Datele formularului așteaptă drepturile')
      releaseProfile()
      if (allowed) {
        await expect(page.getByRole('heading', { name: 'Dosar nou', exact: true })).toBeVisible()
        await page.waitForLoadState('networkidle')
        assert.equal(new URL(page.url()).pathname, '/projects/new')
      } else {
        await page.waitForURL(url => url.pathname === '/')
        assert.equal(await page.getByRole('heading', { name: 'Dosar nou', exact: true }).count(), 0)
        assert.equal(formRequests, 0, 'Un cont fără drepturi nu cere datele formularului')
      }
      console.log(`Dosar nou: ${role}/${consultant_level}, fără flash; acces ${allowed ? 'permis' : 'refuzat'}.`)
      if (role !== 'admin') continue

      await page.goto('/admin')
      await expect(page).toHaveURL(/\/admin\/templates$/)
      const nav = page.getByRole('navigation', { name: 'Navigare principală' }).getByRole('link', { name: 'Șabloane', exact: true })
      await expect(nav).toHaveAttribute('href', '/admin/templates')
      const publish = page.getByRole('button', { name: `Publică șablonul ${template.name}`, exact: true })
      await expect(publish).toBeVisible()
      await page.getByRole('button', { name: `Arată fazele — ${template.name}`, exact: true }).click()
      for (const width of [320, 390, 768, 1023, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        const overflow = await page.locator('main table').evaluate(table => ({ width: table.clientWidth, scroll: table.scrollWidth }))
        assert.ok(overflow.scroll <= overflow.width + 1, `Tabelul nu derulează la ${width}px: ${JSON.stringify(overflow)}`)
        for (const action of ['Editează', 'Publică', 'Duplică', 'Șterge']) {
          const box = await page.getByRole('button', { name: `${action} șablonul ${template.name}`, exact: true }).boundingBox()
          assert.ok(box && box.x >= 0 && box.x + box.width <= width, `${action} rămâne în ecran la ${width}px`)
        }
        if (width === 390 || width === 1440) await page.screenshot({ path: `test-results/ui-todos-${width}.png`, fullPage: true })
      }
      await page.getByRole('button', { name: `Editează șablonul ${template.name}`, exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Editează șablonul', exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Renunță', exact: true }).click()
      await publish.click()
      const confirmation = page.getByRole('dialog')
      await expect(confirmation).toBeVisible()
      await confirmation.getByPlaceholder('aproba', { exact: true }).fill('aproba')
      await confirmation.getByRole('button', { name: /^Aprobă/ }).click()
      await expect(publish).toHaveCount(0)
      assert.ok(published, 'Bifa publică șablonul prin PATCH')
      console.log('Șabloane: editare și publicare din meniu, fără derulare laterală la 320–1440px.')

      await page.goto('/projects/todo-project')
      await page.getByRole('button', { name: 'Caută în proiect', exact: true }).click()
      async function checkHighlight() {
        const dialog = page.getByRole('dialog')
        await dialog.getByRole('textbox').fill('pro')
        await expect(dialog.locator('mark').first()).toBeVisible()
        const marks = await dialog.locator('mark').evaluateAll(elements => elements.map(element => ({ text: element.textContent, fg: getComputedStyle(element).color, bg: getComputedStyle(element).backgroundColor })))
        assert.ok(marks.length >= 2, 'Sunt evidențiate titlul și descrierea')
        for (const mark of marks) {
          assert.equal(mark.text.toLowerCase(), 'pro')
          assert.notEqual(mark.fg, mark.bg, 'Textul evidențiat se distinge de fundal')
          assert.equal(mark.fg, 'rgb(138, 90, 8)')
          assert.equal(mark.bg, 'rgb(244, 235, 220)')
        }
        await dialog.getByRole('button', { name: 'Închide', exact: true }).click()
      }
      await checkHighlight()
      await page.getByRole('button', { name: 'Chat', exact: true }).click()
      await page.getByRole('button', { name: 'Inserează link intern', exact: true }).click()
      await checkHighlight()
      console.log('Highlight: text vizibil în titluri și descrieri, în căutarea proiectului și a chatului.')
      assert.deepEqual(errors, [], 'Fără erori de pagină')
    } finally {
      releaseProfile()
      await context.close()
    }
  }
} finally {
  await browser.close()
  await auth.auth.signOut({ scope: 'local' })
}
