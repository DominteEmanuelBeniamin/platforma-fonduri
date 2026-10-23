#!/usr/bin/env node
// Desface o copie zilnică a bazei (`backups/db/kabinet-db-AAAA-LL-ZZ.ndjson.gz`)
// într-un dosar cu câte un fișier JSON pe tabel, pentru o recuperare manuală:
// de exemplu rândurile unui proiect șters din greșeală.
//
//   node scripts/copie-baza-citeste.mjs <copie.ndjson.gz> [dosar-iesire]
//
// Copia se descarcă din Supabase → Storage → backups → db, sau cu
//   npx supabase storage cp ss:///backups/db/<nume> . --experimental --linked
//
// Scriptul nu scrie nimic în bază. Fișierele rezultate conțin date personale:
// țin-le pe un disc criptat și șterge-le după recuperare.

import { createReadStream } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { createInterface } from 'node:readline'
import { createGunzip } from 'node:zlib'

const [input, outputArg] = process.argv.slice(2)
if (!input) {
  console.error('Folosire: node scripts/copie-baza-citeste.mjs <copie.ndjson.gz> [dosar-iesire]')
  process.exit(1)
}
const output = outputArg ?? basename(input).replace(/\.ndjson\.gz$/, '')

const lines = createInterface({ input: createReadStream(input).pipe(createGunzip()), crlfDelay: Infinity })
const tables = new Map()
let header = null

for await (const line of lines) {
  if (!line.trim()) continue
  const entry = JSON.parse(line)
  if (!header) {
    header = entry
    if (entry.format !== 'kabinet-db-export') {
      console.error('Fișierul nu e o copie a bazei Kabinet.')
      process.exit(1)
    }
    continue
  }
  if (!tables.has(entry.t)) tables.set(entry.t, [])
  tables.get(entry.t).push(entry.r)
}

if (!header) {
  console.error('Copia e goală.')
  process.exit(1)
}

await mkdir(output, { recursive: true })
for (const [table, rows] of tables) {
  await writeFile(join(output, `${table}.json`), JSON.stringify(rows, null, 2))
}

console.log(`Copia din ${header.created_at} (format ${header.format} v${header.version})`)
for (const table of header.tables) {
  console.log(`  ${table}: ${tables.get(table)?.length ?? 0} rânduri`)
}
console.log(`Scris în ${output}/`)
