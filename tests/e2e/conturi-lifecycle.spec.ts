import { randomUUID } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { test, expect } from '@playwright/test'
import { createClient, type SupabaseClient, type RealtimeChannel } from '@supabase/supabase-js'
import {
  e2eEnv, requireE2EConfig, serviceClient, createTemporaryProject,
  destroyTemporaryProject, verifyServerUsesFixture, registerCreatedActivity, registerCreatedRequest,
  type TemporaryProjectFixture,
} from './helpers/project-state'

const config = requireE2EConfig(e2eEnv())
// This suite exercises Auth and DDL-dependent security on the dedicated local stack.
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.supabaseUrl).hostname)) {
  throw new Error('Lifecycle acceptance requires explicitly local Supabase')
}
const service = serviceClient()!
const stamp = randomUUID().slice(0, 8)
const password = `Issue105-${stamp}-2026!`
type Person = { id: string; email: string; token: string; refreshToken: string; client: SupabaseClient }
let actor: Person, junior: Person, customer: Person, empty: Person
let fixture: TemporaryProjectFixture | undefined
const people: Person[] = []
let storageProbePath = ''
let actorNotificationId = ''
let conversationId = '', templateId = '', defaultActivityId = '', nullActivityId = ''
const importProjects = new Set<string>()
const inactiveEvents: string[] = [], activeEvents: string[] = []
const channels: Array<{ client: SupabaseClient; channel: RealtimeChannel }> = []

function sql(query: string) {
  return execFileSync('docker', ['exec', 'supabase_db_platforma-fonduri', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-At', '-c', query], { encoding: 'utf8', windowsHide: true }).trim()
}
function concurrentSql(query: string) {
  const child = spawn('docker', ['exec', 'supabase_db_platforma-fonduri', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-At', '-c', query], { windowsHide: true })
  let output = ''
  child.stdout.on('data', chunk => { output += String(chunk) })
  child.stderr.on('data', chunk => { output += String(chunk) })
  return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', code => resolve({ code, output }))
  })
}
async function waitForSqlTrue(query: string) {
  await expect.poll(() => sql(query), { timeout: 8_000 }).toBe('t')
}
function client(token?: string) {
  return createClient(config.supabaseUrl, config.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    ...(token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {}),
  })
}
async function signIn(email: string, pass: string): Promise<Person> {
  const userClient = client()
  const { data, error } = await userClient.auth.signInWithPassword({ email, password: pass })
  if (error || !data.session) throw new Error('Fixture sign-in failed: ' + (error?.message ?? 'missing session'))
  return { id: data.user.id, email, token: data.session.access_token, refreshToken: data.session.refresh_token, client: client(data.session.access_token) }
}
async function person(role: 'client' | 'consultant' | 'admin') {
  const email = `issue105.${stamp}.${role}.${people.length}@example.invalid`
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) throw new Error('Fixture account creation failed')
  const update = await service.from('profiles').update({ role, full_name: 'Issue 105 ' + role, consultant_level: 'junior' }).eq('id', data.user.id)
  if (update.error) throw update.error
  const result = await signIn(email, password)
  people.push(result)
  return result
}
async function call(who: Person, method: string, path: string, body?: unknown) {
  const response = await fetch(config.baseUrl + path, {
    method, headers: { Authorization: 'Bearer ' + who.token, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: response.status, json: await response.json().catch(() => ({})) }
}
async function lifecycle(who: Person, action: 'deactivate' | 'reactivate') {
  const response = await call(actor, 'POST', `/api/users/${who.id}/${action}`)
  expect(response.status, JSON.stringify(response.json)).toBe(200)
  expect(response.json.profile.is_active).toBe(action === 'reactivate')
  expect(response.json.authSynced).toBe(true)
  return response.json
}
async function notification(userId: string, actorId = actor.id) {
  const row = { id: randomUUID(), user_id: userId, project_id: fixture!.projectId,
    type: 'document_action', entity_type: 'activity', entity_id: fixture!.activityId,
    title: 'Issue 105 realtime probe', event_key: 'issue105:' + randomUUID(), actor_id: actorId, actor_name: 'Issue 105 snapshot' }
  const result = await service.from('notifications').insert(row)
  if (result.error) throw result.error
  return row.id
}
async function subscribe(who: Person, received: string[]) {
  await who.client.realtime.setAuth(who.token)
  const channel = who.client.channel(`issue105-${stamp}-${who.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${who.id}` }, event => {
      received.push(event.eventType)
    })
  channels.push({ client: who.client, channel })
  await new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('Realtime postgres changes did not start')), 20_000)
    channel.on('system', {}, message => {
      if (message.status === 'ok' && message.extension === 'postgres_changes') { clearTimeout(deadline); resolve() }
    }).subscribe(status => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(deadline); reject(new Error('Realtime subscription failed')) }
    })
  })
}
async function updateNotification(id: string) {
  const title = 'Issue 105 probe ' + randomUUID()
  const result = await service.from('notifications').update({ title }).eq('id', id).select('id, title').single()
  if (result.error) throw result.error
  expect(result.data.title).toBe(title)
}

