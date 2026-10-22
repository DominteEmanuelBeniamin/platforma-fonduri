/**
 * Starea formularului de șablon, cât contează pentru „ai modificări nesalvate”.
 * Ce e doar de afișare (faze strânse sau desfăcute) nu contează; ordinea,
 * numele, consultanții, cererile și fișierele-model, da.
 *
 * Fără importuri cu alias: testele (`node --test`) îl încarcă direct.
 */

type DocLike = {
  id: string
  name: string
  description?: string | null
  is_outgoing?: boolean
  requirement_type?: string
  sensitive_kind?: string | null
  templateFiles?: readonly { name: string; size: number }[]
  templateAttachments?: readonly { id?: string; storage_path: string }[]
  templateFileRemoved?: boolean
}

type ActivityLike = {
  id: string
  name: string
  default_consultant_id?: string | null
  document_requirements: readonly DocLike[]
}

type PhaseLike = {
  id: string
  name: string
  project_status_id?: string | null
  activities: readonly ActivityLike[]
}

export type TemplateFormState = {
  name: string
  description: string
  phases: readonly PhaseLike[]
}

function fingerprint(form: TemplateFormState): string {
  return JSON.stringify({
    name: form.name.trim(),
    description: form.description.trim(),
    phases: form.phases.map(phase => ({
      id: phase.id,
      name: phase.name,
      status: phase.project_status_id ?? null,
      activities: phase.activities.map(activity => ({
        id: activity.id,
        name: activity.name,
        consultant: activity.default_consultant_id || null,
        docs: activity.document_requirements.map(doc => ({
          id: doc.id,
          name: doc.name,
          description: doc.description ?? '',
          outgoing: !!doc.is_outgoing,
          type: doc.requirement_type ?? null,
          sensitive: doc.sensitive_kind ?? null,
          attachments: (doc.templateAttachments ?? []).map(attachment => attachment.id ?? attachment.storage_path),
          files: (doc.templateFiles ?? []).map(file => `${file.name}:${file.size}`),
          removed: !!doc.templateFileRemoved,
        })),
      })),
    })),
  })
}

/**
 * Formularul diferă de instantaneul luat la deschidere (sau la ultima
 * salvare). Se cheamă doar când omul vrea să plece, nu la fiecare tastare:
 * pe un șablon cu sute de cereri, amprenta costă.
 */
export function templateFormDirty(snapshot: TemplateFormState, current: TemplateFormState): boolean {
  if (snapshot === current) return false
  return fingerprint(snapshot) !== fingerprint(current)
}
