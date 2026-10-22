/* eslint-disable @typescript-eslint/no-explicit-any */
import { gzipSync } from 'node:zlib'
import { NextResponse } from 'next/server'
import { logAction } from '@/app/api/_utils/audit'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'
import {
  BACKUP_BUCKET,
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  BACKUP_PREFIX,
  BACKUP_RETENTION_DAYS,
  backupObjectName,
  backupObjectsToDelete,
} from '@/lib/db-backup'

export const maxDuration = 300

const PAGE_SIZE = 1000
const USERS_PAGE_SIZE = 1000

/**
 * Copia zilnică a bazei, cât proiectul e pe Supabase Free (fără backupuri).
 * Scrie toate tabelele din `public` și conturile din Auth, rând cu rând
 * (NDJSON), comprimat, în bucketul privat `backups`. Păstrează ultimele
 * zile și scrie o intrare în jurnal, ca adminul să vadă că a rulat.
 *
 * Nu e un backup adevărat: stă în același proiect Supabase. Acoperă o
 * ștergere sau o migrare greșită, nu pierderea proiectului. Parolele nu
 * intră în copie: după o restaurare din ea, utilizatorii își resetează parola.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== 'Bearer ' + secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createSupabaseServiceClient()
  const startedAt = new Date()
  const path = `${BACKUP_PREFIX}/${backupObjectName(startedAt)}`

  try {
    const { data: catalog, error: catalogError } = await admin.rpc('backup_table_catalog')
    if (catalogError) throw catalogError
    const tables = (catalog ?? []) as Array<{ table_name: string; key_columns: string[] | null }>

    const lines: string[] = [JSON.stringify({
      format: BACKUP_FORMAT,
      version: BACKUP_FORMAT_VERSION,
      created_at: startedAt.toISOString(),
      tables: [...tables.map(table => table.table_name), 'auth.users'],
    })]
    const counts: Record<string, number> = {}

    for (const table of tables) {
      let count = 0
      for (let from = 0; ; from += PAGE_SIZE) {
        let query = admin.from(table.table_name).select('*')
        // Ordinea după cheia primară ține paginile stabile; un tabel fără
        // cheie se citește în ordinea în care îl dă baza.
        for (const column of table.key_columns ?? []) query = query.order(column, { ascending: true })
        const { data, error } = await query.range(from, from + PAGE_SIZE - 1)
        if (error) throw new Error(`${table.table_name}: ${error.message}`)
        for (const row of data ?? []) lines.push(JSON.stringify({ t: table.table_name, r: row }))
        count += data?.length ?? 0
        if (!data || data.length < PAGE_SIZE) break
      }
      counts[table.table_name] = count
    }

    // Conturile din Auth, fără parole: fără ele, profilurile nu mai au cui aparține.
    let userCount = 0
    for (let page = 1; ; page += 1) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: USERS_PAGE_SIZE })
      if (error) throw error
      const users = data?.users ?? []
      for (const user of users) {
        lines.push(JSON.stringify({
          t: 'auth.users',
          r: {
            id: user.id,
            email: user.email ?? null,
            phone: user.phone ?? null,
            created_at: user.created_at,
            last_sign_in_at: user.last_sign_in_at ?? null,
            email_confirmed_at: user.email_confirmed_at ?? null,
            banned_until: (user as any).banned_until ?? null,
            app_metadata: user.app_metadata ?? null,
            user_metadata: user.user_metadata ?? null,
          },
        }))
      }
      userCount += users.length
      if (users.length < USERS_PAGE_SIZE) break
    }
    counts['auth.users'] = userCount

    const body = gzipSync(Buffer.from(lines.join('\n') + '\n', 'utf8'))
    const { error: uploadError } = await admin.storage
      .from(BACKUP_BUCKET)
      .upload(path, body, { contentType: 'application/gzip', upsert: true })
    if (uploadError) throw uploadError

    const { data: listed, error: listError } = await admin.storage
      .from(BACKUP_BUCKET)
      .list(BACKUP_PREFIX, { limit: 1000 })
    if (listError) throw listError
    const stale = backupObjectsToDelete((listed ?? []).map(object => object.name), startedAt)
      .map(name => `${BACKUP_PREFIX}/${name}`)
    if (stale.length > 0) {
      const { error: removeError } = await admin.storage.from(BACKUP_BUCKET).remove(stale)
      if (removeError) throw removeError
    }

    const rows = Object.values(counts).reduce((sum, value) => sum + value, 0)
    const kilobytes = Math.ceil(body.length / 1024)
    await logAction({
      actorId: null,
      actionType: 'backup',
      entityType: 'database_backup',
      entityName: path,
      newValues: { path, bytes: body.length, rows, tables: counts, removed: stale.length, retention_days: BACKUP_RETENTION_DAYS },
      description: `Copia zilnică a bazei: ${rows} rânduri din ${Object.keys(counts).length} tabele, ${kilobytes} KB${stale.length ? `; ${stale.length} copii mai vechi de ${BACKUP_RETENTION_DAYS} zile șterse` : ''}`,
      ipAddress: 'cron',
      userAgent: 'vercel-cron',
    })

    return NextResponse.json({ ok: true, path, bytes: body.length, rows, removed: stale.length })
  } catch (error: any) {
    const message = error?.message ?? 'Eroare necunoscută'
    console.error('[copie-baza] failed', { message })
    await logAction({
      actorId: null,
      actionType: 'backup',
      entityType: 'database_backup',
      entityName: path,
      newValues: { path, failed: true },
      description: `Copia zilnică a bazei a eșuat: ${message}`,
      ipAddress: 'cron',
      userAgent: 'vercel-cron',
    })
    return NextResponse.json({ ok: false, error: 'Copia zilnică a bazei a eșuat' }, { status: 500 })
  }
}