test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)
test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 })
test.beforeAll(async () => {
  actor = await signIn(config.staffEmail, config.staffPassword)
  expect((await call(actor, 'GET', '/api/me')).json.profile.role).toBe('admin')
  customer = await person('client')
  junior = await person('consultant')
  empty = await person('consultant')
  fixture = await createTemporaryProject(service, { clientEmail: customer.email, staffEmail: junior.email })
  await verifyServerUsesFixture(config, fixture.projectId)
  storageProbePath = fixture.projectId + '/issue105-' + stamp + '.pdf'
  const probeUpload = await service.storage.from('project-files').upload(storageProbePath, Buffer.from('%PDF-1.4\nissue105\n%%EOF'), { contentType: 'application/pdf' })
  if (probeUpload.error) throw probeUpload.error
  fixture.registry.storagePaths.add(storageProbePath)
  const conversation = await call(actor, 'POST', '/api/private-conversations', { userId: junior.id })
  expect(conversation.status, JSON.stringify(conversation.json)).toBe(200)
  conversationId = conversation.json.item.id
  const privateMessage = await call(junior, 'POST', `/api/private-conversations/${conversationId}/messages`, { body: 'Istoric păstrat pentru cont dezactivat' })
  expect(privateMessage.status, JSON.stringify(privateMessage.json)).toBe(201)
  const status = await service.from('project_statuses').select('id').order('id').limit(1).single()
  expect(status.error).toBeNull()
  const template = await call(actor, 'POST', '/api/admin/templates', {
    name: 'Issue 105 ' + stamp, slug: 'issue105-' + stamp,
    phases: [{ id: 'p0', name: 'Fază import', project_status_id: status.data!.id, activities: [
      { id: 'a0', name: 'Implicit inactiv', default_consultant_id: junior.id, document_requirements: [] },
      { id: 'a1', name: 'Neasignat explicit', default_consultant_id: junior.id, document_requirements: [] },
    ] }],
  })
  expect(template.status, JSON.stringify(template.json)).toBe(201)
  templateId = template.json.template.id
  defaultActivityId = template.json.template.phases[0].activities[0].id
  nullActivityId = template.json.template.phases[0].activities[1].id
  expect((await call(actor, 'PATCH', '/api/admin/templates/' + templateId, { status: 'published' })).status).toBe(200)
})
test.afterAll(async () => {
  for (const entry of channels) await entry.client.removeChannel(entry.channel)
  if (fixture) await destroyTemporaryProject(service, fixture)
  if (conversationId) {
    const result = await service.from('private_conversations').delete().eq('id', conversationId)
    expect(result.error).toBeNull()
  }
  for (const id of importProjects) {
    const result = await service.from('projects').delete().eq('id', id)
    expect(result.error).toBeNull()
  }
  if (templateId) {
    const result = await service.from('project_templates').delete().eq('id', templateId)
    expect(result.error).toBeNull()
  }
  for (const who of people) {
    const deletion = await call(actor, 'DELETE', '/api/users/' + who.id)
    if (deletion.status === 409) await lifecycle(who, 'deactivate')
    else expect([200, 404], JSON.stringify(deletion.json)).toContain(deletion.status)
  }
})

