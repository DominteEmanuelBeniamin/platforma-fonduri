import assert from 'node:assert/strict'
import test from 'node:test'

import { CIF_COUNTRIES, normalizeCif, parseCif, validateCif } from './cif.ts'

// Exemple de format, fără afirmații despre înregistrarea TVA; numai RO are checksum.
const formats = [
  ['RO', '5258486', 'RO5258486', '12345678'],
  ['AT', 'U12345678', 'ATU12345678', '123456789'],
  ['BE', '0123456789', 'BE0123456789', '123456789'],
  ['BG', '123456789', 'BG123456789', '12345678'],
  ['CZ', '12345678', 'CZ12345678', '1234567'],
  ['CY', '12345678A', 'CY12345678A', '123456789'],
  ['HR', '12345678901', 'HR12345678901', '1234567890'],
  ['DK', '12345678', 'DK12345678', '1234567'],
  ['EE', '123456789', 'EE123456789', '12345678'],
  ['FI', '12345678', 'FI12345678', '1234567'],
  ['FR', '12345678901', 'FR12345678901', '1234567890'],
  ['DE', '123456789', 'DE123456789', '12345678'],
  ['GR', '123456789', 'EL123456789', '12345678'],
  ['IE', '1234567A', 'IE1234567A', '12345678'],
  ['IT', '12345678901', 'IT12345678901', '1234567890'],
  ['LV', '12345678901', 'LV12345678901', '1234567890'],
  ['LT', '123456789', 'LT123456789', '1234567890'],
  ['LU', '12345678', 'LU12345678', '1234567'],
  ['MT', '12345678', 'MT12345678', '1234567'],
  ['PL', '1234567890', 'PL1234567890', '123456789'],
  ['PT', '123456789', 'PT123456789', '12345678'],
  ['SK', '1234567890', 'SK1234567890', '123456789'],
  ['SI', '12345678', 'SI12345678', '1234567'],
  ['ES', 'A12345678', 'ESA12345678', '123456789'],
  ['SE', '123456789001', 'SE123456789001', '123456789002'],
  ['NL', '123456789B01', 'NL123456789B01', '123456789C01'],
  ['HU', '12345678', 'HU12345678', '1234567'],
]

function expectError(result, code, field = 'cif') {
  assert.equal(result.ok, false, JSON.stringify(result))
  assert.equal(result.code, code)
  assert.equal(result.field, field)
  assert.ok(result.message.length > 0)
  assert.equal('cif' in result, false, 'o eroare nu oferă o valoare de salvat')
}

test('catalogul are exact cele 27 de țări UE, România prima și restul în ordine românească', () => {
  const codes = ['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK']
  assert.deepEqual(CIF_COUNTRIES.map(country => country.code).sort(), codes)
  assert.equal(new Set(CIF_COUNTRIES.map(country => country.prefix)).size, 27)
  assert.equal(CIF_COUNTRIES[0].code, 'RO')
  const labels = CIF_COUNTRIES.slice(1).map(country => country.label)
  assert.deepEqual(labels, [...labels].sort((left, right) => left.localeCompare(right, 'ro')))
  assert.deepEqual(formats.map(([country]) => country), CIF_COUNTRIES.map(country => country.code))
  for (const country of CIF_COUNTRIES) {
    assert.ok(country.format && country.label)
    assert.equal(validateCif(country.example, country.code).ok, true, country.example)
  }
})

for (const [country, number, cif, invalid] of formats) {
  test(`${country}: număr, prefix, normalizare repetată, parse și format greșit`, () => {
    const expected = { ok: true, country, number, cif }
    assert.deepEqual(validateCif(number, country), expected)
    assert.deepEqual(validateCif(cif, country), expected)
    assert.deepEqual(validateCif(cif), expected)
    assert.deepEqual(parseCif(cif), expected)
    const pasted = ' \t' + cif.toLowerCase().split('').join('. ') + '\n'
    const normalized = normalizeCif(pasted, country)
    assert.deepEqual(normalized, expected)
    assert.deepEqual(normalizeCif(normalized.cif, country), expected)
    assert.deepEqual(normalizeCif(normalized.cif), expected)
    assert.deepEqual(validateCif(parseCif(cif).number, country), expected)
    expectError(validateCif(invalid, country), 'CIF_INVALID')
  })
}

test('RO acceptă exemplele verificate, numere simple și zerouri inițiale', () => {
  for (const number of ['5258486', '4221306']) {
    const expected = { ok: true, country: 'RO', number, cif: 'RO' + number }
    for (const input of [number, 'ro ' + number, 'RO00000000000' + number, '00' + number]) {
      assert.deepEqual(validateCif(input), expected)
      assert.deepEqual(validateCif(input, 'RO'), expected)
      assert.deepEqual(normalizeCif(input), expected)
    }
  }
})

