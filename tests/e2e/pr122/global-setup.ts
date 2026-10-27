import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { BUCKET, cleanupLeftovers, config, ensureReportDir, sql } from './support'

/** Refuză rularea dacă mediul nu e cel cerut: server local pe build, simulatorul Resend pornit. */
export default async function globalSetup() {
  const login = await fetch(new URL('/login', config.baseUrl), { signal: AbortSignal.timeout(60_000) })
  if (!login.ok) throw new Error('Serverul Next nu răspunde pe ' + config.baseUrl)

  const resendPort = Number(process.env.E2E_RESEND_PORT || 4122)
  await new Promise<void>((resolve, reject) => {
    const socket = net.connect(resendPort, '127.0.0.1', () => { socket.end(); resolve() })
    socket.once('error', () => reject(new Error(`Simulatorul Resend nu ascultă pe 127.0.0.1:${resendPort}; pornește tests/e2e/helpers/resend-mock.mjs`)))
  })

  await cleanupLeftovers()

  // Ce exista în Storage la pornire: verificarea finală compară cu asta.
  const startedAt = sql('select now()')
  const objects = Number(sql(`select count(*) from storage.objects where bucket_id='${BUCKET}'`))
  fs.writeFileSync(path.join(ensureReportDir(), 'pornire.json'), JSON.stringify({ startedAt, objects }))
}