test('deactivation keeps data, revokes API/REST/RPC/Storage and open realtime channels', async () => {
  const projectId = fixture!.projectId
  const before = await service.from('project_activities').select('*').eq('id', fixture!.activityId).single()
  expect(before.error).toBeNull()
  const impact = await call(actor, 'GET', `/api/users/${junior.id}/lifecycle-impact`)
  expect(impact.status).toBe(200)
  expect(impact.json.impact.activities).toBeGreaterThanOrEqual(1)

  const juniorNotification = await notification(junior.id)
  const actorNotification = await notification(actor.id, junior.id)
  actorNotificationId = actorNotification
  await subscribe(junior, inactiveEvents)
  await subscribe(actor, activeEvents)
  await updateNotification(juniorNotification)
  await expect.poll(() => inactiveEvents.length).toBeGreaterThan(0)

  expect((await junior.client.from('projects').select('id').eq('id', projectId)).data).toHaveLength(1)
  expect((await junior.client.rpc('current_account_session_active')).data).toBe(true)
  expect((await junior.client.storage.from('project-files').createSignedUrl(storageProbePath, 60)).error).toBeNull()
  const first = await lifecycle(junior, 'deactivate')
  expect(first.changed).toBe(true)
  const second = await lifecycle(junior, 'deactivate')
  expect(second.changed).toBe(false)
  const audit = await service.from('audit_logs').select('id').eq('entity_id', junior.id).eq('action_type', 'update').contains('new_values', { is_active: false })
  expect(audit.error).toBeNull()
  expect(audit.data).toHaveLength(1)
  const after = await service.from('project_activities').select('*').eq('id', fixture!.activityId).single()
  expect(after.data).toEqual(before.data)
  expect((await call(junior, 'GET', '/api/me')).status).toBe(401)
  for (const table of ['projects', 'project_phases', 'project_activities', 'notifications']) {
    const result = await junior.client.from(table).select('id').limit(10)
    expect(result.error).toBeNull()
    expect(result.data, table).toEqual([])
  }
  expect((await junior.client.rpc('current_account_session_active')).data).toBe(false)
  expect((await junior.client.from('document_requirements').select('id')).error?.code).toBe('42501')
  expect((await junior.client.rpc('notification_unread_summary')).error).toBeTruthy()
  const blockedReview = await service.rpc('review_document_request', {
    p_request_id: fixture!.requestId, p_action: 'approved', p_reviewed_by: junior.id,
  })
  expect(blockedReview.error?.code).toBe('P0001')
  expect(blockedReview.error?.message).toBe('ACCOUNT_SESSION_INACTIVE')
  const blockedCompletion = await service.rpc('complete_reserved_document_upload_batch', {
    p_upload_batch_id: randomUUID(), p_actor_id: junior.id, p_selected_file_ids: [],
  })
  expect(blockedCompletion.error?.message).toBe('ACCOUNT_SESSION_INACTIVE')
  const actorFeed = await call(actor, 'GET', '/api/notifications?limit=40')
  expect(actorFeed.status, JSON.stringify(actorFeed.json)).toBe(200)
  const historicalActor = actorFeed.json.items.find((item: { id: string }) => item.id === actorNotification)
  expect(historicalActor?.actorId).toBe(junior.id)
  expect(historicalActor?.actorIsActive).toBe(false)
  expect(historicalActor?.actorName).toBe('Issue 105 snapshot')
  expect((await service.from('profiles').select('full_name').eq('id', junior.id).single()).data?.full_name).toBe('Issue 105 consultant')
  expect((await junior.client.storage.from('project-files').createSignedUrl(storageProbePath, 60)).error).toBeTruthy()
  const complete = await call(junior, 'POST', `/api/document-requests/${fixture!.requestId}/uploads/complete`, { batchId: randomUUID(), fileIds: [randomUUID()] })
  expect(complete.status).toBe(401)
  const refresh = await client().auth.refreshSession({ refresh_token: junior.refreshToken })
  expect(refresh.error).toBeTruthy()
  expect((await client().auth.signInWithPassword({ email: junior.email, password })).error).toBeTruthy()

  inactiveEvents.length = 0
  const oldActiveCount = activeEvents.length
  await Promise.all([updateNotification(juniorNotification), updateNotification(actorNotification)])
  await expect.poll(() => activeEvents.length).toBeGreaterThan(oldActiveCount)
  await new Promise(resolve => setTimeout(resolve, 1_000))
  expect(inactiveEvents).toEqual([])
  const deletion = await service.from('notifications').delete().eq('id', juniorNotification).select('id').single()
  expect(deletion.error).toBeNull()
  expect(deletion.data!.id).toBe(juniorNotification)
  await new Promise(resolve => setTimeout(resolve, 1_000))
  expect(inactiveEvents).toEqual([])

  expect((await call(actor, 'GET', '/api/users?state=active')).json.users.some((u: { id: string }) => u.id === junior.id)).toBe(false)
  expect((await call(actor, 'GET', '/api/users?state=all')).json.users.some((u: { id: string }) => u.id === junior.id)).toBe(true)
  const edited = await call(actor, 'PATCH', `/api/projects/${projectId}/phases/${fixture!.phaseId}/activities/${fixture!.activityId}`, { name: 'Titlu corectat', assigned_to: junior.id })
  expect(edited.status, JSON.stringify(edited.json)).toBe(200)
  const created = await call(actor, 'POST', `/api/projects/${projectId}/phases/${fixture!.phaseId}/activities`, { name: 'Atribuire nouă' })
  expect(created.status).toBe(201)
  const otherId = created.json.activity.id
  registerCreatedActivity(fixture!.registry, otherId, fixture!.phaseId, { includeDescendants: false })
  expect((await call(actor, 'PATCH', `/api/projects/${projectId}/phases/${fixture!.phaseId}/activities/${otherId}`, { assigned_to: junior.id })).status).toBe(409)
  const directAssignment = await service.from('project_activities').update({ assigned_to: junior.id }).eq('id', otherId)
  expect(directAssignment.error?.message).toBe('INACTIVE_REFERENCE')
  const alreadyPublished = await call(actor, 'PATCH', `/api/document-requests/${fixture!.requestId}`, { name: 'Documentul rămâne editabil' })
  expect(alreadyPublished.status, JSON.stringify(alreadyPublished.json)).toBe(200)
  const publish = await call(actor, 'PATCH', `/api/projects/${projectId}/phases/${fixture!.phaseId}/activities/${otherId}`, { visibility: 'published', deadline_at: '2030-01-03T00:00:00Z' })
  expect(publish.status).toBe(400)
  // Publishing an existing owner checks activity, preserving legacy role changes.
  const legacyAssignment = await service.from('project_activities').update({ assigned_to: actor.id }).eq('id', otherId)
  expect(legacyAssignment.error).toBeNull()
  const legacyPublished = await call(actor, 'PATCH', `/api/projects/${projectId}/phases/${fixture!.phaseId}/activities/${otherId}`, { visibility: 'published', deadline_at: '2030-01-03T00:00:00Z' })
  expect(legacyPublished.status, JSON.stringify(legacyPublished.json)).toBe(200)
  const legacyCopy = await call(actor, 'POST', `/api/projects/${projectId}/phases/${fixture!.phaseId}/activities/${otherId}/duplicate`, {})
  expect(legacyCopy.status, JSON.stringify(legacyCopy.json)).toBe(201)
  registerCreatedActivity(fixture!.registry, legacyCopy.json.activity.id, fixture!.phaseId)
  expect(legacyCopy.json.activity.assigned_to).toBe(actor.id)
  expect(legacyCopy.json.activity.visibility).toBe('draft')
})

