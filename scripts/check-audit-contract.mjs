import nextEnv from '@next/env'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { loadEnvConfig } = nextEnv
loadEnvConfig(root)

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

function fail(message) {
  console.error(`audit:check — ${message}`)
  process.exitCode = 1
}

function probeError(error) {
  if (!error) return null
  return [error.code, error.status, error.message].filter(Boolean).join(' ')
}

async function readProbe(label, request) {
  try {
    const { data, error } = await request()
    if (error) {
      fail(`${label}: ${probeError(error)}`)
      return null
    }
    return data
  } catch (error) {
    fail(`${label}: ${probeError(error)}`)
    return null
  }
}

if (!url || !serviceKey) {
  fail('lipsesc SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL sau SUPABASE_SERVICE_ROLE_KEY')
} else {
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })

  const catalogUrl = pathToFileURL(join(root, 'lib/audit-catalog.ts')).href

  try {
    const { AUDIT_ACTION_LABELS, AUDIT_ENTITY_LABELS } = await import(catalogUrl)

    // PostgREST must expose metadata for a truthful schema check. Supabase
    // projects commonly do not expose information_schema; that is a failed
    // check, not a reason to infer the schema from TypeScript or migrations.
    const columns = await readProbe('information_schema.columns nu poate fi citit prin PostgREST (limitare de acces sau schemă neexpusă)', () => admin
      .schema('information_schema')
      .from('columns')
      .select('column_name,data_type,udt_name,is_nullable,column_default,ordinal_position')
      .eq('table_schema', 'public')
      .eq('table_name', 'audit_logs')
      .order('ordinal_position'))

    if (columns && !columns.length) {
      fail('public.audit_logs nu există sau nu este vizibilă în information_schema.columns')
    }
    if (columns) {
      const requiredColumns = [
        'id',
        'user_id',
        'action_type',
        'entity_type',
        'entity_id',
        'entity_name',
        'old_values',
        'new_values',
        'description',
        'ip_address',
        'user_agent',
        'created_at',
      ]
      const columnNames = new Set(columns.map(column => column.column_name))
      const missingColumns = requiredColumns.filter(column => !columnNames.has(column))
      if (missingColumns.length) fail(`coloane lipsă în public.audit_logs: ${missingColumns.join(', ')}`)
    }

    const catalog = admin.schema('pg_catalog')
    const indexes = await readProbe('pg_indexes nu poate fi citit prin PostgREST (limitare de acces sau schemă neexpusă)', () => catalog
        .from('pg_indexes')
        .select('indexname,indexdef')
        .eq('schemaname', 'public')
        .eq('tablename', 'audit_logs'))
    let missingIndexes = []
    if (indexes) {
        const requiredIndexes = [
          'idx_audit_logs_entity',
          'idx_audit_logs_user_created',
          'idx_audit_logs_action_created',
          'idx_audit_logs_created',
        ]
        const indexNames = new Set(indexes.map(index => index.indexname))
        missingIndexes = requiredIndexes.filter(index => !indexNames.has(index))
        if (missingIndexes.length) fail(`indexuri lipsă pe public.audit_logs: ${missingIndexes.join(', ')}`)
    }

    const namespaces = await readProbe('pg_namespace nu poate fi citit prin PostgREST (limitare de acces sau schemă neexpusă)', () => catalog
        .from('pg_namespace')
        .select('oid,nspname')
        .eq('nspname', 'public')
        .limit(1))
    const publicOid = namespaces?.[0]?.oid
    if (namespaces && !publicOid) fail('schema public nu a fost găsită în pg_namespace')

    const tables = await readProbe('pg_class nu poate fi citit prin PostgREST (limitare de acces sau schemă neexpusă)', () => catalog
      .from('pg_class')
      .select('oid,relname,relnamespace')
      .eq('relname', 'audit_logs')
      .limit(20))
    const auditLogsOid = publicOid && tables
      ? tables.find(table => String(table.relnamespace) === String(publicOid))?.oid
      : null
    if (tables && !auditLogsOid) fail('tabela public.audit_logs nu a fost găsită în pg_class')

    const triggers = await readProbe('pg_trigger nu poate fi citit prin PostgREST (limitare de acces sau schemă neexpusă)', () => catalog
          .from('pg_trigger')
          .select('tgname,tgrelid,tgenabled,tgtype,tgisinternal')
          .eq('tgname', 'audit_logs_append_only')
          .limit(20))
    let trigger = null
    let triggerContract = false
    if (triggers) {
        trigger = auditLogsOid
          ? triggers.find(row => String(row.tgrelid) === String(auditLogsOid))
          : null
        const triggerType = Number(trigger?.tgtype)
        triggerContract = Boolean(trigger)
          && (triggerType & 1) !== 0 // FOR EACH ROW
          && (triggerType & 2) !== 0 // BEFORE
          && (triggerType & 8) !== 0 // DELETE
          && (triggerType & 16) !== 0 // UPDATE
        if (!triggerContract) fail('triggerul audit_logs_append_only lipsește sau nu este BEFORE UPDATE OR DELETE FOR EACH ROW')
    }

    const rows = []
    const pageSize = 1000
    for (let offset = 0; ; offset += pageSize) {
        // Only action_type/entity_type are read; payloads, descriptions and
        // user-identifying columns never leave Supabase during this check.
        const data = await readProbe('public.audit_logs action_type/entity_type nu poate fi citit', () => admin
          .from('audit_logs')
          .select('action_type,entity_type')
          .order('id', { ascending: true })
          .range(offset, offset + pageSize - 1))
        if (data === null) break
        rows.push(...(data ?? []))
        if (!data || data.length < pageSize) break
    }

    const actionTypes = [...new Set(rows.map(row => row.action_type))]
    const entityTypes = [...new Set(rows.map(row => row.entity_type))]
    const unknownActions = actionTypes.filter(type => typeof type === 'string' && !Object.hasOwn(AUDIT_ACTION_LABELS, type))
    const unknownEntities = entityTypes.filter(type => typeof type === 'string' && !Object.hasOwn(AUDIT_ENTITY_LABELS, type))
    const unrenderableActions = actionTypes.filter(type => typeof type !== 'string' || !type.trim())
    const unrenderableEntities = entityTypes.filter(type => typeof type !== 'string' || !type.trim())

    console.log(JSON.stringify({
        ...(columns !== null ? {
        columns: columns.map(column => ({
          name: column.column_name,
          dataType: column.data_type,
          nullable: column.is_nullable,
          default: column.column_default,
        })),
        } : {}),
        ...(indexes !== null ? { indexes: { present: indexes.map(index => index.indexname), missing: missingIndexes } } : {}),
        ...(triggers !== null ? { appendOnlyTrigger: { present: Boolean(trigger), contract: triggerContract } } : {}),
        actionTypes: {
          known: actionTypes.filter(type => typeof type === 'string' && Object.hasOwn(AUDIT_ACTION_LABELS, type)),
          unknown: unknownActions,
          unrenderable: unrenderableActions,
        },
        entityTypes: {
          known: entityTypes.filter(type => typeof type === 'string' && Object.hasOwn(AUDIT_ENTITY_LABELS, type)),
          unknown: unknownEntities,
          unrenderable: unrenderableEntities,
        },
      }, null, 2))

    if (unknownActions.length) console.error(`audit:check — acțiuni necunoscute (fallback UI): ${unknownActions.join(', ')}`)
    if (unknownEntities.length) console.error(`audit:check — entități necunoscute (fallback UI): ${unknownEntities.join(', ')}`)
    if (unrenderableActions.length) fail(`acțiuni existente imposibil de afișat/selectat: ${unrenderableActions.join(', ')}`)
    if (unrenderableEntities.length) fail(`entități existente imposibil de afișat/selectat: ${unrenderableEntities.join(', ')}`)
    if (!process.exitCode) console.log('audit:check — contractul read-only este valid')
  } catch (error) {
    fail(`verificarea nu a putut fi executată: ${error?.message ?? String(error)}`)
  }
}
