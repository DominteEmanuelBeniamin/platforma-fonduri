import { test, expect } from '@playwright/test'

// Rulează cu serverul local pornit cu NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321.
test.skip(process.env.E2E_MOCK_SUPABASE !== '1', 'necesită serverul local cu Supabase simulat')

test('Trimite documente deschide grupul restrâns și formularul', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!)
  expect(origin.hostname).toMatch(/^(localhost|127\.0\.0\.1)$/)
  await page.route('**/*', route => new URL(route.request().url()).origin === origin.origin ? route.continue() : route.abort())
  await page.routeWebSocket('**/*', ws => {
    if (new URL(ws.url()).host === origin.host) ws.connectToServer()
    else ws.close()
  })
  await page.addInitScript(() => {
    localStorage.setItem('sb-127-auth-token', JSON.stringify({
      access_token: 'local-test-token', refresh_token: 'local-test-refresh',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: 'user-1', aud: 'authenticated', role: 'authenticated' },
    }))
  })
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    const json = path === '/api/me' ? { profile: { id: 'user-1', role: 'admin' } }
      : path === '/api/projects/test-project' ? { project: { id: 'test-project', title: 'Proiect test', lifecycle_status: 'active' } }
      : path.endsWith('/phases') ? { phases: [] }
      : path.endsWith('/document-requests') ? { requests: [] }
      : { members: [], unreadCount: 0, unreadByProject: [] }
    return route.fulfill({ json })
  })
  await page.route('http://127.0.0.1:54321/**', route => route.abort())
  await page.goto('/projects/test-project')

  const group = page.locator('#phase-__trimise__')
  await group.getByRole('button', { name: 'Restrânge grupul Documente trimise clientului' }).click()
  await expect(group.getByRole('button', { name: 'Extinde grupul Documente trimise clientului' })).toHaveAttribute('aria-expanded', 'false')
  await group.getByRole('button', { name: 'Trimite documente' }).click()
  await expect(group.getByRole('button', { name: 'Restrânge grupul Documente trimise clientului' })).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('heading', { name: 'Trimite documente către client' })).toBeVisible()
})
