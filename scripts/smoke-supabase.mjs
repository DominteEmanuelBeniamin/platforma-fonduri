import nextEnv from '@next/env'
import { createClient } from '@supabase/supabase-js'

const { loadEnvConfig } = nextEnv
loadEnvConfig(process.cwd())

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  console.error('Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const newColumns = 'id,user_id,project_id,type,entity_type,entity_id,title,item_count,event_key,created_at,read_at'
const legacyColumns = 'id,user_id,type,title,message,priority,entity_type,entity_id,is_read,read_at,created_at'

const [newSchema, legacySchema, rowCount] = await Promise.all([
  admin.from('notifications').select(newColumns).limit(1),
  admin.from('notifications').select(legacyColumns).limit(1),
  admin.from('notifications').select('id', { count: 'exact', head: true }),
])

// Migrația 20260823 (corecțiile de review pentru #78). Cu cheia de service
// `auth.uid()` e null, deci niciuna dintre sonde nu citește și nu scrie rânduri:
// sumarul întoarce lista goală, iar marcarea ca citit se oprește în garda de
// autentificare. Lipsa funcției se vede ca PGRST202.
const nilUuid = '00000000-0000-0000-0000-000000000000'
// `p_project_id: null` cade în validarea de la începutul funcției, deci sonda
// nu inserează nimic. Cu `p_severity` prezent, PGRST202 ar însemna că a rămas
// doar semnătura veche, fără severitate.
const eventArgs = {
  p_project_id: null,
  p_type: 'assignment',
  p_entity_type: 'activity',
  p_entity_id: null,
  p_title: 'smoke',
  p_item_count: 1,
  p_event_key: 'smoke',
  p_recipient_id: null,
  p_include_admins: false,
  p_fallback_to_project_members: false,
  p_require_recipient: false,
}

// Migrația 20260824 (panoul de notificări). Aceleași reguli: sondele nu scriu
// nimic, iar funcțiile de stare se opresc în garda de autentificare.
const panelEventArgs = { ...eventArgs, p_severity: 'info', p_actor_name: null, p_entity_label: null }

const [severityColumn, unreadSummary, markRead, canSelect, eventWithSeverity, eventLegacyArity] =
  await Promise.all([
    admin.from('notifications').select('id,severity').limit(1),
    admin.rpc('notification_unread_summary'),
    admin.rpc('mark_notifications_read', { p_ids: [nilUuid] }),
    admin.rpc('can_select_notification', {
      p_project_id: nilUuid,
      p_entity_type: 'project',
      p_entity_id: nilUuid,
    }),
    admin.rpc('insert_notification_event', { ...eventArgs, p_severity: 'info' }),
    admin.rpc('insert_notification_event', eventArgs),
  ])

const [panelColumns, activityAssignedBy, requestAssignedBy, entityLabel, markUnread, dismiss, eventWithActor] =
  await Promise.all([
    admin.from('notifications').select('id,dismissed_at,actor_name,entity_label').limit(1),
    admin.from('project_activities').select('id,assigned_by').limit(1),
    admin.from('document_requirements').select('id,assigned_by').limit(1),
    admin.rpc('notification_entity_label', { p_entity_type: 'project', p_entity_id: nilUuid }),
    admin.rpc('mark_notifications_unread', { p_ids: [nilUuid] }),
    admin.rpc('dismiss_notifications', { p_ids: [nilUuid] }),
    admin.rpc('insert_notification_event', panelEventArgs),
  ])

const missing = (probe) => probe.error?.code === 'PGRST202' || probe.error?.code === '42883'
const fixes = {
  severityColumn: !severityColumn.error,
  // Garda de autentificare e chiar dovada că funcția există și rulează.
  notificationUnreadSummary: !unreadSummary.error,
  markNotificationsRead: !missing(markRead),
  canSelectNotification: !missing(canSelect),
  insertNotificationEventSeverity: !missing(eventWithSeverity),
  // Un apel cu 11 argumente e ambiguu (PGRST203) doar dacă a rămas și
  // supraîncărcarea veche, fără severitate, pe lângă cea nouă.
  legacyEventOverloadDropped: eventLegacyArity.error?.code !== 'PGRST203',
}
const fixesApplied = Object.values(fixes).every(Boolean)

const panel = {
  panelColumns: !panelColumns.error,
  activityAssignedBy: !activityAssignedBy.error,
  requestAssignedBy: !requestAssignedBy.error,
  notificationEntityLabel: !missing(entityLabel),
  markNotificationsUnread: !missing(markUnread),
  dismissNotifications: !missing(dismiss),
  insertNotificationEventActor: !missing(eventWithActor),
  // Un apel cu 12 argumente e ambiguu doar dacă a rămas și supraîncărcarea
  // fără actor, pe lângă cea nouă.
  severityOnlyOverloadDropped: eventWithSeverity.error?.code !== 'PGRST203',
}
const panelApplied = Object.values(panel).every(Boolean)

const result = {
  projectHost: new URL(url).host,
  table: {
    newSchema: !newSchema.error,
    legacySchema: !legacySchema.error,
    legacyContractRejected: Boolean(legacySchema.error),
    empty: rowCount.error ? null : rowCount.count === 0,
  },
  // 20260823_notification_center_fixes: aplicată sau nu.
  fixes: { ...fixes, applied: fixesApplied },
  // 20260824_notification_center_panel: aplicată sau nu.
  panel: { ...panel, applied: panelApplied },
  errors: {
    newSchema: newSchema.error?.code ?? null,
    legacySchema: legacySchema.error?.code ?? null,
    rowCount: rowCount.error?.code ?? null,
    severityColumn: severityColumn.error?.code ?? null,
    notificationUnreadSummary: unreadSummary.error?.code ?? null,
    markNotificationsRead: markRead.error?.code ?? null,
    canSelectNotification: canSelect.error?.code ?? null,
    insertNotificationEventSeverity: eventWithSeverity.error?.code ?? null,
    insertNotificationEventLegacyArity: eventLegacyArity.error?.code ?? null,
    panelColumns: panelColumns.error?.code ?? null,
    activityAssignedBy: activityAssignedBy.error?.code ?? null,
    requestAssignedBy: requestAssignedBy.error?.code ?? null,
    notificationEntityLabel: entityLabel.error?.code ?? null,
    markNotificationsUnread: markUnread.error?.code ?? null,
    dismissNotifications: dismiss.error?.code ?? null,
    insertNotificationEventActor: eventWithActor.error?.code ?? null,
  },
}

console.log(JSON.stringify(result, null, 2))
console.log(fixesApplied
  ? '\n20260823_notification_center_fixes: APLICATĂ'
  : '\n20260823_notification_center_fixes: NEAPLICATĂ — rulează migrația înainte de deploy')
console.log(panelApplied
  ? '20260824_notification_center_panel: APLICATĂ'
  : '20260824_notification_center_panel: NEAPLICATĂ — rulează migrația înainte de deploy')

if (newSchema.error || rowCount.error || !legacySchema.error || !fixesApplied || !panelApplied) {
  process.exitCode = 1
}
