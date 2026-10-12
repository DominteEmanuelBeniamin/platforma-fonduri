/**
 * Ce poate face utilizatorul curent într-un proiect. Le calculează serverul
 * (`projectPermissions` din app/api/_utils/auth.ts) și le trimite în
 * GET /api/projects/[id]; interfața doar ascunde ce serverul refuză oricum.
 */
export type ProjectPermissions = {
  edit_project: boolean
  reassign_project: boolean
  delete_project: boolean
  delete_phases: boolean
  manage_team: boolean
  /** Scoate orice membru, inclusiv seniori. Seniorul scoate doar juniori, nu și pe el. */
  remove_any_member: boolean
  /** Șterge mesajele altora din chat. */
  moderate_chat: boolean
  /** Modifică textul mesajelor altora. Doar adminul. */
  edit_others_messages: boolean
  /** Încheie și redeschide proiectul (#109). */
  close_project: boolean
  /**
   * Marchează faze, activități și cereri ca finalizate și le redeschide (#109,
   * D1). Azi are aceeași valoare ca `close_project`, dar e alt rând în matricea
   * de drepturi și se poate despărți fără să atingem interfața.
   */
  complete_items: boolean
}

/**
 * Cine deschide dosare (proiecte noi): adminul și consultantul senior.
 * Juniorul lucrează doar în proiectele în care e adăugat. Același test pe
 * server (POST /api/projects) și în interfață (butonul „Proiect nou”).
 */
export function canCreateProjects(
  profile: { role?: string | null; consultant_level?: string | null } | null | undefined,
) {
  return profile?.role === 'admin' || (profile?.role === 'consultant' && profile.consultant_level === 'senior')
}

export const NO_PROJECT_PERMISSIONS: ProjectPermissions = {
  edit_project: false,
  reassign_project: false,
  delete_project: false,
  delete_phases: false,
  manage_team: false,
  remove_any_member: false,
  moderate_chat: false,
  edit_others_messages: false,
  close_project: false,
  complete_items: false,
}
