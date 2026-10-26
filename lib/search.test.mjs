import assert from 'node:assert/strict'
import test from 'node:test'

import {
  editDistance,
  filterItems,
  findRanges,
  foldText,
  hiddenMatches,
  matchFields,
  searchItems,
  snippetAround,
} from './search.ts'

const marked = (text, ranges) => ranges.map(([s, e]) => text.slice(s, e))
const text = (key, value, extra = {}) => ({ key, label: key, value, ...extra })

test('diacriticele și literele mari nu contează', () => {
  assert.equal(foldText('Timișoara ŞTEFAN Țară'), 'timisoara stefan tara')
  assert.ok(matchFields('timisoara', [text('a', 'Timișoara')]))
  assert.ok(matchFields('SECȚIUNE', [text('a', 'secțiune')]))
  assert.ok(matchFields('sectiune', [text('a', 'Secţiune')]), 'ţ cu sedilă, nu doar cu virgulă')
  assert.deepEqual(marked('Timișoara', findRanges('Timișoara', 'timis')), ['Timiș'])
})

test('cuvintele pot fi în orice ordine, fiecare trebuie găsit undeva', () => {
  assert.ok(matchFields('ion popescu', [text('n', 'Popescu Ion')]))
  assert.ok(matchFields('popescu brasov', [text('n', 'Popescu Ion'), text('a', 'Str. Lungă, Brașov')]))
  assert.equal(matchFields('popescu cluj', [text('n', 'Popescu Ion'), text('a', 'Brașov')]), null)
})

test('găsește după începutul cuvântului și, de la 3 litere, în interior', () => {
  assert.equal(matchFields('pop', [text('n', 'Ion Popescu')]).tier, 1)
  assert.equal(matchFields('escu', [text('n', 'Ion Popescu')]).tier, 2)
  assert.equal(matchFields('es', [text('n', 'Ion Popescu')]), null)
  assert.equal(matchFields('ion', [text('n', 'Ion Popescu')]).tier, 0)
})

test('o greșeală de tastare se tolerează doar de la 5 litere', () => {
  assert.equal(matchFields('popsecu', [text('n', 'Popescu')]).tier, 3, 'transpoziție')
  assert.equal(matchFields('popexcu', [text('n', 'Popescu')]).tier, 3, 'substituție')
  assert.equal(matchFields('popscu', [text('n', 'Popescu')]).tier, 3, 'literă lipsă')
  assert.equal(matchFields('popsec', [text('n', 'Popescu')]).tier, 3, 'început tastat cu greșeală')
  assert.equal(matchFields('popsxcu', [text('n', 'Popescu')]), null, 'două greșeli')
  assert.equal(matchFields('mira', [text('n', 'Maria')]), null, 'cuvânt scurt: fără toleranță')
  assert.equal(matchFields('ian', [text('n', 'Ion')]), null)
  assert.equal(matchFields('anaf', [text('n', 'Anca')]), null)
  assert.equal(editDistance('abcdef', 'abcdfe'), 1)
  assert.equal(editDistance('abcdef', 'xyz'), 2)
})

test('ordinea: exact, început de cuvânt, interior, greșeală; în grup rămâne ordinea paginii', () => {
  const rows = ['Popescuuu Z', 'Popscu A', 'Ion Popescu', 'Popescu B', 'Popescu C']
  const hits = searchItems(rows, 'popescu', row => [text('n', row)])
  assert.deepEqual(hits.map(h => h.item), ['Ion Popescu', 'Popescu B', 'Popescu C', 'Popescuuu Z', 'Popscu A'])
  assert.deepEqual(hits.map(h => h.tier), [0, 0, 0, 1, 3])
})

test('interogarea goală lasă totul, în ordinea primită', () => {
  assert.deepEqual(filterItems(['b', 'a'], '   ', row => [text('n', row)]), ['b', 'a'])
  assert.deepEqual(filterItems(['b', 'a'], ' .- ', row => [text('n', row)]), ['b', 'a'])
})

test('CIF: spațiile, punctele și prefixul nu contează', () => {
  const cif = [text('cif', 'RO12345678', { kind: 'cif' })]
  for (const q of ['12345678', 'RO 123.456.78', 'ro12345678', 'RO12345678', '123 456 78']) {
    assert.ok(matchFields(q, cif), q)
  }
  assert.deepEqual(marked('RO12345678', matchFields('RO 123.456.78', cif).matches[0].ranges), ['RO12345678'])
  const spaced = [text('cif', 'RO 123.456.78', { kind: 'cif' })]
  assert.deepEqual(marked('RO 123.456.78', matchFields('12345678', spaced).matches[0].ranges), ['123.456.78'])
  assert.equal(matchFields('12345678', cif).tier, 0)
  assert.equal(matchFields('1234', cif).tier, 1)
  assert.deepEqual(marked('RO12345678', matchFields('1234', cif).matches[0].ranges), ['1234'])
  assert.equal(matchFields('87654321', cif), null)
  assert.equal(matchFields('ro 999', cif), null)
})

