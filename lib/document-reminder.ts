// =====================================================
// SISTEM REMINDER DOCUMENTE
// Generează reminder-uri automate pentru clienți
// bazate pe zilele rămase până la deadline
// =====================================================

export type ReminderType = '1_week' | '3_days' | '1_day' | 'same_day' | 'overdue'

export interface ReminderContext {
  requestName: string
  requestDescription: string | null
  deadlineAt: string | null
  clientEmail: string
  clientName: string | null
  projectTitle: string
  projectId: string
}

// ─── Calcul zile rămase ──────────────────────────────────────────────────────

/**
 * Returnează numărul de zile întregi rămase până la deadline.
 * Negativ dacă deadline-ul a trecut. Null dacă nu există deadline.
 * Comparație la nivel de zi (fără oră).
 */
export function getDaysUntilDeadline(deadlineAt: string | null): number | null {
  if (!deadlineAt) return null
  const now = new Date()
  const deadline = new Date(deadlineAt)
  const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const deadlineDay = new Date(deadline.getFullYear(), deadline.getMonth(), deadline.getDate())
  const diffMs = deadlineDay.getTime() - nowDay.getTime()
  return Math.round(diffMs / (1000 * 60 * 60 * 24))
}

// ─── Tip reminder ────────────────────────────────────────────────────────────

/**
 * Selectează tipul de reminder potrivit în funcție de zilele rămase.
 *
 * Reguli:
 *   overdue   → deadline trecut (days < 0)
 *   same_day  → deadline astăzi (days == 0)
 *   1_day     → 1–2 zile rămase
 *   3_days    → 3–6 zile rămase
 *   1_week    → 7+ zile rămase
 *
 * Returnează null dacă nu există deadline.
 */
export function getReminderType(deadlineAt: string | null): ReminderType | null {
  const days = getDaysUntilDeadline(deadlineAt)
  if (days === null) return null
  if (days < 0) return 'overdue'
  if (days === 0) return 'same_day'
  if (days <= 2) return '1_day'
  if (days <= 6) return '3_days'
  return '1_week'
}

// ─── Labels & culori ─────────────────────────────────────────────────────────

export const REMINDER_LABELS: Record<ReminderType, string> = {
  '1_week':   'Reminder 1 săptămână',
  '3_days':   'Reminder 3 zile',
  '1_day':    'Reminder mâine',
  'same_day': 'Reminder astăzi',
  'overdue':  'Termen expirat',
}