test('inactive assignment defaults are omitted, explicit choices are correctable and chat history survives', async () => {
  const history = await call(actor, 'GET', `/api/private-conversations/${conversationId}/messages`)
  expect(history.status, JSON.stringify(history.json)).toBe(200)
  const oldMessage = history.json.items.find((item: { body: string }) => item.body === 'Istoric păstrat pentru cont dezactivat')
  expect(oldMessage.profiles.is_active).toBe(false)
  expect((await call(actor, 'POST', '/api/private-conversations', { userId: junior.id })).status).toBe(409)
  expect((await call(actor, 'POST', `/api/private-conversations/${conversationId}/messages`, { body: 'Nu trebuie trimis' })).status).toBe(409)
  expect((await call(junior, 'POST', `/api/private-conversations/${conversationId}/messages`, { body: 'Token revocat' })).status).toBe(401)

  const source = await service.from('project_activities').select('*').eq('id', fixture!.activityId).single()
  const copy = await call(actor, 'POST', `/api/projects/${fixture!.projectId}/phases/${fixture!.phaseId}/activities/${fixture!.activityId}/duplicate`, {})
  expect(copy.status, JSON.stringify(copy.json)).toBe(201)
  registerCreatedActivity(fixture!.registry, copy.json.activity.id, fixture!.phaseId)
  expect(copy.json.activity.assigned_to).toBeNull()
  expect(copy.json.warnings.length).toBeGreaterThan(0)
  expect((await service.from('project_activities').select('*').eq('id', fixture!.activityId).single()).data).toEqual(source.data)

  const projectId = randomUUID()
  const inserted = await service.from('projects').insert({ id: projectId, title: 'Issue 105 import ' + stamp, client_id: customer.id, status: 'contractare' })
  expect(inserted.error).toBeNull()
  importProjects.add(projectId)
  const invalid = await call(actor, 'POST', `/api/projects/${projectId}/import-template`, { template_id: templateId, assignments: { [defaultActivityId]: junior.id } })
  expect(invalid.status, JSON.stringify(invalid.json)).toBe(409)
  expect(invalid.json.code).toBe('INACTIVE_ASSIGNMENT')
  expect(invalid.json.details.invalid_assignments[0].activity_id).toBe(defaultActivityId)
  expect((await service.from('project_phases').select('id').eq('project_id', projectId)).data).toEqual([])
  expect((await service.from('projects').select('id').eq('id', projectId)).data).toHaveLength(1)

  const corrected = await call(actor, 'POST', `/api/projects/${projectId}/import-template`, { template_id: templateId, assignments: { [nullActivityId]: null } })
  expect(corrected.status, JSON.stringify(corrected.json)).toBe(200)
  expect(corrected.json.assignments_omitted).toHaveLength(1)
  const phases = await service.from('project_phases').select('id').eq('project_id', projectId)
  const activities = await service.from('project_activities').select('id, assigned_to').in('phase_id', phases.data!.map(p => p.id))
  expect(activities.data).toHaveLength(2)
  expect(activities.data!.every(a => a.assigned_to === null)).toBe(true)
  expect((await service.from('project_members').select('id').eq('project_id', projectId).eq('consultant_id', junior.id)).data).toEqual([])
  expect((await service.from('notifications').select('id').eq('project_id', projectId).eq('user_id', junior.id)).data).toEqual([])
})
test('reactivation keeps identity/password and never restores old session eligibility', async () => {
  await lifecycle(junior, 'reactivate')
  expect((await call(junior, 'GET', '/api/me')).status).toBe(401)
  expect((await junior.client.rpc('current_account_session_active')).data).toBe(false)
  expect((await junior.client.from('projects').select('id')).data).toEqual([])
  const fresh = await signIn(junior.email, password)
  expect(fresh.id).toBe(junior.id)
  expect((await call(fresh, 'GET', '/api/me')).status).toBe(200)
  expect((await fresh.client.rpc('current_account_session_active')).data).toBe(true)
  expect((await fresh.client.from('projects').select('id').eq('id', fixture!.projectId)).data).toHaveLength(1)
  const freshEvents: string[] = []
  await subscribe(fresh, freshEvents)
  inactiveEvents.length = 0
  const freshProbe = await notification(junior.id)
  const activeBefore = activeEvents.length
  await Promise.all([updateNotification(freshProbe), updateNotification(actorNotificationId)])
  await expect.poll(() => freshEvents.length).toBeGreaterThan(0)
  await expect.poll(() => activeEvents.length).toBeGreaterThan(activeBefore)
  await new Promise(resolve => setTimeout(resolve, 1_000))
  expect(inactiveEvents).toEqual([])

  // The native wrappers must preserve upload/review for an active fresh session.
  const requestId = randomUUID()
  const request = await service.from('document_requirements').insert({
    id: requestId, project_id: fixture!.projectId, activity_id: fixture!.activityId,
    name: 'Issue 105 active upload', created_by: actor.id, assigned_to: junior.id,
    visibility: 'published', status: 'pending',
  })
  expect(request.error).toBeNull()
  registerCreatedRequest(fixture!.registry, requestId, fixture!.activityId)
  const content = Buffer.from('%PDF-1.4\nissue105-active\n%%EOF')
  const initialization = await call(customer, 'POST', `/api/document-requests/${requestId}/uploads/init`, {
    files: [{ name: 'active.pdf', size: content.length, type: 'application/pdf' }],
  })
  expect(initialization.status, JSON.stringify(initialization.json)).toBe(200)
  const upload = initialization.json.uploads[0]
  fixture!.registry.storagePaths.add(upload.storagePath)
  const uploaded = await customer.client.storage.from('project-files').uploadToSignedUrl(upload.storagePath, upload.token, content, { contentType: 'application/pdf' })
  expect(uploaded.error).toBeNull()
  const completionBody = { batchId: initialization.json.batchId, fileIds: [upload.fileId] }
  const completed = await call(customer, 'POST', `/api/document-requests/${requestId}/uploads/complete`, completionBody)
  expect(completed.status, JSON.stringify(completed.json)).toBe(200)
  expect(completed.json.created).toBe(true)
  expect((await call(customer, 'POST', `/api/document-requests/${requestId}/uploads/complete`, completionBody)).json.created).toBe(false)
  const reviewed = await call(fresh, 'POST', `/api/document-requests/${requestId}/review`, { action: 'approved' })
  expect(reviewed.status, JSON.stringify(reviewed.json)).toBe(200)
  expect((await service.from('document_requirements').select('status').eq('id', requestId).single()).data?.status).toBe('approved')
  const produced = await service.from('notifications').select('type, actor_id, event_key').eq('entity_id', requestId)
  expect(produced.error).toBeNull()
  expect(produced.data!.some(row => row.event_key.startsWith('document-upload:') && row.actor_id === customer.id)).toBe(true)
  expect(produced.data!.some(row => row.event_key.startsWith('document-review:') && row.actor_id === fresh.id)).toBe(true)
})

