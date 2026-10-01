import { createSupabaseServiceClient } from './supabase'
import type { TemplateStatus } from './auth'

/**
 * Marchează un șablon publicat ca având „modificări neaplicate în proiecte”.
 * Seniorul poate modifica șabloane publicate, dar doar adminul aplică
 * modificările în proiecte; eticheta îi spune adminului că are ce aplica.
 *
 * Primește șablonul încărcat deja de `requireTemplateAccess`: pe o ciornă
 * eticheta n-are rost (publicarea o golește oricum), deci nu mai costă o
 * cerere la fiecare salvare.
 *
 * Nu aruncă niciodată: o etichetă ratată nu are voie să strice salvarea.
 */
export async function markTemplateChanged(template: { id: string; status: TemplateStatus }) {
  if (template.status !== 'published') return
  try {
    const admin = createSupabaseServiceClient()
    const { error } = await admin
      .from('project_templates')
      .update({ unpropagated_changes_at: new Date().toISOString() })
      .eq('id', template.id)
      .eq('status', 'published')
    if (error) console.error('markTemplateChanged failed:', { templateId: template.id, error })
  } catch (error) {
    console.error('markTemplateChanged failed:', { templateId: template.id, error })
  }
}

/** Golește eticheta după ce adminul a aplicat modificările în proiecte. */
export async function clearTemplateChanged(templateId: string) {
  try {
    const admin = createSupabaseServiceClient()
    const { error } = await admin
      .from('project_templates')
      .update({ unpropagated_changes_at: null })
      .eq('id', templateId)
    if (error) console.error('clearTemplateChanged failed:', { templateId, error })
  } catch (error) {
    console.error('clearTemplateChanged failed:', { templateId, error })
  }
}
