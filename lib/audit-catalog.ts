export const AUDIT_ACTION_LABELS = {
  login: 'Autentificare',
  logout: 'Deconectare',
  create: 'Creare',
  add: 'Adăugare',
  update: 'Modificare',
  publish: 'Publicare',
  propagate: 'Propagare',
  delete: 'Ștergere',
  download: 'Descărcare',
  notify: 'Notificare',
  deadline_reminder_digest: 'Digest de remindere',
} as const

export const AUDIT_ENTITY_LABELS = {
  user: 'Utilizator',
  project: 'Proiect',
  document: 'Document',
  document_request: 'Cerere de document',
  document_review: 'Verificare document',
  request: 'Cerere',
  file: 'Fișier',
  file_access: 'Acces fișier',
  team_member: 'Membru echipă',
  phase: 'Fază',
  activity: 'Activitate',
  chat_message: 'Mesaj chat',
  template: 'Șablon',
  template_phase: 'Fază șablon',
  template_activity: 'Activitate șablon',
  template_document: 'Document șablon',
  template_document_requirement: 'Cerință document șablon',
  status: 'Status',
  status_reorder: 'Reordonare status',
  phase_reorder: 'Reordonare faze',
  activity_reorder: 'Reordonare activități',
  document_request_reorder: 'Reordonare cereri de documente',
  project_phase: 'Fază proiect',
  project_activity: 'Activitate proiect',
  project_member: 'Membru proiect',
  client: 'Client',
  private_conversation: 'Conversație privată',
  private_message: 'Mesaj privat',
  audit_log: 'Jurnal audit',
  deadline_reminder_digest: 'Digest de remindere',
} as const

export function auditActorEmail(log: {
  user_id: string | null
  action_type: string
  entity_type: string
  entity_id: string | null
  entity_name: string | null
  user?: { email: string | null } | null
  actor_email?: string | null
}): string {
  if (log.user?.email) return log.user.email
  return log.user_id && (log.user_id === log.entity_id || log.entity_id === null) && log.entity_type === 'user'
    && (log.action_type === 'login' || log.action_type === 'logout')
    ? log.entity_name?.trim() || log.actor_email?.trim() || ''
    : ''
}
