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
  moderate_chat: boolean
}

export const NO_PROJECT_PERMISSIONS: ProjectPermissions = {
  edit_project: false,
  reassign_project: false,
  delete_project: false,
  delete_phases: false,
  manage_team: false,
  moderate_chat: false,
}
