import fs from 'node:fs'
import path from 'node:path'
import { BUCKET, REPORT_DIR, cleanupLeftovers, leftovers, q, service, sql } from './support'

/**
 * Curățarea se verifică explicit: niciun cont de test activ, niciun proiect sau
 * șablon de test, iar Storage are exact obiectele de la pornire.
 */
export default async function globalTeardown() {
  await cleanupLeftovers()
  const start = JSON.parse(fs.readFileSync(path.join(REPORT_DIR, 'pornire.json'), 'utf8')) as { startedAt: string; objects: number }

  // Fișiere-model urcate de editor dintr-o salvare care n-a ajuns în bază: nimeni nu le mai referă.
  const orphans = JSON.parse(sql(`select coalesce(json_agg(name), '[]') from storage.objects o
    where bucket_id='${BUCKET}' and created_at >= ${q(start.startedAt)}::timestamptz and name like 'templates/attachments/%'
      and not exists (select 1 from document_requirement_attachments a where a.storage_path=o.name)
      and not exists (select 1 from template_document_requirements d where d.attachment_path=o.name)`)) as string[]
  if (orphans.length) await service.storage.from(BUCKET).remove(orphans)

  const result = { at: new Date().toISOString(), orphansRemoved: orphans.length, storageAtStart: start.objects, ...leftovers() }
  fs.writeFileSync(path.join(REPORT_DIR, 'curatare.json'), JSON.stringify(result, null, 2))
  console.log('Curățare #122: ' + JSON.stringify(result))
  if (result.activeTestAccounts !== 0 || result.projects !== 0 || result.templates !== 0 || result.storageObjects !== start.objects) {
    throw new Error('Curățare incompletă: ' + JSON.stringify(result))
  }
}
