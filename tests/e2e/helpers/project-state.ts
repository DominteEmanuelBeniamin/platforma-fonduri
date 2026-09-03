import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const BUCKET = 'project-files'
export const E2E_ENV_FILE = process.env.E2E_ENV_FILE || '.env.e2e.local'

/** Citește un fișier `.env` simplu, fără dependențe. */
export function readEnvFile(file: string): Record<string, string> {
  if (!fs.existsSync(file)) return {}
  return Object.fromEntries(
    fs.readFileSync(file, 'utf8').split('\n')
      .filter(line => line.includes('=') && !line.trim().startsWith('#'))
      .map(line => {
        const i = line.indexOf('=')
        return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2')]
      }),
  )
}

/**
 * Configurația E2E este separată de `.env.local`. Nu citim niciodată cheia de
 * service din mediul implicit: un test de scriere trebuie să declare explicit
 * baza dedicată și proiectul efemer.
 */
export function e2eEnv(): Record<string, string> {
  const env = readEnvFile(E2E_ENV_FILE)
  // CI poate injecta doar variabilele E2E; nu moștenim SUPABASE_* generice.
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('E2E_') && value) env[key] = value
  }
  return env
}

export type E2EConfig = {
  baseUrl: string
  staffEmail: string
  staffPassword: string
  clientEmail: string
  clientPassword: string
  supabaseUrl: string
  anonKey: string
  serviceRoleKey: string
}

const REQUIRED_E2E_KEYS = [
  'E2E_BASE_URL',
  'E2E_STAFF_EMAIL',
  'E2E_STAFF_PASSWORD',
  'E2E_CLIENT_EMAIL',
  'E2E_CLIENT_PASSWORD',
  'E2E_SUPABASE_URL',
  'E2E_SUPABASE_ANON_KEY',
  'E2E_SUPABASE_SERVICE_ROLE_KEY',
] as const

/**
 * Eșuează explicit când lipsesc variabilele care separă testul de producție.
 * Cheile nu sunt tipărite; sunt raportate doar numele lor.
 */
export function requireE2EConfig(env: Record<string, string> = e2eEnv()): E2EConfig {
  const missing = REQUIRED_E2E_KEYS.filter(key => !env[key])
  if (missing.length > 0) {
    throw new Error(`Configurație E2E dedicată incompletă în ${E2E_ENV_FILE}; lipsesc: ${missing.join(', ')}`)
  }
  if (env.E2E_WRITES !== '1') {
    throw new Error('E2E_WRITES=1 este obligatoriu pentru verificările cu scriere')
  }
  if (env.E2E_TEST_PROJECT !== '1') {
    throw new Error('E2E_TEST_PROJECT=1 este obligatoriu; proiectul trebuie să fie temporar și dedicat rulării')
  }

  return {
    baseUrl: env.E2E_BASE_URL,
    staffEmail: env.E2E_STAFF_EMAIL,
    staffPassword: env.E2E_STAFF_PASSWORD,
    clientEmail: env.E2E_CLIENT_EMAIL,
    clientPassword: env.E2E_CLIENT_PASSWORD,
    supabaseUrl: env.E2E_SUPABASE_URL,
    anonKey: env.E2E_SUPABASE_ANON_KEY,
    serviceRoleKey: env.E2E_SUPABASE_SERVICE_ROLE_KEY,
  }
}