test('telefon: spațiile și prefixul de țară nu contează', () => {
  const phone = [text('tel', '0722 123 456', { kind: 'phone' })]
  for (const q of ['0722123456', '0722 123 456', '0722-123-456', '722123', '123 456']) {
    assert.ok(matchFields(q, phone), q)
  }
  const intl = [text('tel', '+40 722 123 456', { kind: 'phone' })]
  assert.ok(matchFields('0722123456', intl))
  assert.deepEqual(marked('0722 123 456', matchFields('0722123456', phone).matches[0].ranges), ['0722 123 456'])
})

test('evidențierea marchează toate cuvintele căutate, pe textul original', () => {
  const value = 'Proiect Ștefănescu — secțiunea Ștefănescu'
  assert.deepEqual(marked(value, findRanges(value, 'stef sectiune')), ['Ștef', 'secțiune', 'Ștef'])
  assert.deepEqual(marked('Popescu Ion', findRanges('Popescu Ion', 'ion popsecu')), ['Popescu', 'Ion'])
  assert.deepEqual(findRanges('', 'x'), [])
  assert.deepEqual(findRanges('abc', ''), [])
})

test('potrivirile din câmpuri nevăzute se întorc pentru „Găsit în"', () => {
  const m = matchFields('12345678 brasov', [
    text('title', 'Modernizare hală'),
    text('cif', 'RO12345678', { kind: 'cif', shown: false }),
    text('adresa', 'Brașov, str. Lungă 1', { shown: false }),
  ])
  assert.deepEqual(hiddenMatches(m.matches).map(x => x.key), ['cif', 'adresa'])
  assert.deepEqual(marked('Brașov, str. Lungă 1', m.matches[1].ranges), ['Brașov'])
})

test('câmpurile goale sau lipsă nu strică nimic', () => {
  assert.equal(matchFields('x', [text('a', null), text('b', undefined), text('c', '   ')]), null)
})

test('fragmentul din jurul potrivirii mută pozițiile', () => {
  const long = `${'a '.repeat(60)}Ștefan ${'b '.repeat(60)}`
  const { text: snip, ranges } = snippetAround(long, findRanges(long, 'stefan'))
  assert.deepEqual(marked(snip, ranges), ['Ștefan'])
  assert.ok(snip.startsWith('…') && snip.endsWith('…'))
})

test('telefonul local și cel internațional se caută în ambele direcții, cu pozițiile originale', () => {
  const values = ['0722123456', '0722 123 456', '+40 722 123 456', '0040 722 123 456']
  const queries = [
    '0722123456', '0722 123 456', '0722-123-456', '+40722123456',
    '+40 722 123 456', '0040722123456', '0040 (722) 123-456',
  ]
  for (const value of values) {
    for (const query of queries) {
      const hit = matchFields(query, [text('tel', value, { kind: 'phone' })])
      assert.ok(hit, value + ' ← ' + query)
      assert.equal(hit.tier, 0, value + ' ← ' + query)
      const expected = [value.replace(/^\+/, '')]
      assert.deepEqual(marked(value, hit.matches[0].ranges), expected)
      assert.deepEqual(marked(value, findRanges(value, query, 'phone')), expected)
    }
  }
})

test('telefonul cu prefix internațional, inclusiv parțial, poate fi combinat cu numele', () => {
  for (const value of ['0722123456', '0722 123 456', '+40 722 123 456', '0040 722 123 456']) {
    const fields = [text('name', 'Ion Popescu'), text('tel', value, { kind: 'phone' })]
    for (const query of [
      'ion +40 722 123 456', '0040 (722) 123-456 popescu', '0722 123 456 ion',
      '+40722123456 ion', 'popescu 0040722123456', 'ion +40 722', '0040 722 ion',
    ]) {
      assert.ok(matchFields(query, fields), value + ' ← ' + query)
    }
    assert.equal(matchFields('maria +40 722 123 456', fields), null)
    const hit = matchFields('ion +40 722 123 456', fields)
    assert.deepEqual(hit.matches.map(match => match.key), ['name', 'tel'])
    assert.deepEqual(marked(value, hit.matches[1].ranges), [value.replace(/^\+/, '')])
    assert.deepEqual(marked(value, findRanges(value, 'ion +40 722 123 456', 'phone')), [value.replace(/^\+/, '')])
  }
})
