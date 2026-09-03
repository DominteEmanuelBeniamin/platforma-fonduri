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
    const { auditContractProblems } = await import(
      pathToFileURL(join(root, 'lib/audit-contract-checks.ts')).href)

    // Faptele structurale vin dintr-un RPC `SECURITY DEFINER`, nu din
    // `information_schema`/`pg_catalog`: PostgREST nu le expune pe proiectele
    // Supabase, deci probele scrise peste ele nu puteau reuși niciodată —
    // scriptul ieșea mereu cu 1 fără să confirme nimic. Regulile stau în
    // `lib/audit-contract-checks.ts`, ca să poată fi testate fără Supabase.
    let contract = null
    const { data: contractRow, error: contractError } = await admin.rpc('audit_logs_contract')
    if (contractError || !contractRow) {
      fail('structura nu poate fi verificată: aplică migrarea '
        + '`supabase/migrations/20260903000000_audit_contract_probes.sql`'
        + (contractError ? ` (${probeError(contractError)})` : ''))
    } else {
      contract = contractRow
      for (const problem of auditContractProblems(contract)) fail(problem)
    }

    // Valorile distincte se agregă în DB. Citirea rând cu rând a jurnalului
    // funcționa, dar creștea la nesfârșit odată cu el — iar `audit_logs` e
    // append-only, deci nu se micșorează niciodată. Dacă migrarea cu RPC-ul nu
    // e încă aplicată, cădem înapoi pe scanarea paginată, ca verificarea să nu
    // devină un blocaj de deployment.
    let rows = null
    const { data: distinctRows, error: distinctError } = await admin.rpc('audit_log_distinct_types')
    if (!distinctError && Array.isArray(distinctRows)) {
      rows = distinctRows
    } else {
      console.error('audit:check — RPC audit_log_distinct_types indisponibil, se scanează paginat:', probeError(distinctError))
      rows = []
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
    }

    const actionTypes = [...new Set(rows.map(row => row.action_type))]
    const entityTypes = [...new Set(rows.map(row => row.entity_type))]
    const unknownActions = actionTypes.filter(type => typeof type === 'string' && !Object.hasOwn(AUDIT_ACTION_LABELS, type))
    const unknownEntities = entityTypes.filter(type => typeof type === 'string' && !Object.hasOwn(AUDIT_ENTITY_LABELS, type))
    const unrenderableActions = actionTypes.filter(type => typeof type !== 'string' || !type.trim())
    const unrenderableEntities = entityTypes.filter(type => typeof type !== 'string' || !type.trim())

    console.log(JSON.stringify({
        ...(contract ? {
          columns: contract.columns ?? [],
          indexes: contract.indexes ?? [],
          appendOnlyTrigger: contract.append_only_trigger ?? null,
        } : { contract: 'neverificat' }),
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