/** Clientul de service pentru baza dedicată E2E, fără fallback la `.env.local`. */
export function serviceClient(): SupabaseClient | null {
  const env = e2eEnv()
  if (!env.E2E_SUPABASE_URL || !env.E2E_SUPABASE_SERVICE_ROLE_KEY) return null
  return createClient(env.E2E_SUPABASE_URL, env.E2E_SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export type CreatedRegistry = {
  projectId: string
  phaseIds: Set<string>
  activityIds: Set<string>
  requestIds: Set<string>
  storagePaths: Set<string>
  sourceStoragePaths: Set<string>
  activityParents: Map<string, string>
  requestParents: Map<string, string>
  expandPhaseIds: Set<string>
  expandActivityIds: Set<string>
}

export function createCreatedRegistry(projectId: string): CreatedRegistry {
  return {
    projectId,
    phaseIds: new Set(),
    activityIds: new Set(),
    requestIds: new Set(),
    storagePaths: new Set(),
    sourceStoragePaths: new Set(),
    activityParents: new Map(),
    requestParents: new Map(),
    expandPhaseIds: new Set(),
    expandActivityIds: new Set(),
  }
}

export function registerCreatedPhase(
  registry: CreatedRegistry,
  id: unknown,
  options: { includeDescendants?: boolean } = {},
): asserts id is string {
  if (typeof id !== 'string' || id.length === 0) throw new Error('Răspunsul de duplicare nu conține un ID de fază')
  registry.phaseIds.add(id)
  if (options.includeDescendants !== false) registry.expandPhaseIds.add(id)
}

export function registerCreatedActivity(
  registry: CreatedRegistry,
  id: unknown,
  phaseId: string,
  options: { includeDescendants?: boolean } = {},
): asserts id is string {
  if (typeof id !== 'string' || id.length === 0) throw new Error('Răspunsul de duplicare nu conține un ID de activitate')
  registry.activityIds.add(id)
  registry.activityParents.set(id, phaseId)
  if (options.includeDescendants !== false) registry.expandActivityIds.add(id)
}

export function registerCreatedRequest(
  registry: CreatedRegistry,
  id: unknown,
  activityId: string,
): asserts id is string {
  if (typeof id !== 'string' || id.length === 0) throw new Error('Răspunsul de duplicare nu conține un ID de cerere')
  registry.requestIds.add(id)
  registry.requestParents.set(id, activityId)
}

export function registerCreatedStoragePath(registry: CreatedRegistry, path: unknown) {
  if (typeof path !== 'string' || path.length === 0) return
  if (registry.sourceStoragePaths.has(path)) {
    throw new Error(`Nu se poate înregistra ca nouă calea sursă ${path}`)
  }
  registry.storagePaths.add(path)
}

export function protectSourceStoragePath(registry: CreatedRegistry, path: unknown) {
  if (typeof path !== 'string' || path.length === 0) return
  registry.sourceStoragePaths.add(path)
  registry.storagePaths.delete(path)
}

type SupabaseError = { message?: string } | Error | null | undefined

function errorMessage(error: SupabaseError): string {
  if (error instanceof Error) return error.message
  if (error && typeof error.message === 'string') return error.message
  return String(error)
}

function throwIfError(error: SupabaseError, operation: string): void {
  if (error) throw new Error(`${operation}: ${errorMessage(error)}`)
}

async function readSingle<T>(
  query: PromiseLike<{ data: T | null; error: SupabaseError }>,
  operation: string,
): Promise<T> {
  const { data, error } = await query
  throwIfError(error, operation)
  if (!data) throw new Error(`${operation}: nu există rândul necesar`)
  return data
}

async function readRows<T>(query: PromiseLike<{ data: T[] | null; error: SupabaseError }>, operation: string): Promise<T[]> {
  const { data, error } = await query
  throwIfError(error, operation)
  return data ?? []
}

export type TemporaryProjectFixture = {
  projectId: string
  phaseId: string
  activityId: string
  requestId: string
  registry: CreatedRegistry
}

/**
 * Creează un proiect nou la fiecare test, cu o fază, o activitate și o cerere.
 * Toate rândurile sunt identificate prin UUID-uri noi; fixture-ul nu primește
 * niciun ID dintr-un proiect existent.
 */
export async function createTemporaryProject(
  admin: SupabaseClient,
  config: Pick<E2EConfig, 'clientEmail' | 'staffEmail'>,
): Promise<TemporaryProjectFixture> {
  const client = await readSingle<{ id: string; role: string }>(
    admin.from('profiles').select('id, role').eq('email', config.clientEmail).maybeSingle(),
    'validarea clientului fixture E2E',
  )
  if (client.role !== 'client') throw new Error('E2E_CLIENT_EMAIL trebuie să indice un profil client')
  const staff = await readSingle<{ id: string; role: string }>(
    admin.from('profiles').select('id, role').eq('email', config.staffEmail).maybeSingle(),
    'validarea utilizatorului staff fixture E2E',
  )
  if (staff.role !== 'admin' && staff.role !== 'consultant') {
    throw new Error('E2E_STAFF_EMAIL trebuie să indice un profil admin sau consultant')
  }

  const projectId = randomUUID()
  const phaseId = randomUUID()
  const activityId = randomUUID()
  const requestId = randomUUID()
  const registry = createCreatedRegistry(projectId)
  try {
    await readSingle<{ id: string }>(
      admin.from('projects').insert({
        id: projectId,
        title: `E2E test temporar ${projectId.slice(0, 8)}`,
        client_id: client.id,
        status: 'contractare',
      }).select('id').single(),
      'crearea proiectului fixture E2E',
    )

    if (staff.role === 'consultant') {
      const { error } = await admin.from('project_members').insert({
        project_id: projectId,
        consultant_id: staff.id,
        role_in_project: 'member',
      })
      throwIfError(error, 'crearea apartenenței fixture E2E')
    }

    const phase = await readSingle<{ id: string }>(
      admin.from('project_phases').insert({
        id: phaseId,
        project_id: projectId,
        name: 'Fază E2E',
        slug: `e2e-faza-${phaseId.slice(0, 8)}`,
        order_index: 1,
        status: 'pending',
        visibility: 'published',
      }).select('id').single(),
      'crearea fazei fixture E2E',
    )
    // Copiii fixture-ului au ID-uri explicite; nu extindem faza printr-un
    // SELECT larg, care ar putea include un nod străin apărut între teste.
    registerCreatedPhase(registry, phase.id, { includeDescendants: false })

    const activity = await readSingle<{ id: string }>(
      admin.from('project_activities').insert({
        id: activityId,
        phase_id: phaseId,
        name: 'Activitate E2E',
        order_index: 1,
        status: 'pending',
        visibility: 'published',
        assigned_to: staff.id,
        assigned_by: staff.id,
        deadline_at: '2030-01-02T00:00:00.000Z',
      }).select('id').single(),
      'crearea activității fixture E2E',
    )
    registerCreatedActivity(registry, activity.id, phaseId, { includeDescendants: false })

    const request = await readSingle<{ id: string }>(
      admin.from('document_requirements').insert({
        id: requestId,
        project_id: projectId,
        activity_id: activityId,
        name: 'Cerere E2E',
        order_index: 1,
        requirement_type: 'obligatoriu',
        is_mandatory: true,
        is_outgoing: false,
        deadline_at: '2030-01-03T00:00:00.000Z',
        status: 'pending',
        visibility: 'published',
        is_locked: false,
      }).select('id').single(),
      'crearea cererii fixture E2E',
    )
    // Ledger-ul se actualizează imediat după INSERT, înainte de orice upload
    // sau INSERT dependent care poate eșua.
    registerCreatedRequest(registry, request.id, activityId)

    const modelPath = `test-fixtures/${projectId}/model.pdf`
    const modelBytes = Buffer.from('%PDF-1.4\nfixture model\n%%EOF\n')
    const modelUpload = await admin.storage.from(BUCKET).upload(modelPath, modelBytes, {
      contentType: 'application/pdf',
      upsert: false,
    })
    throwIfError(modelUpload.error, 'crearea obiectului-model fixture E2E')
    registerCreatedStoragePath(registry, modelPath)

    const clientPath = `test-fixtures/${projectId}/client.pdf`
    const clientBytes = Buffer.from('%PDF-1.4\nfixture client\n%%EOF\n')
    const clientUpload = await admin.storage.from(BUCKET).upload(clientPath, clientBytes, {
      contentType: 'application/pdf',
      upsert: false,
    })
    throwIfError(clientUpload.error, 'crearea obiectului client fixture E2E')
    registerCreatedStoragePath(registry, clientPath)

    const attachment = await readSingle<{ id: string }>(
      admin.from('document_requirement_attachments').insert({
        id: randomUUID(),
        document_requirement_id: requestId,
        storage_path: modelPath,
        original_name: 'model.pdf',
        mime_type: 'application/pdf',
        file_size: modelBytes.length,
        order_index: 0,
        missing_at: null,
        missing_checked_at: null,
        created_by: staff.id,
      }).select('id').single(),
      'crearea atașamentului-model fixture E2E',
    )
    if (!attachment.id) throw new Error('Atașamentul-model fixture nu are ID')

    const file = await readSingle<{ id: string }>(
      admin.from('files').insert({
        id: randomUUID(),
        requirement_id: requestId,
        storage_path: clientPath,
        original_name: 'client.pdf',
        file_size: clientBytes.length,
        mime_type: 'application/pdf',
        version_number: 1,
        uploaded_by: client.id,
      }).select('id').single(),
      'crearea fișierului-client fixture E2E',
    )
    if (!file.id) throw new Error('Fișierul-client fixture nu are ID')

    return { projectId, phaseId, activityId, requestId, registry }
  } catch (error) {
    // Registry-ul conține numai ce a confirmat INSERT-ul. Dacă fixture-ul
    // eșuează, compensarea nu caută și nu șterge rânduri prin diferență.
    try {
      await destroyTemporaryProject(admin, {
        projectId,
        phaseId,
        activityId,
        requestId,
        registry,
      })
    } catch (cleanupError) {
      // destroyTemporaryProject verifică descendenții înainte de DELETE;
      // proiectul rămâne pentru intervenție explicită dacă apare un nod străin.
      throw new Error(`${error instanceof Error ? error.message : String(error)}; cleanup fixture: ${errorMessage(cleanupError as SupabaseError)}`)
    }
    throw error
  }
}

export async function destroyTemporaryProject(
  admin: SupabaseClient,
  fixture: TemporaryProjectFixture,
): Promise<void> {
  let cleanupError: unknown = null
  try {
    await cleanupCreated(admin, fixture.registry)
  } catch (error) {
    cleanupError = error
  }
  const remainingPhases = await readRows<{ id: string }>(
    admin.from('project_phases').select('id').eq('project_id', fixture.projectId),
    'verificarea fazelor rămase în fixture E2E',
  )
  const remainingRequests = await readRows<{ id: string }>(
    admin.from('document_requirements').select('id').eq('project_id', fixture.projectId),
    'verificarea cererilor rămase în fixture E2E',
  )
  if (cleanupError || remainingPhases.length > 0 || remainingRequests.length > 0) {
    const detail = cleanupError instanceof Error ? `; cleanup: ${cleanupError.message}` : ''
    throw new Error(`Fixture E2E păstrat: au rămas ${remainingPhases.length} faze și ${remainingRequests.length} cereri neînregistrate${detail}`)
  }
  const memberResult = await admin.from('project_members').delete().eq('project_id', fixture.projectId)
  throwIfError(memberResult.error, 'ștergerea apartenenței fixture E2E')
  const projectResult = await admin.from('projects').delete().eq('id', fixture.projectId)
  throwIfError(projectResult.error, 'ștergerea proiectului fixture E2E')
}

/**
 * Confirmă că serverul accesat de Playwright vede fixture-ul din aceeași bază
 * ca service clientul. Un server rămas pe producție nu va vedea UUID-ul nou.
 */
export async function verifyServerUsesFixture(
  config: Pick<E2EConfig, 'baseUrl' | 'supabaseUrl' | 'anonKey' | 'staffEmail' | 'staffPassword'>,
  projectId: string,
) {
  const anon = createClient(config.supabaseUrl, config.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: session, error: signInError } = await anon.auth.signInWithPassword({
    email: config.staffEmail,
    password: config.staffPassword,
  })
  throwIfError(signInError, 'autentificarea preflight E2E')
  const response = await fetch(`${config.baseUrl}/api/projects/${projectId}`, {
    headers: { Authorization: `Bearer ${session.session?.access_token ?? ''}` },
  })
  if (!response.ok) {
    throw new Error(`Preflight server E2E: ${response.status} pentru proiectul fixture ${projectId}`)
  }
  const body = await response.json() as { project?: { id?: string } }
  if (body.project?.id !== projectId) {
    throw new Error('Preflight server E2E: serverul și service clientul nu folosesc aceeași bază')
  }
}

/**
 * Căile existente ale sursei sunt doar protecții, nu intră în registrul de
 * ștergere. Copiile sunt descoperite ulterior numai sub ID-uri create.
 */
export async function storagePathsForActivities(admin: SupabaseClient, activityIds: string[]) {
  if (activityIds.length === 0) return []
  const requests = await readRows<{ id: string; attachment_path: string | null }>(
    admin.from('document_requirements').select('id, attachment_path').in('activity_id', activityIds),
    'citirea cererilor pentru protejarea storage',
  )
  const requestIds = requests.map(row => row.id)
  const attachments = requestIds.length === 0
    ? []
    : await readRows<{ storage_path: string | null }>(
      admin.from('document_requirement_attachments').select('storage_path').in('document_requirement_id', requestIds),
      'citirea atașamentelor pentru protejarea storage',
    )
  return [...new Set([
    ...requests.map(row => row.attachment_path),
    ...attachments.map(row => row.storage_path),
  ].filter((path): path is string => typeof path === 'string' && path.length > 0))]
}

export async function storagePathsForPhase(admin: SupabaseClient, phaseId: string) {
  const activities = await readRows<{ id: string }>(
    admin.from('project_activities').select('id').eq('phase_id', phaseId),
    `citirea activităților fazei ${phaseId} pentru protejarea storage`,
  )
  return storagePathsForActivities(admin, activities.map(activity => activity.id))
}

async function collectCreatedDescendants(admin: SupabaseClient, registry: CreatedRegistry) {
  const phaseIds = [...registry.phaseIds]
  const expandablePhaseIds = [...registry.expandPhaseIds]
  const activityIds = new Set(registry.activityIds)

  if (phaseIds.length > 0) {
    const phaseRows = await readRows<{ id: string; project_id: string }>(
      admin.from('project_phases').select('id, project_id').in('id', phaseIds),
      'verificarea fazelor create',
    )
    for (const row of phaseRows) {
      if (row.project_id !== registry.projectId) {
        throw new Error(`Faza ${row.id} nu aparține proiectului de test`)
      }
    }

    const rows = await readRows<{ id: string; phase_id: string }>(
      admin.from('project_activities').select('id, phase_id').in('phase_id', phaseIds),
      'citirea activităților din fazele create',
    )
    for (const row of rows) {
      if (!expandablePhaseIds.includes(row.phase_id) && !activityIds.has(row.id)) {
        throw new Error(`Activitatea ${row.id} este un nod străin sub faza fixture`)
      }
      if (expandablePhaseIds.includes(row.phase_id)) {
        activityIds.add(row.id)
        registry.activityParents.set(row.id, row.phase_id)
        registry.expandActivityIds.add(row.id)
      }
    }
  }

  if (registry.activityIds.size > 0) {
    const rows = await readRows<{ id: string; phase_id: string }>(
      admin.from('project_activities').select('id, phase_id').in('id', [...registry.activityIds]),
      'verificarea activităților create',
    )
    for (const row of rows) {
      const expectedParent = registry.activityParents.get(row.id)
      if (expectedParent && expectedParent !== row.phase_id) {
        throw new Error(`Activitatea ${row.id} nu mai aparține fazei înregistrate`)
      }
      activityIds.add(row.id)
    }
  }

  // Cererile rețin ID-ul activității părinte, nu al fazei. Rezolvăm explicit
  // activitate -> fază -> proiect înainte de a citi sau șterge copii.
  const referencedActivityIds = [...new Set([
    ...registry.activityIds,
    ...registry.requestParents.values(),
  ])]
  const parentActivityRows = referencedActivityIds.length === 0
    ? []
    : await readRows<{ id: string; phase_id: string }>(
      admin.from('project_activities').select('id, phase_id').in('id', referencedActivityIds),
      'verificarea activităților părinte ale nodurilor create',
    )
  const parentPhaseIds = [...new Set([
    ...parentActivityRows.map(row => row.phase_id),
    ...registry.activityParents.values(),
  ])]
  if (parentPhaseIds.length > 0) {
    const parentPhases = await readRows<{ id: string; project_id: string }>(
      admin.from('project_phases').select('id, project_id').in('id', parentPhaseIds),
      'verificarea fazelor părinte ale nodurilor create',
    )
    for (const row of parentPhases) {
      if (row.project_id !== registry.projectId) {
        throw new Error(`Faza părinte ${row.id} nu aparține proiectului de test`)
      }
    }
  }

  const requestIds = new Set(registry.requestIds)
  if (registry.requestIds.size > 0) {
    const rows = await readRows<{ id: string; activity_id: string }>(
      admin.from('document_requirements').select('id, activity_id').in('id', [...registry.requestIds]),
      'verificarea cererilor create',
    )
    for (const row of rows) {
      const expectedParent = registry.requestParents.get(row.id)
      if (expectedParent && expectedParent !== row.activity_id) {
        throw new Error(`Cererea ${row.id} nu mai aparține activității înregistrate`)
      }
      if (!activityIds.has(row.activity_id)) {
        throw new Error(`Cererea ${row.id} nu se află în subarborele înregistrat`)
      }
      requestIds.add(row.id)
      registry.requestParents.set(row.id, row.activity_id)
    }
  }

  const expandableActivityIds = [...registry.expandActivityIds]
  const nonExpandableActivityIds = [...registry.activityIds]
    .filter(id => !registry.expandActivityIds.has(id))
  if (nonExpandableActivityIds.length > 0) {
    const rows = await readRows<{ id: string; activity_id: string }>(
      admin.from('document_requirements').select('id, activity_id').in('activity_id', nonExpandableActivityIds),
      'verificarea cererilor din activitățile fixture',
    )
    for (const row of rows) {
      if (!registry.requestIds.has(row.id)) {
        throw new Error(`Cererea ${row.id} este un nod străin sub activitatea fixture`)
      }
    }
  }
  const requests = expandableActivityIds.length === 0
    ? []
    : await readRows<{ id: string; activity_id: string; attachment_path: string | null; attachment_missing_at?: string | null }>(
      admin.from('document_requirements')
        .select('id, activity_id, attachment_path, attachment_missing_at')
        .in('activity_id', expandableActivityIds),
      'citirea cererilor create',
    )
  for (const row of requests) {
    if (activityIds.has(row.activity_id)) {
      requestIds.add(row.id)
      registry.requestParents.set(row.id, row.activity_id)
    }
  }

  const attachments = requestIds.size === 0
    ? []
    : await readRows<{ storage_path: string | null; missing_at?: string | null }>(
      admin.from('document_requirement_attachments')
        .select('storage_path, missing_at')
        .in('document_requirement_id', [...requestIds]),
      'citirea obiectelor storage create',
    )
  const files = requestIds.size === 0
    ? []
    : await readRows<{ storage_path: string | null }>(
      admin.from('files').select('storage_path').in('requirement_id', [...requestIds]),
      'citirea fișierelor create',
    )

  const discoveredPaths = [
    ...requests
      .filter(row => !row.attachment_missing_at)
      .map(row => row.attachment_path),
    ...attachments
      .filter(row => !row.missing_at)
      .map(row => row.storage_path),
    ...files.map(row => row.storage_path),
  ].filter((path): path is string => typeof path === 'string' && path.length > 0)

  return {
    activityIds,
    requestIds,
    storagePaths: new Set([...registry.storagePaths, ...discoveredPaths]
      .filter(path => !registry.sourceStoragePaths.has(path))),
  }
}

/**
 * Curăță numai ID-uri declarate în registru și descendenții confirmați sub
 * părinții lor. Nu restaurează ordini globale și nu șterge audit_logs.
 */
export async function cleanupCreated(admin: SupabaseClient, registry: CreatedRegistry): Promise<void> {
  const collected = await collectCreatedDescendants(admin, registry)
  const failures: string[] = []

  const attempt = async (operation: string, action: () => PromiseLike<{ error: SupabaseError }>) => {
    try {
      const result = await action()
      if (result?.error) failures.push(`${operation}: ${errorMessage(result.error)}`)
      return !result?.error
    } catch (error) {
      failures.push(`${operation}: ${errorMessage(error as SupabaseError)}`)
      return false
    }
  }

  const paths = [...collected.storagePaths]
  let storageDeleted = true
  if (paths.length > 0) {
    storageDeleted = await attempt('ștergerea obiectelor storage create', () =>
      admin.storage.from(BUCKET).remove(paths))
  }

  const requestIds = [...collected.requestIds]
  const activityIds = [...collected.activityIds]
  const phaseIds = [...registry.phaseIds]

  // Dacă storage-ul nu s-a curățat, păstrăm rândurile ca retry-ul ulterior să
  // aibă încă scope-ul exact și nu permitem ștergerea proiectului părinte.
  let childrenDeleted = storageDeleted
  if (childrenDeleted && requestIds.length > 0) {
    childrenDeleted = await attempt('ștergerea rândurilor de atașamente create', () =>
      admin.from('document_requirement_attachments').delete().in('document_requirement_id', requestIds)) && childrenDeleted
    if (childrenDeleted) childrenDeleted = await attempt('ștergerea fișierelor create', () =>
      admin.from('files').delete().in('requirement_id', requestIds)) && childrenDeleted
    if (childrenDeleted) childrenDeleted = await attempt('ștergerea cererilor create', () =>
      admin.from('document_requirements').delete().in('id', requestIds)) && childrenDeleted
  }

  // Dacă un copil nu s-a șters, părintele rămâne pentru a nu ascunde gunoiul
  // sau a declanșa cascade neașteptate. Eroarea este raportată apelantului.
  const activitiesDeleted = childrenDeleted && (activityIds.length === 0 || await attempt(
    'ștergerea activităților create',
    () => admin.from('project_activities').delete().in('id', activityIds),
  ))
  if (childrenDeleted && activitiesDeleted && phaseIds.length > 0) {
    await attempt('ștergerea fazelor create', () =>
      admin.from('project_phases').delete().in('id', phaseIds).eq('project_id', registry.projectId))
  }

  if (failures.length > 0) {
    throw new Error(`Cleanup E2E eșuat:\n${failures.join('\n')}`)
  }
}

/** Rulează fixture-ul cu cleanup garantat, inclusiv la eșecul aserțiunilor. */
export async function withCreatedRegistry<T>(
  admin: SupabaseClient,
  projectId: string,
  action: (registry: CreatedRegistry) => Promise<T>,
): Promise<T> {
  const registry = createCreatedRegistry(projectId)
  try {
    return await action(registry)
  } finally {
    await cleanupCreated(admin, registry)
  }
}

/** O fază din proiect care are cel puțin o activitate, citită cu erori verificate. */
export async function phaseWithActivities(admin: SupabaseClient, projectId: string) {
  const phases = await readRows<{ id: string; name: string }>(
    admin.from('project_phases').select('id, name').eq('project_id', projectId).order('order_index'),
    'citirea fazelor E2E',
  )
  for (const phase of phases) {
    const activities = await readRows<{ id: string; name: string }>(
      admin.from('project_activities').select('id, name').eq('phase_id', phase.id).order('order_index'),
      `citirea activităților fazei ${phase.id}`,
    )
    if (activities.length > 0) {
      return { phaseId: phase.id, phaseName: phase.name, activity: activities[0] }
    }
  }
  return null
}
