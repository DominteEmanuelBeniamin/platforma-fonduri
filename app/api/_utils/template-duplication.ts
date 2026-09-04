export type TemplateDuplicationEntity = 'template_phase' | 'template_activity' | 'template_document'

export type TemplateDuplication = {
  source_kind: 'persistent' | 'local'
  source_entity_type: TemplateDuplicationEntity
  source_id: string | null
  source_name: string
}

type ParsedDuplication =
  | { ok: true; value: TemplateDuplication }
  | { ok: false; error: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

export function isPersistentTemplateId(id: string) {
  return isUuid(id)
}

export function duplicationFromSource(
  source: { id: string; name: string },
  sourceEntityType: TemplateDuplicationEntity,
) {
  const persistent = isPersistentTemplateId(source.id)
  return {
    duplication: {
      source_kind: persistent ? 'persistent' as const : 'local' as const,
      source_entity_type: sourceEntityType,
      source_id: persistent ? source.id : null,
      source_name: source.name,
    },
    ...(persistent ? {} : { sourceLocalId: source.id }),
  }
}

export function resolveDuplicationForSave(
  node: { duplication?: TemplateDuplication; sourceLocalId?: string },
  savedIds: ReadonlyMap<string, string>,
) {
  if (!node.duplication) return undefined
  if (node.duplication.source_kind === 'persistent') return node.duplication
  const persistentId = node.sourceLocalId ? savedIds.get(node.sourceLocalId) : undefined
  return persistentId
    ? { ...node.duplication, source_kind: 'persistent' as const, source_id: persistentId }
    : { ...node.duplication, source_kind: 'local' as const, source_id: null }
}

export function parseTemplateDuplication(
  value: unknown,
  expectedEntityType: TemplateDuplicationEntity,
): ParsedDuplication {
  if (!value || typeof value !== 'object') return { ok: false, error: 'Proveniența duplicării este invalidă.' }
  const input = value as Record<string, unknown>
  const sourceName = typeof input.source_name === 'string' ? input.source_name.trim() : ''
  if (input.source_entity_type !== expectedEntityType) {
    return { ok: false, error: 'Proveniența duplicării este invalidă.' }
  }

  if (input.source_kind === 'local') {
    if (input.source_id !== null || !sourceName) return { ok: false, error: 'Sursa locală trebuie să aibă un nume valid.' }
    return {
      ok: true,
      value: {
        source_kind: 'local',
        source_entity_type: expectedEntityType,
        source_id: null,
        source_name: sourceName,
      },
    }
  }

  if (input.source_kind === 'persistent' && isUuid(input.source_id)
    && (input.source_name === undefined || typeof input.source_name === 'string')) {
    return {
      ok: true,
      value: {
        source_kind: 'persistent',
        source_entity_type: expectedEntityType,
        source_id: input.source_id,
        source_name: sourceName,
      },
    }
  }

  return { ok: false, error: 'Sursa persistentă trebuie să aibă un UUID valid.' }
}