test('inactive client is skipped before delivery claims and retains project/files', async ({ page }) => {
  const requestBefore = await service.from('document_requirements').select('client_notified_at').eq('id', fixture!.requestId).single()
  const filesBefore = await service.from('files').select('id, storage_path').eq('requirement_id', fixture!.requestId)
  await lifecycle(customer, 'deactivate')
  for (const path of [`/api/projects/${fixture!.projectId}/notify-client`, `/api/document-requests/${fixture!.requestId}/reminder`]) {
    const result = await call(actor, 'POST', path)
    expect(result.status, JSON.stringify(result.json)).toBe(409)
    if (path.endsWith('/notify-client')) expect(result.json.code).toBe('CLIENT_ACCOUNT_INACTIVE')
  }

  await page.goto('/login')
  // Cold dev pages can expose the SSR form before React attaches its handlers.
  const passwordInput = page.locator('input[autocomplete=current-password]')
  await expect(async () => {
    if (await passwordInput.getAttribute('type') === 'password') {
      await page.getByRole('button', { name: 'Arată parola', exact: true }).click()
    }
    await expect(passwordInput).toHaveAttribute('type', 'text', { timeout: 1_000 })
  }).toPass({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Ascunde parola', exact: true }).click()
  await expect(passwordInput).toHaveAttribute('type', 'password')
  await page.fill('input[type=email]', config.staffEmail)
  await page.fill('input[type=password]', config.staffPassword)
  await page.click('button[type=submit]')
  await page.waitForURL(url => !url.pathname.startsWith('/login'))
  await page.goto(`/projects/${fixture!.projectId}`)
  await page.getByRole('button', { name: 'Anunță clientul despre actualizări' }).click()
  const confirmation = page.getByRole('dialog')
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: 'Trimite email', exact: true }).click()
  const toast = page.getByRole('alert').filter({ hasText: 'Clientul are contul dezactivat. Nu a fost trimisă nicio notificare.' })
  await expect(toast).toBeVisible()
  await expect(toast).toHaveText('Clientul are contul dezactivat. Nu a fost trimisă nicio notificare.')

  expect((await service.from('document_requirements').select('client_notified_at').eq('id', fixture!.requestId).single()).data).toEqual(requestBefore.data)
  expect((await service.from('files').select('id, storage_path').eq('requirement_id', fixture!.requestId)).data).toEqual(filesBefore.data)
  expect((await call(actor, 'GET', '/api/projects/' + fixture!.projectId)).status).toBe(200)
  const reserveEmail = await service.auth.admin.createUser({ email: customer.email, password, email_confirm: true })
  expect(reserveEmail.error).toBeTruthy()
})

test('authentication audit allows empty-account deletion and business or other-target audit remains blocking', async () => {
  for (const inactive of [false, true]) {
    const who = await person('client')
    for (const action of ['login', 'logout']) {
      const recorded = await call(who, 'POST', '/api/auth/audit', { action })
      expect(recorded.status, JSON.stringify(recorded.json)).toBe(200)
    }
    const legacy = await service.from('audit_logs').insert([
      { action_type: 'logout', entity_name: null },
      { action_type: 'login', entity_name: '' },
      { action_type: 'logout', entity_name: '  ' },
      { action_type: 'login', entity_name: null, entity_id: null },
    ].map(record => ({ user_id: who.id, entity_type: 'user', entity_id: who.id, ...record })))
    expect(legacy.error).toBeNull()
    const before = await service.from('audit_logs').select('*').eq('user_id', who.id).order('id')
    expect(before.error).toBeNull()
    expect(before.data).toHaveLength(6)
    if (inactive) await lifecycle(who, 'deactivate')
    const impact = await call(actor, 'GET', `/api/users/${who.id}/lifecycle-impact`)
    expect(impact.status, JSON.stringify(impact.json)).toBe(200)
    expect(impact.json.blockers).toEqual([])
    const deleted = await call(actor, 'DELETE', '/api/users/' + who.id)
    expect(deleted.status, JSON.stringify(deleted.json)).toBe(200)
    expect((await service.from('profiles').select('id').eq('id', who.id)).data).toEqual([])
    expect(sql(`SELECT count(*) FROM auth.users WHERE id='${who.id}'`)).toBe('0')
    const after = await service.from('audit_logs').select('*').eq('user_id', who.id).order('id')
    expect(after.error).toBeNull()
    expect(after.data).toEqual(before.data)
    const history = await call(actor, 'GET', '/api/audit?user_id=' + who.id)
    expect(history.status, JSON.stringify(history.json)).toBe(200)
    expect(history.json.logs).toHaveLength(6)
    expect(history.json.logs.every((log: { user_id: string; entity_name: string | null; actor_email: string; user: unknown }) => log.user_id === who.id && (log.entity_name?.trim() || log.actor_email) === who.email && log.user === null)).toBe(true)
  }
  for (const record of [
    { action_type: 'update', entity_type: 'project', entity_id: fixture!.projectId },
    { action_type: 'login', entity_type: 'user', entity_id: fixture!.projectId },
    { action_type: 'logout', entity_type: 'project' },
  ]) {
    const who = await person('client')
    const inserted = await service.from('audit_logs').insert({ user_id: who.id, entity_id: who.id, entity_name: who.email, ...record })
    expect(inserted.error).toBeNull()
    await lifecycle(who, 'deactivate')
    const impact = await call(actor, 'GET', `/api/users/${who.id}/lifecycle-impact`)
    expect(impact.status, JSON.stringify(impact.json)).toBe(200)
    expect(impact.json.blockers).toEqual([{ kind: 'public.audit_logs.user_id', count: 1 }])
    const blocked = await call(actor, 'DELETE', '/api/users/' + who.id)
    expect(blocked.status, JSON.stringify(blocked.json)).toBe(409)
    expect(blocked.json.code).toBe('USER_HAS_RELATED_DATA')
    expect((await service.from('profiles').select('is_active').eq('id', who.id).single()).data?.is_active).toBe(false)
  }
})

