/* eslint-disable @typescript-eslint/no-explicit-any */
// Încărcarea arborelui de șablon într-un număr constant de cereri: una per
// nivel (șabloane, faze, activități, cereri de document), indiferent câte
// elemente are șablonul. Înlocuiește încărcările N+1 din GET-ul listei și din
// propagare. Nu verifică nimic în storage și nu scrie nimic în baza de date.

import type { SupabaseClient } from '@supabase/supabase-js'
import { assembleTemplateTrees } from '@/lib/template-tree'
import { ATTACHMENT_BUCKET } from './attachment-storage'

// PostgREST taie răspunsul la 1000 de rânduri; citim pe pagini ca să nu
// pierdem în tăcere cereri de document la șabloanele mari.
const PAGE_SIZE = 1000

async function selectAll(buildQuery: () => any) {
  const rows: any[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery().order('id').range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE_SIZE) return rows
  }
}

const PHASE_SELECT = '*, project_status:project_statuses(id, name, slug, color, icon)'
const ACTIVITY_SELECT = '*, default_consultant:default_consultant_id(id, full_name, email)'
const DOCUMENT_SELECT = '*, attachments:document_requirement_attachments(id, storage_path, original_name, mime_type, file_size, order_index, missing_at, missing_checked_at, created_at)'

/**
 * Încarcă un șablon (`templateId`) sau toate (`null`) cu fazele, activitățile
 * și cererile de document active.
 */
export async function loadTemplateTrees(
  supabase: SupabaseClient,
  templateId: string | null,
  templateSelect = '*',
) {
  const templatesQuery = supabase.from('project_templates').select(templateSelect)
  const templatesPromise = templateId
    ? templatesQuery.eq('id', templateId)
    : templatesQuery.order('created_at', { ascending: false })

  const [templatesResult, phases, activities, documents] = await Promise.all([
    templatesPromise,
    selectAll(() => {
      const query = supabase.from('template_phases').select(PHASE_SELECT).eq('is_active', true)
      return templateId ? query.eq('template_id', templateId) : query
    }),
    selectAll(() => {
      if (!templateId) {
        return supabase.from('template_activities').select(ACTIVITY_SELECT).eq('is_active', true)
      }
      return supabase
        .from('template_activities')
        .select(`${ACTIVITY_SELECT}, scope:template_phases!inner(template_id)`)
        .eq('is_active', true)
        .eq('scope.template_id', templateId)
    }),
    selectAll(() => {
      if (!templateId) {
        return supabase.from('template_document_requirements').select(DOCUMENT_SELECT).eq('is_active', true)
      }
      return supabase
        .from('template_document_requirements')
        .select(`${DOCUMENT_SELECT}, scope:template_activities!inner(phase:template_phases!inner(template_id))`)
        .eq('is_active', true)
        .eq('scope.phase.template_id', templateId)
    }),
  ])

  if (templatesResult.error) throw templatesResult.error

  const stripScope = (row: any) => {
    delete row.scope
    return row
  }
  return assembleTemplateTrees(
    (templatesResult.data ?? []) as any[],
    phases,
    activities.map(stripScope),
    documents.map(stripScope),
  )
}

export async function loadTemplateTree(
  supabase: SupabaseClient,
  templateId: string,
  templateSelect = '*',
) {
  const [template] = await loadTemplateTrees(supabase, templateId, templateSelect)
  return template ?? null
}

/**
 * Verificare de existență în storage cu cache pe durata unei cereri: același
 * `storage_path` e verificat o singură dată, oricâte proiecte îl primesc.
 */
export function createStoragePathChecker(supabase: SupabaseClient) {
  const cache = new Map<string, Promise<boolean>>()

  const check = async (path: string) => {
    const { data, error } = await supabase.storage.from(ATTACHMENT_BUCKET).createSignedUrl(path, 60)
    if (error || !data?.signedUrl) return false

    try {
      const res = await fetch(data.signedUrl, { method: 'HEAD' })
      return res.ok
    } catch {
      return false
    }
  }

  return (path: string) => {
    let pending = cache.get(path)
    if (!pending) {
      pending = check(path)
      cache.set(path, pending)
    }
    return pending
  }
}
