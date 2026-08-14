import { formatDeadline, REMINDER_LABELS, type ReminderType } from './document-reminder.ts'

export type ReminderEmailAudience = 'client' | 'consultant'

export interface ReminderEmailItem {
  entityType: 'request' | 'activity'
  entityId: string
  name: string
  description: string | null
  projectTitle: string
  deadlineAt: string
  threshold: ReminderType
  days: number
  url: string
}

export interface ReminderEmailDigestInput {
  audience: ReminderEmailAudience
  recipientName: string | null
  dashboardUrl: string
  items: ReminderEmailItem[]
}

export interface ReminderEmailDigest {
  subject: string
  text: string
  html: string
  items: ReminderEmailItem[]
  mostUrgent: ReminderEmailItem
}

const URGENCY: Record<ReminderType, number> = {
  '1_week': 1,
  '3_days': 2,
  '1_day': 3,
  same_day: 4,
  overdue: 5,
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidReminderEmail(value: unknown): value is string {
  return typeof value === 'string' && EMAIL_PATTERN.test(value.trim())
}

export function sanitizeReminderSubject(value: string) {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function daysLabel(days: number, absolute = false) {
  const value = absolute ? Math.abs(days) : days
  return `${value} ${value === 1 ? 'zi' : 'zile'}`
}

function urgencyText(item: ReminderEmailItem) {
  return item.threshold === 'overdue'
    ? `termen depășit cu ${daysLabel(item.days, true)}`
    : `mai sunt ${daysLabel(item.days)}`
}

function sortItems(items: ReminderEmailItem[]) {
  return [...items].sort((a, b) =>
    URGENCY[b.threshold] - URGENCY[a.threshold] ||
    a.deadlineAt.localeCompare(b.deadlineAt) ||
    a.projectTitle.localeCompare(b.projectTitle, 'ro') ||
    a.name.localeCompare(b.name, 'ro'),
  )
}

function itemText(item: ReminderEmailItem) {
  const details = [
    `- ${item.name} — ${item.projectTitle}`,
    `  ${REMINDER_LABELS[item.threshold]} · ${urgencyText(item)}`,
    `  Termen: ${formatDeadline(item.deadlineAt)}`,
    item.description ? `  Detalii: ${item.description}` : null,
    `  Deschide: ${item.url}`,
  ]
  return details.filter(Boolean).join('\n')
}

function itemHtml(item: ReminderEmailItem) {
  const description = item.description
    ? `<p style="margin:8px 0;color:#475569;font-size:14px;line-height:1.5;">${escapeHtml(item.description).replace(/\n/g, '<br>')}</p>`
    : ''
  return '<li style="margin:0 0 14px;padding:14px 16px;border:1px solid #e2e8f0;border-radius:8px;list-style-position:inside;">' +
    `<a href="${escapeHtml(item.url)}" style="color:#4f46e5;font-weight:600;text-decoration:none;">${escapeHtml(item.name)}</a>` +
    `<div style="margin-top:5px;color:#475569;font-size:13px;">${escapeHtml(item.projectTitle)} · ${escapeHtml(REMINDER_LABELS[item.threshold])} · ${escapeHtml(urgencyText(item))}</div>` +
    `<div style="margin-top:5px;color:#64748b;font-size:13px;">Termen: ${escapeHtml(formatDeadline(item.deadlineAt))}</div>` +
    description +
    '</li>'
}

function subjectFor(audience: ReminderEmailAudience, item: ReminderEmailItem) {
  const prefix = item.threshold === 'overdue'
    ? 'Termen depășit'
    : audience === 'consultant' ? 'Reminder de gestionat' : 'Reminder document'
  return sanitizeReminderSubject(`${prefix}: ${item.name} — ${urgencyText(item)} — ${item.projectTitle}`)
}

export function renderReminderDigest(input: ReminderEmailDigestInput): ReminderEmailDigest {
  const items = sortItems(input.items.filter(item => input.audience !== 'client' || item.entityType === 'request'))
  if (items.length === 0) throw new Error('Reminder digest requires at least one item')

  const mostUrgent = items[0]
  const greeting = input.recipientName
    ? input.audience === 'client'
      ? `Bună ziua, ${input.recipientName},`
      : `Salut, ${input.recipientName},`
    : input.audience === 'client' ? 'Bună ziua,' : 'Salut,'
  const clientIntro = `Aveți ${items.length} ${items.length === 1 ? 'document' : 'documente'} care necesită atenție.`
  const activityItems = items.filter(item => item.entityType === 'activity')
  const overdueRequestItems = items.filter(item => item.entityType === 'request' && item.threshold === 'overdue')
  const consultantIntro = `Ai ${items.length} ${items.length === 1 ? 'element' : 'elemente'} de gestionat.`

  const textSections = input.audience === 'client'
    ? [clientIntro, '', items.map(itemText).join('\n\n')]
    : [
        consultantIntro,
        '',
        activityItems.length ? `Activități:\n${activityItems.map(itemText).join('\n\n')}` : null,
        overdueRequestItems.length ? `Cereri cu termen depășit:\n${overdueRequestItems.map(itemText).join('\n\n')}` : null,
      ].filter(Boolean) as string[]

  const text = [
    greeting,
    '',
    ...textSections,
    '',
    `Deschide platforma: ${input.dashboardUrl}`,
    '',
    input.audience === 'client' ? 'Cu respect,' : 'Mulțumesc,',
    input.audience === 'client' ? 'Echipa de consultanță' : 'Platforma Fonduri EU',
  ].join('\n')

  const htmlSections = input.audience === 'client'
    ? `<h2 style="font-size:16px;color:#0f172a;">Documente</h2><ol style="margin:0;padding-left:22px;">${items.map(itemHtml).join('')}</ol>`
    : [
        activityItems.length ? `<h2 style="font-size:16px;color:#0f172a;">Activități</h2><ol style="margin:0;padding-left:22px;">${activityItems.map(itemHtml).join('')}</ol>` : '',
        overdueRequestItems.length ? `<h2 style="font-size:16px;color:#0f172a;">Cereri cu termen depășit</h2><ol style="margin:0;padding-left:22px;">${overdueRequestItems.map(itemHtml).join('')}</ol>` : '',
      ].join('')

  const heading = mostUrgent.threshold === 'overdue'
    ? 'Termene depășite'
    : input.audience === 'client' ? 'Remindere pentru documente' : 'Remindere de gestionat'
  const html = '<!doctype html><html lang="ro"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>' +
    '<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#1e293b;">' +
    '<div style="max-width:680px;margin:24px auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">' +
    `<div style="background:linear-gradient(135deg,#4f46e5,#6366f1);padding:28px 32px;"><h1 style="margin:0;color:#fff;font-size:22px;">${escapeHtml(heading)}</h1><p style="margin:8px 0 0;color:#c7d2fe;font-size:14px;">${escapeHtml(mostUrgent.projectTitle)}</p></div>` +
    `<div style="padding:28px 32px;"><p style="margin:0 0 18px;color:#334155;font-size:15px;">${escapeHtml(greeting)}</p><p style="margin:0 0 22px;color:#334155;font-size:15px;line-height:1.6;">${escapeHtml(input.audience === 'client' ? clientIntro : consultantIntro)}</p>${htmlSections}<p style="margin:24px 0 0;"><a href="${escapeHtml(input.dashboardUrl)}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:14px;font-weight:600;">Deschide platforma</a></p></div>` +
    '<div style="padding:18px 32px;border-top:1px solid #f1f5f9;"><p style="margin:0;color:#94a3b8;font-size:12px;">Acest email a fost generat automat de Platforma Fonduri EU.</p></div>' +
    '</div></body></html>'

  return {
    subject: subjectFor(input.audience, mostUrgent),
    text,
    html,
    items,
    mostUrgent,
  }
}