test('hard delete refuses related accounts and atomically retains an empty account snapshot', async () => {
  const related = await call(actor, 'DELETE', '/api/users/' + junior.id)
  expect(related.status).toBe(409)
  expect(related.json.code).toBe('USER_HAS_RELATED_DATA')
  expect(related.json.details.blockers.length).toBeGreaterThan(0)
  expect((await service.from('profiles').select('id').eq('id', junior.id).single()).data?.id).toBe(junior.id)
  for (const action of ['login', 'logout']) {
    expect((await call(empty, 'POST', '/api/auth/audit', { action })).status).toBe(200)
  }
  const authBefore = await service.from('audit_logs').select('*').eq('user_id', empty.id).order('id')
  expect(authBefore.error).toBeNull()
  expect(authBefore.data).toHaveLength(2)
  const softRequestId = randomUUID()
  const softRequest = await service.from('document_requirements').insert({
    id: softRequestId, project_id: fixture!.projectId, activity_id: fixture!.activityId,
    name: 'Issue 105 deleted history', created_by: empty.id, visibility: 'draft',
    status: 'pending', deleted_at: new Date().toISOString(),
  })
  expect(softRequest.error).toBeNull()
  try {
    const softBlocked = await call(actor, 'DELETE', '/api/users/' + empty.id)
    expect(softBlocked.status, JSON.stringify(softBlocked.json)).toBe(409)
    expect(softBlocked.json.code).toBe('USER_HAS_RELATED_DATA')
    expect(softBlocked.json.details.blockers.some((blocker: { kind: string; count: number }) => blocker.kind.includes('document_requirements') && blocker.count > 0)).toBe(true)
    expect((await service.from('document_requirements').select('id').eq('id', softRequestId)).data).toHaveLength(1)
  } finally {
    const cleanup = await service.from('document_requirements').delete().eq('id', softRequestId)
    expect(cleanup.error).toBeNull()
  }
  // owner_id is legacy text; a valid UUID with different casing is still ownership.
  expect(sql(`SELECT owner IS NULL AND owner_id IS NULL FROM storage.objects WHERE bucket_id='project-files' AND name='${storageProbePath}'`)).toBe('t')
  try {
    sql(`UPDATE storage.objects SET owner_id=upper('${empty.id}') WHERE bucket_id='project-files' AND name='${storageProbePath}'`)
    const storageBlocked = await call(actor, 'DELETE', '/api/users/' + empty.id)
    expect(storageBlocked.status, JSON.stringify(storageBlocked.json)).toBe(409)
    expect(storageBlocked.json.code).toBe('USER_HAS_RELATED_DATA')
    expect(storageBlocked.json.details.blockers.some((blocker: { kind: string }) => blocker.kind === 'storage.objects.owner/owner_id')).toBe(true)
    expect((await service.from('profiles').select('id').eq('id', empty.id).single()).data?.id).toBe(empty.id)
  } finally {
    sql(`UPDATE storage.objects SET owner=NULL,owner_id=NULL WHERE bucket_id='project-files' AND name='${storageProbePath}'`)
  }
  // A future public FK into auth.users must be protected even without an app trigger.
  const table = 'issue105_auth_ref_' + stamp
  expect(sql(`SELECT to_regclass('public.${table}') IS NULL`)).toBe('t')
  sql(`BEGIN; CREATE TABLE public.${table}(id uuid PRIMARY KEY, user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE); ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY; REVOKE ALL ON public.${table} FROM PUBLIC,anon,authenticated; COMMIT;`)
  try {
    sql(`INSERT INTO public.${table} VALUES ('${randomUUID()}','${empty.id}')`)
    const authFkBlocked = await call(actor, 'DELETE', '/api/users/' + empty.id)
    expect(authFkBlocked.status, JSON.stringify(authFkBlocked.json)).toBe(409)
    expect(authFkBlocked.json.details.blockers.some((blocker: { kind: string }) => blocker.kind.includes(table))).toBe(true)
    sql(`DELETE FROM public.${table} WHERE user_id='${empty.id}'`)

    await lifecycle(empty, 'deactivate')
    const auditHolder = concurrentSql('BEGIN; LOCK TABLE public.audit_logs IN SHARE MODE; SELECT pg_sleep(6); COMMIT;')
    await waitForSqlTrue(`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE relation='public.audit_logs'::regclass AND mode='ShareLock' AND granted)`)
    const deletionPromise = call(actor, 'DELETE', '/api/users/' + empty.id)
    await waitForSqlTrue(`SELECT EXISTS(SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE l.relation='public.audit_logs'::regclass AND l.mode='RowExclusiveLock' AND NOT l.granted AND a.query LIKE '%delete_empty_user_account%')`)
    const insertionPromise = concurrentSql(`INSERT INTO public.${table} VALUES ('${randomUUID()}','${empty.id}')`)
    const authorshipPromise = concurrentSql(`INSERT INTO public.audit_logs(user_id,action_type,entity_type,entity_id,entity_name) VALUES ('${empty.id}','update','user','${empty.id}','Issue 105 concurrent author')`)
    const [deleted, inserted, authored, holder] = await Promise.all([deletionPromise, insertionPromise, authorshipPromise, auditHolder])
    expect(holder.code, holder.output).toBe(0)
    expect(deleted.status, JSON.stringify(deleted.json)).toBe(200)
    expect(inserted.code, inserted.output).not.toBe(0)
    expect(inserted.output).toContain('23503')
    expect(authored.code, authored.output).not.toBe(0)
    expect(authored.output).toContain('AUDIT_AUTHOR_PROFILE_REQUIRED')
    expect(sql(`SELECT count(*) FROM public.${table}`)).toBe('0')
  } finally {
    sql(`DROP TABLE public.${table}`)
  }
  expect((await service.from('profiles').select('id').eq('id', empty.id).maybeSingle()).data).toBeNull()
  const audit = await service.from('audit_logs').select('old_values').eq('entity_id', empty.id).eq('action_type', 'delete')
  expect(audit.data).toHaveLength(1)
  expect(audit.data?.[0].old_values.email).toBe(empty.email)
  expect(audit.data?.[0].old_values.is_active).toBe(false)
  const authAfter = await service.from('audit_logs').select('*').eq('user_id', empty.id).order('id')
  expect(authAfter.error).toBeNull()
  expect(authAfter.data).toEqual(authBefore.data)
  for (const action of ['deactivate', 'delete']) {
    const own = await call(actor, action === 'delete' ? 'DELETE' : 'POST', '/api/users/' + actor.id + (action === 'delete' ? '' : '/deactivate'))
    expect(own.status).toBe(409)
    expect(own.json.code).toBe('SELF_ACCOUNT_ACTION')
  }
})

