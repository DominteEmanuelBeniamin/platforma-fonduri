// Convențiile vizuale ale unui eveniment de calendar (#69).
//
// Cinci informații pe cinci canale independente, ca să se poată citi simultan:
//   fundal        → persoana responsabilă (aceeași culoare ca avatarul ei)
//   iconiță       → tipul elementului (aceleași iconițe ca în comutatorul paginii)
//   stil contur   → întrerupt = „În pregătire", continuu = publicat
//   culoare contur→ roșu = termen depășit
//   text tăiat    → finalizat
//
// Culoarea de fond rămâne a persoanei și când elementul e depășit; urgența
// trece pe contur, ca cele două să nu se suprapună.

import type { CSSProperties } from 'react'
import { FolderOpen, Layers } from 'lucide-react'
import { getAvatarColor } from '@/lib/avatar'
import { LIGHT_INK, readableInk } from '@/lib/contrast'
import {
  KIND_LABELS,
  PROGRESS_LABELS,
  VISIBILITY_LABELS,
  eventProgress,
  formatShortDate,
  type CalendarEvent,
  type CalendarProgress,
} from '@/lib/calendar'

/** Gri neutru: nimeni nu răspunde de element, pe niciun nivel. */
const NEUTRAL_COLOR = { from: '#94A3B8', to: '#64748B' }

/** `--p-danger`, cu rezervă pentru contextele din afara `.project-scope`. */
const OVERDUE_BORDER = 'var(--p-danger, #B94A3D)'

export const KIND_ICONS = {
  activity: Layers,
  request: FolderOpen,
} as const

export function ownerColor(event: Pick<CalendarEvent, 'assignee_id' | 'assignee_name'>) {
  if (!event.assignee_id) return NEUTRAL_COLOR
  // Restul aplicației colorează avatarul după numele afișat; aceeași cheie, ca
  // persoana să aibă o singură culoare peste tot.
  return getAvatarColor(event.assignee_name || event.assignee_id)
}


export function eventSurfaceStyle(
  event: Pick<CalendarEvent, 'assignee_id' | 'assignee_name' | 'visibility'>,
  progress: CalendarProgress,
): CSSProperties {
  const color = ownerColor(event)
  const ink = readableInk(color.from)
  return {
    backgroundImage: `linear-gradient(135deg, ${color.from}, ${color.to})`,
    color: ink,
    borderStyle: event.visibility === 'draft' ? 'dashed' : 'solid',
    borderColor: progress === 'overdue'
      ? OVERDUE_BORDER
      : ink === LIGHT_INK
      ? 'rgba(255,255,255,0.5)'
      : 'rgba(31,41,55,0.35)',
  }
}

/**
 * Eticheta citită de cititoarele de ecran și afișată la hover. Repetă în
 * cuvinte tot ce spun culorile — informația nu trebuie transmisă exclusiv prin
 * culoare.
 */
export function eventAriaLabel(
  event: CalendarEvent,
  progress: CalendarProgress,
  options: { withProject?: boolean } = {},
): string {
  const context = event.phase_name
    ? event.kind === 'request' && event.activity_name
      ? `${event.phase_name} / ${event.activity_name}`
      : event.phase_name
    : 'Cereri generale'

  return [
    KIND_LABELS[event.kind],
    event.name,
    options.withProject && event.project_title ? `proiect ${event.project_title}` : null,
    context,
    event.deadline_at ? `termen ${formatShortDate(event.deadline_at)}` : 'fără termen',
    PROGRESS_LABELS[progress],
    VISIBILITY_LABELS[event.visibility],
    event.assignee_name ? `responsabil ${event.assignee_name}` : 'fără responsabil',
  ]
    .filter(Boolean)
    .join(', ')
}

/** Depășitele primele, finalizatele la urmă; în rest, alfabetic. */
const PROGRESS_RANK: Record<CalendarProgress, number> = { overdue: 0, open: 1, done: 2 }

export function compareEvents(a: CalendarEvent, b: CalendarEvent): number {
  const byProgress = PROGRESS_RANK[eventProgress(a)] - PROGRESS_RANK[eventProgress(b)]
  if (byProgress !== 0) return byProgress
  if (a.kind !== b.kind) return a.kind === 'activity' ? -1 : 1
  return a.name.localeCompare(b.name, 'ro')
}