export const REMINDER_BADGE: Record<ReminderType, { bg: string; text: string; border: string }> = {
  '1_week':   { bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200'  },
  '3_days':   { bg: 'bg-amber-50',  text: 'text-amber-700',  border: 'border-amber-200' },
  '1_day':    { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200'},
  'same_day': { bg: 'bg-red-50',    text: 'text-red-700',    border: 'border-red-200'   },
  'overdue':  { bg: 'bg-rose-50',   text: 'text-rose-700',   border: 'border-rose-200'  },
}

// ─── Formatare dată ───────────────────────────────────────────────────────────

function formatDeadline(deadlineAt: string): string {
  return new Date(deadlineAt).toLocaleDateString('ro-RO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

// ─── Template-uri email ───────────────────────────────────────────────────────

export interface ReminderEmailContent {
  subject: string
  textBody: string
}

/**
 * Generează subiectul și corpul textual al emailului de reminder,
 * adaptat în funcție de tipul de reminder și contextul documentului.
 */
export function generateReminderEmailContent(
  ctx: ReminderContext,
  type: ReminderType
): ReminderEmailContent {
  const salut = ctx.clientName ? `Bună ziua, ${ctx.clientName},` : 'Bună ziua,'
  const deadline = ctx.deadlineAt ? formatDeadline(ctx.deadlineAt) : null
  const days = getDaysUntilDeadline(ctx.deadlineAt)
  const appUrl = typeof window !== 'undefined'
    ? window.location.origin
    : (process.env.NEXT_PUBLIC_APP_URL ?? '')

  const lines: (string | null)[] = [salut, '']

  // ── Paragraf de deschidere ────────────────────────────────────────────────
  if (type === '1_week') {
    lines.push(
      `Vă contactăm pentru a vă aminti că aveți un document necesar în aproximativ o săptămână ` +
      `pentru proiectul "${ctx.projectTitle}". Vă recomandăm să pregătiți documentul din timp ` +
      `pentru a evita întârzierile.`
    )
  } else if (type === '3_days') {
    lines.push(
      `Vă atragem atenția că termenul limită pentru un document important din proiectul ` +
      `"${ctx.projectTitle}" se apropie — mai aveți ${days} ${days === 1 ? 'zi' : 'zile'} ` +
      `la dispoziție. Vă rugăm să acționați cât mai curând.`
    )
  } else if (type === '1_day') {
    lines.push(
      `Termenul limită pentru documentul solicitat în cadrul proiectului "${ctx.projectTitle}" ` +
      `expiră mâine. Vă rugăm să încărcați documentul astăzi pe platformă.`
    )
  } else if (type === 'same_day') {
    lines.push(
      `Termenul limită pentru documentul solicitat în cadrul proiectului "${ctx.projectTitle}" ` +
      `expiră ASTĂZI. Este necesară acțiunea imediată pentru a nu întârzia procesarea dosarului.`
    )
  } else {
    lines.push(
      `Termenul limită pentru documentul solicitat în cadrul proiectului "${ctx.projectTitle}" ` +
      `a expirat. Vă rugăm să ne contactați de urgență pentru a discuta despre pașii următori ` +
      `și posibilele consecințe asupra dosarului.`
    )
  }

  // ── Detalii document ──────────────────────────────────────────────────────
  lines.push('')
  lines.push('─────────────────────────────────────')
  lines.push(`Document: ${ctx.requestName}`)
  if (ctx.requestDescription) {
    lines.push(`Descriere: ${ctx.requestDescription}`)
  }
  if (deadline) {
    lines.push(`Termen limită: ${deadline}`)
  }
  lines.push(`Proiect: ${ctx.projectTitle}`)
  lines.push('─────────────────────────────────────')
  lines.push('')

  // ── Instrucțiuni specifice ────────────────────────────────────────────────
  if (type === '1_week') {
    lines.push(
      'Ce trebuie să faceți:',
      '1. Pregătiți documentul solicitat (scanare sau export PDF).',
      '2. Accesați platforma și mergeți la proiectul dumneavoastră.',
      '3. Încărcați documentul în secțiunea corespunzătoare.',
      '4. Confirmați că documentul a fost trimis spre revizuire.',
    )
  } else if (type === '3_days') {
    lines.push(
      'Pași imediați:',
      '1. Accesați platforma cât mai curând.',
      '2. Navigați la proiectul dumneavoastră și găsiți cererea de document.',
      '3. Încărcați documentul necesar.',
      '',
      'Dacă întâmpinați dificultăți în pregătirea documentului, contactați-ne imediat.',
    )
  } else if (type === '1_day') {
    lines.push(
      'Acțiune urgentă necesară:',
      '- Accesați platforma astăzi și încărcați documentul.',
      '- Dacă nu puteți livra documentul în timp util, contactați-ne imediat.',
    )
  } else if (type === 'same_day') {
    lines.push(
      'ACȚIUNE IMEDIATĂ NECESARĂ:',
      '- Accesați platforma și încărcați documentul chiar acum.',
      '- Orice întârziere poate afecta procesarea dosarului dumneavoastră.',
      '- Pentru asistență urgentă, contactați consultantul atribuit.',
    )
  } else {
    lines.push(
      'Este important să ne contactați cât mai rapid pentru a:',
      '- Evalua situația și impactul asupra dosarului.',
      '- Stabili dacă documentul mai poate fi acceptat.',
      '- Identifica soluții alternative, dacă există.',
    )
  }

  lines.push('')
  lines.push(`Accesați platforma: ${appUrl}`)
  lines.push('')
  lines.push('Cu respect,')
  lines.push('Echipa de consultanță')
  lines.push('Platforma Fonduri EU')

  const subject = buildSubject(ctx, type)
  const textBody = lines.filter(l => l !== null).join('\n')

  return { subject, textBody }
}

function buildSubject(ctx: ReminderContext, type: ReminderType): string {
  switch (type) {
    case '1_week':
      return `Reminder: Document necesar în ~1 săptămână — ${ctx.requestName} [${ctx.projectTitle}]`
    case '3_days':
      return `Urgent: Document necesar în 3 zile — ${ctx.requestName} [${ctx.projectTitle}]`
    case '1_day':
      return `Urgent: Document necesar mâine — ${ctx.requestName} [${ctx.projectTitle}]`
    case 'same_day':
      return `ASTĂZI: Termen limită document — ${ctx.requestName} [${ctx.projectTitle}]`
    case 'overdue':
      return `Termen expirat: Document întârziat — ${ctx.requestName} [${ctx.projectTitle}]`
  }
}

// ─── Mailto link ──────────────────────────────────────────────────────────────

/**
 * Generează un link mailto: cu recipient, subiect și corp completate automat.
 * Deschide clientul de email al utilizatorului cu draft-ul pregătit.
 */
export function generateMailtoLink(ctx: ReminderContext, type: ReminderType): string {
  const { subject, textBody } = generateReminderEmailContent(ctx, type)
  // URLSearchParams codifică + în loc de %20 pentru spații — corectăm pentru mailto:
  const params = new URLSearchParams({ subject, body: textBody })
  const encoded = params.toString().replace(/\+/g, '%20')
  return `mailto:${ctx.clientEmail}?${encoded}`
}
