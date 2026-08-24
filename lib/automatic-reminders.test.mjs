import assert from 'node:assert/strict'
import test from 'node:test'

import {
  REMINDERS_ERROR_MESSAGE,
  automaticRemindersEnabled,
  remindersActionLabel,
  remindersDoneMessage,
  remindersOffConfirm,
  saveAutomaticReminders,
} from './automatic-reminders.ts'

test('un proiect despre care nu știm nimic are reminderele pornite', () => {
  // Coloana e `not null default true`, dar un `select` care n-o cere lasă
  // câmpul nedefinit — iar necunoscutul nu trebuie să oprească tăcut emailurile.
  assert.equal(automaticRemindersEnabled({}), true)
  assert.equal(automaticRemindersEnabled({ automatic_reminders_enabled: undefined }), true)
  assert.equal(automaticRemindersEnabled({ automatic_reminders_enabled: null }), true)
  assert.equal(automaticRemindersEnabled({ automatic_reminders_enabled: true }), true)
  // Doar un `false` explicit oprește.
  assert.equal(automaticRemindersEnabled({ automatic_reminders_enabled: false }), false)
})

test('eticheta spune ce face apăsarea, nu ce e acum', () => {
  assert.equal(remindersActionLabel(true), 'Oprește reminderele automate')
  assert.equal(remindersActionLabel(false), 'Pornește reminderele automate')
})

test('mesajul de după spune ce s-a întâmplat', () => {
  assert.equal(remindersDoneMessage(true), 'Reminderele automate au fost pornite.')
  assert.equal(remindersDoneMessage(false), 'Reminderele automate au fost oprite.')
})

test('confirmarea numește proiectul, ca să nu oprești altul din greșeală', () => {
  const dialog = remindersOffConfirm('F1 - ACHIZIȚIE')
  assert.match(dialog.description, /F1 - ACHIZIȚIE/)
  assert.equal(dialog.confirmText, 'Oprește reminderele')
})

const fakeFetch = (ok, body) => async (url, init) => {
  fakeFetch.lastCall = { url, init }
  return { ok, json: async () => body }
}

test('starea salvată e cea confirmată de server, nu cea cerută', async () => {
  const saved = await saveAutomaticReminders(
    fakeFetch(true, { project: { automatic_reminders_enabled: true } }),
    'p1',
    false,
  )
  assert.equal(saved, true)
  assert.equal(fakeFetch.lastCall.url, '/api/projects/p1')
  assert.equal(fakeFetch.lastCall.init.method, 'PATCH')
  assert.deepEqual(JSON.parse(fakeFetch.lastCall.init.body), { automatic_reminders_enabled: false })
})

test('un răspuns fără proiect cade pe ce s-a cerut', async () => {
  assert.equal(await saveAutomaticReminders(fakeFetch(true, {}), 'p1', false), false)
  assert.equal(await saveAutomaticReminders(fakeFetch(true, null), 'p1', true), true)
})

test('un răspuns cu eroare aruncă, ca ecranul să nu arate o stare care nu s-a salvat', async () => {
  await assert.rejects(
    () => saveAutomaticReminders(fakeFetch(false, { error: 'Nope' }), 'p1', false),
    /Nope/,
  )
  assert.equal(typeof REMINDERS_ERROR_MESSAGE, 'string')
})