test('normalizarea nu înlocuiește validarea checksum-ului RO', () => {
  assert.deepEqual(normalizeCif('ro 12.345.678'), { ok: true, country: 'RO', number: '12345678', cif: 'RO12345678' })
  const result = validateCif('RO12345678')
  expectError(result, 'CIF_INVALID')
  assert.equal(result.message, 'CUI-ul nu e valid. Verifică cifrele.')
  expectError(parseCif('RO12345678'), 'CIF_INVALID')
})

test('RO verifică fiecare poziție, inclusiv cifra de control', () => {
  for (const number of ['5258486', '4221306']) {
    for (let index = 0; index < number.length; index++) {
      const changed = number.slice(0, index) + ((Number(number[index]) + 1) % 10) + number.slice(index + 1)
      expectError(validateCif(changed, 'RO'), 'CIF_INVALID')
    }
  }
})

test('RO respinge zero, lungimi în afara limitelor, litere și semne', () => {
  for (const input of ['0', '00', 'RO00000000000', '1', '9', '12345678901', '525848A', '-5258486', '+5258486', '5/258486', '5258486e0']) {
    expectError(validateCif(input, 'RO'), 'CIF_INVALID')
  }
})

test('RO are limite de 2 și 10 cifre, iar restul 10 devine cifra de control 0', () => {
  for (const number of ['19', '94', '1000000004', '9999999994']) {
    assert.equal(validateCif(number, 'RO').ok, true, number)
  }
  assert.equal(validateCif('RO60').ok, true, '6 × 2 × 10 modulo 11 dă restul 10')
})

test('țările străine păstrează toate zerourile semnificative', () => {
  for (const [country, number, cif] of [
    ['BE', '0123456789', 'BE0123456789'],
    ['DE', '000000001', 'DE000000001'],
    ['FR', '0A000000001', 'FR0A000000001'],
    ['IE', '0123456AB', 'IE0123456AB'],
    ['NL', '000000001B00', 'NL000000001B00'],
  ]) {
    const expected = { ok: true, country, number, cif }
    assert.deepEqual(validateCif(number, country), expected)
    assert.deepEqual(parseCif(cif), expected)
  }
})

test('BG, CZ și LT acceptă numai variantele de lungime documentate', () => {
  for (const [country, lengths] of [['BG', [9, 10]], ['CZ', [8, 9, 10]], ['LT', [9, 12]]]) {
    for (let length = 7; length <= 13; length++) {
      assert.equal(validateCif('1'.repeat(length), country).ok, lengths.includes(length), `${country}: ${length}`)
    }
  }
})

test('AT, NL și SE impun caracterele în pozițiile lor exacte', () => {
  for (const [country, values] of [
    ['AT', ['12345678U', 'V12345678', 'U1234567', 'U123456789']],
    ['NL', ['B12345678901', '12345678B901', '123456789A01', '123456789B1', '123456789B001']],
    ['SE', ['123456789000', '123456789010', '123456789011', '12345678901', '1234567890001']],
  ]) {
    for (const value of values) expectError(validateCif(value, country), 'CIF_INVALID')
  }
})

test('IE păstrează variantele clasice, moderne și istorice, inclusiv + și *', () => {
  for (const number of ['1234567A', '1234567AB', '1Z23456A', '1+23456A', '1*23456A']) {
    const expected = { ok: true, country: 'IE', number, cif: 'IE' + number }
    assert.deepEqual(validateCif(number, 'IE'), expected)
    assert.deepEqual(parseCif(expected.cif), expected)
    assert.deepEqual(normalizeCif(expected.cif.toLowerCase(), 'IE'), expected)
  }
  for (const number of ['12345678', '123456A', '1234567ABC', '1Z23456AB', '1+234567A', '1#23456A', '1/23456A', '1&23456A', '1234567+', '123456*A']) {
    expectError(validateCif(number, 'IE'), 'CIF_INVALID')
  }
})

test('ES permite o literă la început, la sfârșit sau în ambele poziții', () => {
  for (const number of ['A12345678', '12345678A', 'X1234567W']) assert.equal(validateCif(number, 'ES').ok, true, number)
  for (const number of ['123456789', 'A1234567', 'A123456789', 'A123A567B', '1234567AB']) expectError(validateCif(number, 'ES'), 'CIF_INVALID')
})

test('FR acceptă chei numerice și alfabetice în primele două poziții, fără I și O', () => {
  for (const key of ['12', '1A', 'A1', 'AB']) assert.equal(validateCif(key + '123456789', 'FR').ok, true, key)
  for (const number of ['I1123456789', '1I123456789', 'O1123456789', '1O123456789', '1212345678A', 'A123456789']) {
    expectError(validateCif(number, 'FR'), 'CIF_INVALID')
  }
})