test('Auth failure keeps an inactive retryable account and audit failure rolls the transition back', async () => {
  const target = await person('consultant')
  const authFunction = 'issue105_test_auth_' + stamp
  const auditFunction = 'issue105_test_audit_' + stamp
  const authTrigger = 'issue105_test_auth_' + stamp
  const auditTrigger = 'issue105_test_audit_' + stamp
  expect(sql(`SELECT to_regprocedure('public.${authFunction}()') IS NULL AND to_regprocedure('public.${auditFunction}()') IS NULL`)).toBe('t')
  sql(`CREATE FUNCTION public.${authFunction}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fault$BEGIN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='ISSUE105_AUTH_FAULT'; END;$fault$; REVOKE ALL ON FUNCTION public.${authFunction}() FROM PUBLIC,anon,authenticated;`)
  const createAuthFault = `CREATE TRIGGER ${authTrigger} BEFORE UPDATE OF banned_until ON auth.users FOR EACH ROW WHEN (NEW.id='${target.id}'::uuid) EXECUTE FUNCTION public.${authFunction}()`
  const dropAuthFault = `DROP TRIGGER IF EXISTS ${authTrigger} ON auth.users`
  try {
    sql(createAuthFault)
    for (const changed of [true, false]) {
      const incomplete = await call(actor, 'POST', `/api/users/${target.id}/deactivate`)
      expect(incomplete.status, JSON.stringify(incomplete.json)).toBe(503)
      expect(incomplete.json.code).toBe('AUTH_SYNC_INCOMPLETE')
      expect(incomplete.json.changed).toBe(changed)
      expect(incomplete.json.profile.is_active).toBe(false)
      expect(incomplete.json.profile.auth_sync_pending).toBe(true)
    }
    expect((await target.client.from('projects').select('id')).data).toEqual([])
    expect((await target.client.rpc('current_account_session_active')).data).toBe(false)
    expect((await call(target, 'GET', '/api/me')).status).toBe(401)
    const deactivationAudit = await service.from('audit_logs').select('new_values').eq('entity_id', target.id).contains('new_values', { operation: 'deactivate' })
    expect(deactivationAudit.error).toBeNull()
    expect(deactivationAudit.data).toHaveLength(1)
    expect(deactivationAudit.data![0].new_values.auth_sync_pending).toBe(true)
    sql(dropAuthFault)
    expect((await lifecycle(target, 'deactivate')).changed).toBe(false)
    sql(createAuthFault)
    const failedReactivation = await call(actor, 'POST', `/api/users/${target.id}/reactivate`)
    expect(failedReactivation.status, JSON.stringify(failedReactivation.json)).toBe(503)
    expect(failedReactivation.json.profile.is_active).toBe(false)
    expect(failedReactivation.json.profile.auth_sync_pending).toBe(true)
    sql(dropAuthFault)
    await lifecycle(target, 'reactivate')
    const fresh = await signIn(target.email, password)
    expect((await call(fresh, 'GET', '/api/me')).status).toBe(200)
    expect((await target.client.rpc('current_account_session_active')).data).toBe(false)
    const beforeAudit = await service.from('audit_logs').select('id').eq('entity_id', target.id)
    sql(`CREATE FUNCTION public.${auditFunction}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fault$BEGIN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='ISSUE105_AUDIT_FAULT'; END;$fault$; REVOKE ALL ON FUNCTION public.${auditFunction}() FROM PUBLIC,anon,authenticated; CREATE TRIGGER ${auditTrigger} BEFORE INSERT ON public.audit_logs FOR EACH ROW WHEN (NEW.entity_id='${target.id}'::uuid) EXECUTE FUNCTION public.${auditFunction}();`)
    const failedAudit = await call(actor, 'POST', `/api/users/${target.id}/deactivate`)
    expect(failedAudit.status, JSON.stringify(failedAudit.json)).toBe(500)
    expect((await service.from('profiles').select('is_active, auth_sync_pending').eq('id', target.id).single()).data).toEqual({ is_active: true, auth_sync_pending: false })
    expect((await fresh.client.rpc('current_account_session_active')).data).toBe(true)
    expect((await call(fresh, 'GET', '/api/me')).status).toBe(200)
    expect((await service.from('audit_logs').select('id').eq('entity_id', target.id)).data).toEqual(beforeAudit.data)
  } finally {
    sql(`${dropAuthFault}; DROP TRIGGER IF EXISTS ${auditTrigger} ON public.audit_logs; DROP FUNCTION IF EXISTS public.${authFunction}(); DROP FUNCTION IF EXISTS public.${auditFunction}();`)
  }
})

