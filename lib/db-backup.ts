// Copia zilnică a bazei (`/api/cron/copie-baza`): numele fișierelor și ce
// copii vechi se șterg. Modul pur, ca regula de păstrare să fie testată.
//
// Căi relative, cu extensie: fișierul are teste rulate direct cu `node --test`.

export const BACKUP_BUCKET = 'backups'
export const BACKUP_PREFIX = 'db'
/** Cât păstrăm. Planul Free are 1 GB de fișiere în total, documentele incluse. */
export const BACKUP_RETENTION_DAYS = 14
export const BACKUP_FORMAT = 'kabinet-db-export'
export const BACKUP_FORMAT_VERSION = 1

const NAME_PATTERN = /^kabinet-db-(\d{4}-\d{2}-\d{2})\.ndjson\.gz$/
const DAY_MS = 24 * 60 * 60 * 1000

/** Ziua copiei, după ora României: copia de la 03:00 e „a zilei de azi”. */
export function backupDay(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Europe/Bucharest' })
}

/** Un fișier pe zi: rularea repetată în aceeași zi îl înlocuiește. */
export function backupObjectName(date: Date): string {
  return `kabinet-db-${backupDay(date)}.ndjson.gz`
}

/** Copiile mai vechi decât termenul. Ce nu seamănă cu o copie nu se atinge. */
export function backupObjectsToDelete(names: readonly string[], now: Date, retentionDays = BACKUP_RETENTION_DAYS): string[] {
  const cutoff = Date.parse(`${backupDay(now)}T00:00:00.000Z`) - retentionDays * DAY_MS
  return names.filter(name => {
    const match = NAME_PATTERN.exec(name)
    if (!match) return false
    const day = Date.parse(`${match[1]}T00:00:00.000Z`)
    return Number.isFinite(day) && day < cutoff
  })
}
