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
}