test('lifecycle impact dialog works with keyboard on desktop and mobile', async ({ page }) => {
  await page.goto('/login')
  // Cold dev pages can expose the SSR form before React attaches its handlers.
  const passwordInput = page.locator('input[autocomplete=current-password]')
  await expect(async () => {
    if (await passwordInput.getAttribute('type') === 'password') {
      await page.getByRole('button', { name: 'Arată parola', exact: true }).click()
    }
    await expect(passwordInput).toHaveAttribute('type', 'text', { timeout: 1_000 })
  }).toPass({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Ascunde parola', exact: true }).click()
  await expect(passwordInput).toHaveAttribute('type', 'password')
  await page.fill('input[type=email]', config.staffEmail)
  await page.fill('input[type=password]', config.staffPassword)
  await page.click('button[type=submit]')
  await page.waitForURL(url => !url.pathname.startsWith('/login'))
  await page.goto('/admin/users')
  await expect(page.getByRole('group', { name: 'Filtrează după starea contului' })).toBeVisible()
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    await page.getByRole('button', { name: 'Dezactivează ' + junior.email, exact: true }).click()
    const dialog = page.getByRole('dialog').last()
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('term').filter({ hasText: /^Activități$/ })).toBeVisible()
    expect(await page.evaluate(() => document.body.scrollWidth <= window.innerWidth)).toBe(true)
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Dezactivează ' + junior.email, exact: true })).toBeFocused()
  }
})
test('concurrent demotions and deactivations always leave an active administrator', async () => {
  const a = await person('admin'), b = await person('admin')
  const original = await service.from('profiles').select('id, role').eq('role', 'admin').eq('is_active', true)
  expect(original.error).toBeNull()
  const existing = original.data!.filter(p => p.id !== a.id && p.id !== b.id)
  try {
    for (const profile of existing) {
      const changed = await service.from('profiles').update({ role: 'consultant' }).eq('id', profile.id)
      expect(changed.error).toBeNull()
    }
    const countAdmins = async () => {
      const rows = await service.from('profiles').select('id').eq('role', 'admin').eq('is_active', true)
      expect(rows.error).toBeNull()
      return rows.data!.length
    }
    expect(await countAdmins()).toBe(2)
    const demotions = await Promise.all([call(a, 'PATCH', '/api/users/' + a.id, { role: 'consultant' }), call(b, 'PATCH', '/api/users/' + b.id, { role: 'consultant' })])
    expect(demotions.map(r => r.status).sort(), JSON.stringify(demotions)).toEqual([200, 409])
    expect(demotions.find(r => r.status === 409)!.json.code).toBe('LAST_ACTIVE_ADMIN')
    expect(await countAdmins()).toBe(1)
    const restoredRoles = await service.from('profiles').update({ role: 'admin' }).in('id', [a.id, b.id])
    expect(restoredRoles.error).toBeNull()

    const deactivations = await Promise.all([call(a, 'POST', `/api/users/${b.id}/deactivate`), call(b, 'POST', `/api/users/${a.id}/deactivate`)])
    expect(deactivations.filter(r => r.status === 200), JSON.stringify(deactivations)).toHaveLength(1)
    expect(deactivations.filter(r => [401, 403, 409].includes(r.status))).toHaveLength(1)
    expect(await countAdmins()).toBe(1)
    const states = await service.from('profiles').select('id, is_active').in('id', [a.id, b.id])
    const inactive = states.data!.find(p => p.is_active === false)!.id === a.id ? a : b
    const remaining = inactive === a ? b : a
    expect((await call(remaining, 'POST', `/api/users/${inactive.id}/reactivate`)).status).toBe(200)
    Object.assign(inactive, await signIn(inactive.email, password))
    expect(await countAdmins()).toBe(2)

    const mixed = await Promise.all([call(a, 'PATCH', '/api/users/' + a.id, { role: 'consultant' }), call(b, 'POST', `/api/users/${a.id}/deactivate`)])
    expect(mixed[1].status, JSON.stringify(mixed)).toBe(200)
    expect([200, 401, 403, 409]).toContain(mixed[0].status)
    expect(await countAdmins()).toBe(1)
  } finally {
    for (const profile of existing) {
      const restored = await service.from('profiles').update({ role: profile.role }).eq('id', profile.id)
      expect(restored.error).toBeNull()
    }
    expect((await call(actor, 'GET', '/api/me')).json.profile.role).toBe('admin')
  }
})