test('FR păstrează cheile care seamănă cu prefixe, inclusiv DE și FR', () => {
  for (const number of ['DE123456789', 'FR123456789', 'GB123456789']) {
    const expected = { ok: true, country: 'FR', number, cif: 'FR' + number }
    assert.deepEqual(validateCif(number, 'FR'), expected)
    assert.deepEqual(validateCif(expected.cif, 'FR'), expected)
    assert.deepEqual(normalizeCif(expected.cif, 'FR'), expected)
    assert.deepEqual(normalizeCif(expected.cif), expected)
    assert.deepEqual(parseCif(expected.cif), expected)
  }
  assert.deepEqual(validateCif('DE123456789'), { ok: true, country: 'DE', number: '123456789', cif: 'DE123456789' })
})

test('Grecia acceptă EL/GR și produce țara ISO GR cu prefixul fiscal EL', () => {
  const expected = { ok: true, country: 'GR', number: '123456789', cif: 'EL123456789' }
  for (const country of [undefined, 'GR', 'EL', ' gr ', ' el ']) {
    for (const cif of ['EL123456789', 'GR123456789', 'gr 123.456.789']) assert.deepEqual(validateCif(cif, country), expected)
  }
  assert.deepEqual(parseCif('GR123456789'), expected)
  assert.deepEqual(validateCif('123456789', 'GR'), expected)
})

test('un prefix străin nu schimbă țara selectată', () => {
  for (const [value, country] of [['DE123456789', 'RO'], ['RO5258486', 'DE'], ['EL123456789', 'DE'], ['DE12345678', 'FR']]) {
    expectError(validateCif(value, country), 'CIF_COUNTRY_MISMATCH')
  }
})

test('nu elimină recursiv prefixe repetate sau contradictorii', () => {
  for (const value of ['RORO5258486', 'RODE123456789', 'DERO5258486', 'DEDE123456789', 'ELGR123456789', 'FRFRFR123456789']) {
    expectError(validateCif(value), 'CIF_INVALID')
  }
})

test('intrările lipsă și goale au eroare CIF_REQUIRED', () => {
  for (const value of [undefined, null, '', ' ', '\t.\n', 'RO', 'ro .', 'DE']) {
    expectError(validateCif(value), 'CIF_REQUIRED')
  }
})

test('API: nu convertește numere, booleeni, obiecte sau liste în CIF', () => {
  for (const value of [5258486, 0, NaN, Infinity, true, false, [], ['5258486'], {}, { cif: '5258486' }, 5258486n, Symbol('cif'), new String('5258486')]) {
    expectError(validateCif(value), 'CIF_INVALID')
    expectError(normalizeCif(value), 'CIF_INVALID')
    expectError(parseCif(value), 'CIF_INVALID')
  }
})

test('API: țările necunoscute sau cu tip greșit au eroare pe cifCountry', () => {
  for (const country of [null, '', ' ', 1, true, false, [], ['RO'], {}, 'UK', 'GB', 'XI', 'US', 'MD', 'Romania', 'R O', '__proto__']) {
    expectError(validateCif('5258486', country), 'CIF_COUNTRY_UNSUPPORTED', 'cifCountry')
  }
  for (const value of ['GB123456789', 'XI123456789', 'US123456789', 'MD123456789', 'XX123456789']) {
    expectError(validateCif(value), 'CIF_COUNTRY_UNSUPPORTED', 'cifCountry')
  }
  assert.equal(validateCif('5258486', ' ro ').ok, true)
})

test('nu șterge semne sau caractere Unicode pentru a fabrica un CIF valid', () => {
  for (const value of ['RO525-8486', 'RO525/8486', 'RO525_8486', 'RO5258486!', 'RO５２５８４８６', 'RO525\u200b8486', 'RO5258486\0', 'ＲＯ5258486', 'RO5258486💰']) {
    assert.equal(validateCif(value).ok, false, value)
  }
  expectError(validateCif('ı12345678', 'ES'), 'CIF_INVALID')
})

test('parseCif refuză valorile legacy fără prefix, fără fallback la România', () => {
  for (const value of ['5258486', '0005258486', '123456789', '1234567A', 'U12345678']) expectError(parseCif(value), 'CIF_INVALID')
  expectError(parseCif('ZZ5258486'), 'CIF_COUNTRY_UNSUPPORTED', 'cifCountry')
  assert.equal(validateCif('5258486').ok, true, 'compatibilitatea intrării API este separată de parsarea valorii salvate')
})

test('erorile străine descriu formatul țării și nu repetă intrarea utilizatorului', () => {
  const result = validateCif('private-value', 'NL')
  expectError(result, 'CIF_INVALID')
  assert.match(result.message, /9 cifre, B și încă 2 cifre/)
  assert.equal(result.message.includes('private-value'), false)
})
