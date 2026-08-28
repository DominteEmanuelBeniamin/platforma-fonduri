// Comutatorul de remindere automate (#85), scris o singură dată.
//
// Trăiește în două ecrane — meniul cardului din Home și antetul paginii
// proiectului. Textele, confirmarea și cererea trebuie să fie aceleași în
// amândouă: un „Oprește" care în altă parte scrie altfel, sau o confirmare care
// lipsește într-un loc, sunt exact felul în care două copii ale aceluiași buton
// încep să se poarte diferit.

type ApiFetch = (input: RequestInfo, init?: RequestInit) => Promise<Response>

/**
 * Gardă pe `!== false`, nu pe `=== true`: coloana e `not null default true`, dar
 * un proiect citit printr-un `select` care n-o cere are câmpul nedefinit — iar
 * un proiect despre care nu știm nimic are reminderele pornite, nu oprite.
 * Aceeași alegere ca în filtrul cronului (`deadline-reminder-candidates`).
 */
export const automaticRemindersEnabled = (
  project: { automatic_reminders_enabled?: boolean | null },
): boolean => project.automatic_reminders_enabled !== false

/** Ce face apăsarea, din starea curentă. */
export const remindersActionLabel = (enabled: boolean): string =>
  enabled ? 'Oprește reminderele automate' : 'Pornește reminderele automate'

export const remindersDoneMessage = (enabled: boolean): string =>
  enabled ? 'Reminderele automate au fost pornite.' : 'Reminderele automate au fost oprite.'

export const REMINDERS_ERROR_MESSAGE = 'Nu am putut actualiza reminderele automate. Reîncearcă.'

/** Se confirmă doar oprirea: pornirea la loc nu strică nimic. */
export const remindersOffConfirm = (projectTitle: string) => ({
  title: 'Oprești reminderele automate?',
  description: `Nu se vor mai trimite automat remindere către client sau consultanți pentru proiectul „${projectTitle}”.`,
  confirmText: 'Oprește reminderele',
})

/**
 * Trimite comutarea și întoarce starea confirmată de server, nu pe cea cerută:
 * dacă răspunsul spune altceva, ecranul se aliniază la ce e în bază.
 */
export async function saveAutomaticReminders(
  apiFetch: ApiFetch,
  projectId: string,
  enabled: boolean,
): Promise<boolean> {
  const res = await apiFetch(`/api/projects/${projectId}`, {
    method: 'PATCH',
    body: JSON.stringify({ automatic_reminders_enabled: enabled }),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(json?.error || 'Failed to update automatic reminders')
  return typeof json?.project?.automatic_reminders_enabled === 'boolean'
    ? json.project.automatic_reminders_enabled
    : enabled
}
