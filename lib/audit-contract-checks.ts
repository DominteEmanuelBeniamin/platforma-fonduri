/**
 * Ce trebuie să fie adevărat despre `public.audit_logs`, evaluat peste ce
 * întoarce RPC-ul `audit_logs_contract()`.
 *
 * Separat de `scripts/check-audit-contract.mjs` ca să poată fi testat: scriptul
 * are nevoie de Supabase, regulile nu.
 */

export const AUDIT_REQUIRED_COLUMNS = [
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
] as const

type AuditRequiredColumnName = typeof AUDIT_REQUIRED_COLUMNS[number]

export const AUDIT_REQUIRED_COLUMN_CONTRACT: Record<
  AuditRequiredColumnName,
  { type: string; nullable: boolean }
> = {
  id: { type: 'uuid', nullable: false },
  user_id: { type: 'uuid', nullable: true },
  action_type: { type: 'text', nullable: false },
  entity_type: { type: 'text', nullable: false },
  entity_id: { type: 'uuid', nullable: true },
  entity_name: { type: 'text', nullable: true },
  old_values: { type: 'jsonb', nullable: true },
  new_values: { type: 'jsonb', nullable: true },
  description: { type: 'text', nullable: true },
  ip_address: { type: 'text', nullable: true },
  user_agent: { type: 'text', nullable: true },
  created_at: { type: 'timestamp with time zone', nullable: true },
}

export const AUDIT_REQUIRED_INDEXES = [
  'idx_audit_logs_entity',
  'idx_audit_logs_user_created',
  'idx_audit_logs_action_created',
  'idx_audit_logs_created',
] as const

export type AuditAppendOnlyTrigger = {
  row_level?: boolean
  before?: boolean
  on_update?: boolean
  on_delete?: boolean
  enabled?: boolean
}

export type AuditLogsContract = {
  table_exists?: boolean
  columns?: { name?: string; type?: string; nullable?: boolean }[]
  indexes?: string[]
  /** `null` când triggerul lipsește de pe tabelă. */
  append_only_trigger?: AuditAppendOnlyTrigger | null
}

/**
 * Lista de probleme, în ordinea în care merită citite. Goală = contractul e
 * respectat. Nu aruncă: apelantul decide ce face cu ele.
 */
export function auditContractProblems(contract: unknown): string[] {
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    return ['contractul audit nu a putut fi citit']
  }
  const value = contract as AuditLogsContract
  const problems: string[] = []

  if (!value.table_exists) {
    return ['public.audit_logs nu există']
  }

  const columns = new Map((value.columns ?? [])
    .filter((column): column is NonNullable<AuditLogsContract['columns']>[number] & { name: string } => (
      typeof column?.name === 'string'
    ))
    .map(column => [column.name, column]))
  const missingColumns = AUDIT_REQUIRED_COLUMNS.filter(column => !columns.has(column))
  if (missingColumns.length) {
    problems.push(`coloane lipsă în public.audit_logs: ${missingColumns.join(', ')}`)
  }

  for (const name of AUDIT_REQUIRED_COLUMNS) {
    const actual = columns.get(name)
    if (!actual) continue

    const expected = AUDIT_REQUIRED_COLUMN_CONTRACT[name]
    if (actual.type !== expected.type) {
      problems.push(
        `coloana public.audit_logs.${name} are tipul ${String(actual.type)}; așteptat ${expected.type}`,
      )
    }
    if (actual.nullable !== expected.nullable) {
      const actualNullability = actual.nullable === true
        ? 'nullable'
        : actual.nullable === false ? 'NOT NULL' : String(actual.nullable)
      problems.push(
        `coloana public.audit_logs.${name} este ${actualNullability}; `
        + `așteptat ${expected.nullable ? 'nullable' : 'NOT NULL'}`,
      )
    }
  }

  const indexNames = new Set((value.indexes ?? []).filter((name): name is string => typeof name === 'string'))
  const missingIndexes = AUDIT_REQUIRED_INDEXES.filter(index => !indexNames.has(index))
  if (missingIndexes.length) {
    problems.push(`indexuri lipsă pe public.audit_logs: ${missingIndexes.join(', ')}`)
  }

  const trigger = value.append_only_trigger
  if (!trigger) {
    problems.push('triggerul audit_logs_append_only lipsește de pe public.audit_logs')
  } else {
    // Fiecare bit contează separat: un trigger AFTER, sau doar pe UPDATE, ar
    // trece o verificare de prezență și n-ar apăra jurnalul.
    const broken = ([
      ['BEFORE', trigger.before],
      ['FOR EACH ROW', trigger.row_level],
      ['ON UPDATE', trigger.on_update],
      ['ON DELETE', trigger.on_delete],
      ['activat', trigger.enabled],
    ] as const).filter(([, ok]) => !ok).map(([label]) => label)
    if (broken.length) {
      problems.push(`triggerul audit_logs_append_only nu respectă contractul (lipsește: ${broken.join(', ')})`)
    }
  }

  return problems
}
