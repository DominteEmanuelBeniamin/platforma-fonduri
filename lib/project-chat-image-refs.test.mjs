// Curățarea imaginilor din chat, pe nume de fișier reale.
//
// PostgREST desparte valorile filtrelor după paranteze, iar sanitizarea le
// păstrează în nume: Windows numește duplicatele „poza (1).png". Nequotată,
// calea rupea filtrul cu „22P02: invalid input syntax for type json", deci
// ștergerea unui mesaj nu mai scotea pozele din bucket, iar ruta de cleanup
// întorcea 500. Testul ține forma ghilimelată, fiindcă e singura care trece.

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  projectChatImagePathFilter,
  referencedProjectChatImagePaths,
  removeUnreferencedProjectChatImages,
} from '../app/api/_utils/project-chat-image-refs.ts'
import { sanitizeProjectChatImageName, buildProjectChatImagePath } from './project-chat-images.ts'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const USER = '22222222-2222-4222-8222-222222222222'
const ID = '33333333-3333-4333-8333-333333333333'

const path = name => buildProjectChatImagePath(PROJECT, USER, name, ID)

/** Despachetează valoarea ghilimelată a unui termen `cs`, ca PostgREST. */
function unquote(term) {
  const prefix = 'images.cs.'
  assert.ok(term.startsWith(prefix), `termenul nu e un filtru cs: ${term}`)
  const value = term.slice(prefix.length)
  assert.ok(
    value.startsWith('"') && value.endsWith('"'),
    `valoarea trebuie ghilimelată, altfel parantezele din nume rup filtrul: ${value}`,
  )
  return value.slice(1, -1).replace(/\\(["\\])/g, '$1')
}

/** Client fals: reține filtrul trimis și întoarce rândurile cerute. */
function fakeAdmin(rows = [], removed = []) {
  const calls = { or: [], removed }
  const builder = {
    select: () => builder,
    eq: () => builder,
    is: () => builder,
    or: filter => { calls.or.push(filter); return Promise.resolve({ data: rows, error: null }) },
  }
  return {
    calls,
    from: () => builder,
    storage: {
      from: () => ({
        remove: paths => { removed.push(...paths); return Promise.resolve({ data: null, error: null }) },
      }),
    },
  }
}

test('numele cu paranteze supraviețuiește filtrului', () => {
  const nume = 'poza (1).png'
  assert.equal(sanitizeProjectChatImageName(nume), nume, 'sanitizarea chiar păstrează parantezele')

  const term = projectChatImagePathFilter(path(nume))
  assert.deepEqual(JSON.parse(unquote(term)), [{ path: path(nume) }])
})

test('numele obișnuite trec la fel prin filtru', () => {
  for (const nume of ['poza.png', 'poza mare.jpeg', 'a(b)c.webp', 'Captura de ecran (2).png']) {
    const p = path(nume)
    assert.deepEqual(JSON.parse(unquote(projectChatImagePathFilter(p))), [{ path: p }])
  }
})

test('lotul păstrează fiecare cale întreagă, separate prin virgulă', async () => {
  const paths = [path('a.png'), path('poza (1).png'), path('c d.gif')]
  const admin = fakeAdmin()
  await referencedProjectChatImagePaths(admin, PROJECT, paths)

  assert.equal(admin.calls.or.length, 1, 'un singur round-trip pentru tot lotul')
  const termeni = admin.calls.or[0].split(',images.cs.')
    .map((part, index) => (index === 0 ? part : `images.cs.${part}`))
  assert.equal(termeni.length, paths.length)
  assert.deepEqual(termeni.map(term => JSON.parse(unquote(term))[0].path), paths)
})

test('o cale încă folosită de un mesaj viu nu se șterge', async () => {
  const folosita = path('folosita.png')
  const orfana = path('orfana (1).png')
  const removed = []
  const admin = fakeAdmin(
    [{ images: [{ path: folosita, name: 'folosita.png', mimeType: 'image/png', size: 10 }] }],
    removed,
  )

  const rezultat = await removeUnreferencedProjectChatImages(admin, PROJECT, [folosita, orfana])
  assert.deepEqual(rezultat.skipped, [folosita])
  assert.deepEqual(rezultat.removed, [orfana])
  assert.deepEqual(removed, [orfana], 'din bucket iese exact orfana')
})

test('fără căi, nu se atinge baza', async () => {
  const admin = fakeAdmin()
  assert.deepEqual([...await referencedProjectChatImagePaths(admin, PROJECT, [])], [])
  assert.equal(admin.calls.or.length, 0)
})
