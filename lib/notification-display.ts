/**
 * Compunerea unui rând de notificare, fără nicio dependență: panoul, pagina și
 * testele citesc aceleași reguli. Rândurile scrise înainte de `entity_label` au
 * numele în titlu, iar cele scrise după îl au separat — de asta subiectul se
 * alege aici, o singură dată, și nu în două componente.
 */

export const NOTIFICATION_TYPES = ['publication', 'assignment', 'deadline', 'document_action'] as const

export type NotificationTypeName = (typeof NOTIFICATION_TYPES)[number]

export const NOTIFICATION_TYPE_LABELS: Record<NotificationTypeName, string> = {
  publication: 'Publicări',
  assignment: 'Atribuiri',
  deadline: 'Termene',
  document_action: 'Documente',
}

export type NotificationDisplayItem = {
  type: string
  title: string
  actorName?: string | null
  entityLabel?: string | null
  projectTitle?: string | null
  itemCount: number
  createdAt: string
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** 20 de minute, dar 2 minute: româna cere „de” de la 20 în sus. */
function countedNoun(count: number, plural: string): string {
  return count >= 20 ? `${count} de ${plural}` : `${count} ${plural}`
}

function startOfDay(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
}

const WEEK = 7 * DAY

/** Luni, ca în calendarul românesc. O fereastră de 7 zile ar trece peste hotarul săptămânii. */
function startOfWeek(value: Date): number {
  const start = new Date(value.getFullYear(), value.getMonth(), value.getDate())
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  return start.getTime()
}

export function formatNotificationDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('ro-RO', { dateStyle: 'medium', timeStyle: 'short' })
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })
}

/**
 * Ora exactă a unei notificări de acum trei minute nu spune nimic, dar „ieri”
 * fără oră spune prea puțin: din ziua precedentă în jos, rândul arată ziua și
 * ora. Peste o săptămână revine la dată, ca rândurile vechi să rămână
 * identificabile.
 */
export function formatRelativeTime(value: string, now: Date = new Date()): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  const elapsed = now.getTime() - date.getTime()
  if (elapsed < 0) return formatNotificationDate(value)
  if (elapsed < MINUTE) return 'chiar acum'
  if (elapsed < HOUR) {
    const minutes = Math.floor(elapsed / MINUTE)
    return `acum ${minutes === 1 ? 'un minut' : countedNoun(minutes, 'minute')}`
  }
  if (elapsed < DAY) {
    const hours = Math.floor(elapsed / HOUR)
    return `acum ${hours === 1 ? 'o oră' : countedNoun(hours, 'ore')}`
  }

  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY)
  if (days <= 1) return `ieri, ${formatTime(date)}`
  // Numele zilei e mai ușor de plasat decât „acum 4 zile”, dar numai înăuntrul
  // săptămânii curente: „sâmbătă” într-o zi de joi ar arăta către o sâmbătă care
  // n-a venit încă.
  if (startOfDay(date) >= startOfWeek(now)) {
    return `${date.toLocaleDateString('ro-RO', { weekday: 'long' })}, ${formatTime(date)}`
  }
  return formatNotificationDate(value)
}

/** Antetul sub care se strâng rândurile din aceeași zi. */
export function notificationDayGroup(value: string, now: Date = new Date()): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Mai demult'

  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY)
  if (days <= 0) return 'Astăzi'
  if (days === 1) return 'Ieri'
  const weekStart = startOfWeek(now)
  if (startOfDay(date) >= weekStart) return 'Săptămâna aceasta'
  if (startOfDay(date) >= weekStart - WEEK) return 'Săptămâna trecută'
  return date.toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' })
}

/** Titlul digesturilor poartă numărul de elemente; cele individuale, nu. */
export function notificationAction(item: NotificationDisplayItem): string {
  if (item.type === 'publication') {
    const label = item.itemCount === 1 ? 'Element nou publicat' : 'Elemente noi publicate'
    return item.itemCount > 1 ? `${label} (${item.itemCount})` : label
  }
  if (item.itemCount > 1) return `${item.title} (${item.itemCount})`
  return item.title
}

/**
 * Prima linie e lucrul despre care e vorba. Fără `entity_label` — rânduri vechi
 * sau digesturi peste mai multe elemente — rămâne acțiunea, care în cazul lor
 * chiar e tot ce se poate spune.
 */
export function notificationSubject(item: NotificationDisplayItem): string {
  const label = item.entityLabel?.trim()
  return label || notificationAction(item)
}

/**
 * A doua linie: ce s-a întâmplat, cine a făcut-o și unde. Sare peste acțiune
 * când ea e deja pe prima linie, ca rândul să nu se repete pe două rânduri.
 */
export function notificationContext(item: NotificationDisplayItem, now: Date = new Date()): string[] {
  const parts: string[] = []
  const label = item.entityLabel?.trim()
  const actor = item.actorName?.trim()

  if (label) parts.push(actor ? `${notificationAction(item)} de ${actor}` : notificationAction(item))
  else if (actor) parts.push(`de ${actor}`)

  const project = item.projectTitle?.trim()
  parts.push(project || 'Proiect fără titlu')
  parts.push(formatRelativeTime(item.createdAt, now))
  return parts
}
