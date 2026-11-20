// Aduce proiectele din `npm run seed:local` într-o stare credibilă pentru ghid:
// clientul încarcă fișiere, consultantul le aprobă sau le respinge, echipa
// scrie în chat. Totul trece prin API-ul aplicației, ca în interfață.
//
// Folosire (după `npm run db:reset:local` + `npm run seed:local`, cu aplicația pornită):
//   node scripts/ghid/date-ghid.mjs
import { execFileSync } from 'node:child_process'
import { APP, CONTURI, service, sesiune } from './comun.mjs'
import { eDemo, sqlDemo } from '../demo/tinta.mjs'

const sql = eDemo(process.env) ? q => sqlDemo(process.env, q, '\t') : q => execFileSync('docker', ['exec', '-i', 'supabase_db_platforma-fonduri', 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt', '-F', '\t', '-c', q], { encoding: 'utf8' }).trim()
const rows = q => sql(q).split('\n').filter(Boolean).map(l => l.split('\t'))
const esc = s => `'${String(s).replace(/'/g, "''")}'`

const tokenuri = {}
async function api(email, method, path, body) {
  tokenuri[email] ??= (await sesiune(email)).access_token
  const res = await fetch(`${APP}${path}`, {
    method, headers: { Authorization: `Bearer ${tokenuri[email]}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json)}`)
  return json
}

function pdf(titlu, firma) {
  const curat = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[()\\]/g, '')
  const stream = `BT /F1 18 Tf 60 780 Td (${curat(titlu)}) Tj 0 -28 Td /F1 12 Tf (${curat(firma)} - document demonstrativ) Tj ET`
  return Buffer.from(`%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length ${stream.length}>>stream
${stream}
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF`)
}
const numeFisier = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\(.*?\)/g, '').trim().replace(/[^\w]+/g, '_').replace(/_+$/, '') + '.pdf'

/** Clientul încarcă un PDF în cerere, exact prin fluxul init → storage → complete. */
export async function incarca(email, requestId, nume, firma) {
  const bytes = pdf(nume, firma)
  const fisier = numeFisier(nume)
  const init = await api(email, 'POST', `/api/document-requests/${requestId}/uploads/init`, { files: [{ name: fisier, size: bytes.length, type: 'application/pdf' }] })
  for (const u of init.uploads) {
    const { error } = await service.storage.from('project-files').uploadToSignedUrl(u.storagePath, u.token, bytes, { contentType: 'application/pdf' })
    if (error) throw error
  }
  await api(email, 'POST', `/api/document-requests/${requestId}/uploads/complete`, { batchId: init.batchId, fileIds: init.uploads.map(u => u.fileId) })
}
const revizuieste = (email, requestId, action, notes) => api(email, 'POST', `/api/document-requests/${requestId}/review`, { action, notes })

const proiect = titlu => sql(`select id from projects where title=${esc(titlu)}`)
function cereri(projectId) {
  return rows(`select r.id, r.name, f.order_index, a.order_index, a.status, f.status, r.status
    from document_requirements r join project_activities a on a.id=r.activity_id join project_phases f on f.id=a.phase_id
    where r.project_id=${esc(projectId)} and not r.is_outgoing and r.deleted_at is null
    order by f.order_index, a.order_index, r.order_index`)
    .map(([id, nume, faza, act, stareAct, stareFaza, stare]) => ({ id, nume, faza: +faza, act: +act, stareAct, stareFaza, stare }))
}

const senior = CONTURI.senior, junior = CONTURI.junior
const MOTIVE = [
  'Documentul este expirat — avem nevoie de unul emis în ultimele 30 de zile.',
  'Lipsește semnătura reprezentantului legal pe ultima pagină.',
  'Scanarea nu se citește; vă rog încărcați o copie mai clară.',
]

async function aduceLaZi(titlu, clientEmail, firma) {
  const id = proiect(titlu)
  if (!id) throw new Error(`Lipsește proiectul „${titlu}”. Rulează întâi npm run seed:local.`)
  const lista = cereri(id)
  let aprobate = 0, inVerificare = 0, respinse = 0, k = 0
  for (const c of lista) {
    if (c.stare !== 'pending') continue
    const terminata = c.stareFaza === 'completed' || c.stareAct === 'completed'
    const curenta = c.stareAct === 'in_progress'
    if (terminata) {
      await incarca(clientEmail, c.id, c.nume, firma)
      await revizuieste(k++ % 2 ? junior : senior, c.id, 'approved')
      aprobate++
    } else if (curenta) {
      // Activitatea în lucru: un amestec realist de stări.
      const i = inVerificare + respinse
      await incarca(clientEmail, c.id, c.nume, firma)
      if (i % 3 === 2) { await revizuieste(senior, c.id, 'rejected', MOTIVE[respinse % MOTIVE.length]); respinse++ }
      else inVerificare++
    }
  }
  console.log(`${titlu}: ${aprobate} aprobate, ${inVerificare} în verificare, ${respinse} respinse`)
  return id
}

// ---------- Proiectul-vitrină al ghidului ----------
// „Agro Verde — linie de procesare legume”: prima fază în lucru. Construim de
// mână stările, ca fiecare fel de cerere să apară măcar o dată.
const F = proiect('Agro Verde — linie de procesare legume')
const AGRO = CONTURI.client, FIRMA_AGRO = 'Agro Verde SRL'
{
  const lista = cereri(F).filter(c => c.stare === 'pending')
  const dinAct = n => lista.filter(c => c.faza === 1 && c.act === n)
  for (const [i, c] of [...dinAct(1), ...dinAct(2)].entries()) {
    await incarca(AGRO, c.id, c.nume, FIRMA_AGRO)
    await revizuieste(i % 2 ? junior : senior, c.id, 'approved')
  }
  const locatie = dinAct(3) // Analiza locației investiției: 5 cereri
  await incarca(AGRO, locatie[0].id, locatie[0].nume, FIRMA_AGRO)
  await revizuieste(senior, locatie[0].id, 'approved')
  await incarca(AGRO, locatie[1].id, locatie[1].nume, FIRMA_AGRO)
  await incarca(AGRO, locatie[2].id, locatie[2].nume, FIRMA_AGRO)
  await revizuieste(senior, locatie[2].id, 'rejected', MOTIVE[0])
  await incarca(AGRO, locatie[3].id, locatie[3].nume, FIRMA_AGRO)
  const buget = dinAct(4)
  await incarca(AGRO, buget[0].id, buget[0].nume, FIRMA_AGRO)
  // Termenele primei faze: o activitate depășită, restul în față.
  const zi = 864e5, azi = Date.now()
  const acts = rows(`select a.id, a.order_index from project_activities a join project_phases f on f.id=a.phase_id
    where f.project_id=${esc(F)} and f.order_index=(select min(order_index) from project_phases where project_id=${esc(F)}) order by a.order_index`)
  const termene = { 1: -20, 2: -12, 3: -3, 4: 9, 5: 16 }
  for (const [aid, ord] of acts) {
    const d = new Date(azi + termene[ord] * zi).toISOString()
    sql(`update project_activities set deadline_at='${d}' where id=${esc(aid)}`)
    sql(`update document_requirements set deadline_at='${d}' where activity_id=${esc(aid)}`)
  }
  console.log('proiectul-vitrină: cereri aprobate, în verificare, respinse și de încărcat')
}

// ---------- Celelalte proiecte în lucru ----------
await aduceLaZi('Brutăria Moldovei — extindere capacitate de producție', 'client.brutaria@test.local', 'Brutaria Moldovei SRL')
await aduceLaZi('TechNord — centru de producție imprimare 3D', 'client.technord@test.local', 'TechNord Solutions SRL')

// Proiectele din șabloanele mici n-au termene; le dăm termene în față.
for (const titlu of ['Agro Verde — dotare fermă legumicolă', 'Brutăria Moldovei — linie nouă de panificație', 'TechNord — atelier de prototipare', 'Agro Verde — depozit frigorific']) {
  const id = proiect(titlu)
  const acts = rows(`select a.id from project_activities a join project_phases f on f.id=a.phase_id where f.project_id=${esc(id)} order by f.order_index, a.order_index`)
  for (const [i, [aid]] of acts.entries()) {
    const d = new Date(Date.now() + (10 + i * 12) * 864e5).toISOString()
    sql(`update project_activities set deadline_at='${d}' where id=${esc(aid)}`)
    sql(`update document_requirements set deadline_at='${d}' where activity_id=${esc(aid)}`)
  }
}

// ---------- Chat ----------
const chat = [
  [AGRO, 'Bună ziua! Am încărcat extrasul de carte funciară, contractul de comodat, certificatul de urbanism și planul de încadrare. Fotografiile le fac săptămâna viitoare.'],
  [senior, 'Mulțumim, domnule Vasilescu. Extrasul e în regulă. Certificatul de urbanism însă e expirat — l-am respins, motivul e scris pe cerere.'],
  [AGRO, 'Am înțeles, cer unul nou de la primărie și revin.'],
  [junior, 'Pentru bugetul preliminar mai avem nevoie de a doua ofertă de preț la echipamente. Modelul de grilă îl găsiți în „Documente de la consultant”.'],
]
for (const [email, body] of chat) await api(email, 'POST', `/api/projects/${F}/chat/messages`, { body })
const anaId = sql(`select id from profiles where email=${esc(junior)}`)
const { conversation } = await api(senior, 'POST', '/api/private-conversations', { userId: anaId }).catch(e => ({ conversation: null, e }))
const convId = conversation?.id ?? sql(`select id from private_conversations limit 1`)
for (const [email, body] of [
  [senior, 'Ana, poți să te uiți azi pe planul de afaceri de la TechNord? Clientul a încărcat varianta nouă.'],
  [junior, 'Da, îl verific după-amiază și îți scriu ce mai lipsește.'],
]) await api(email, 'POST', `/api/private-conversations/${convId}/messages`, { body })
console.log('chat: mesaje în proiect și o conversație privată')
console.log('\nGata. Proiectul-vitrină:', `${APP}/projects/${F}`)

// Proiectul încheiat din seed are termene de acum 12 ani; le aducem în ultimul an.
{
  const id = proiect('Agro Verde — sistem de irigații (încheiat)')
  const decalaj = `((now() - interval '20 days') - (select max(a.deadline_at) from project_activities a join project_phases f on f.id=a.phase_id where f.project_id=${esc(id)}))`
  sql(`update document_requirements set deadline_at = deadline_at + ${decalaj} where project_id=${esc(id)} and deadline_at is not null`)
  sql(`update project_phases set completed_at = completed_at + ${decalaj} where project_id=${esc(id)} and completed_at is not null`)
  sql(`update project_activities a set deadline_at = a.deadline_at + d.x, started_at = a.started_at + d.x, completed_at = a.completed_at + d.x
    from (select ${decalaj} x) d where a.phase_id in (select id from project_phases where project_id=${esc(id)})`)
  sql(`update projects set created_at = (select min(a.started_at) from project_activities a join project_phases f on f.id=a.phase_id where f.project_id=${esc(id)}) where id=${esc(id)}`)
}

// Seed-ul lasă sute de notificări necitite; în capturi rămân doar ultimele 4 pe persoană.
sql(`update notifications n set read_at=now() where read_at is null and id not in (
  select id from (select id, row_number() over (partition by user_id order by created_at desc) r from notifications) x where r <= 4)`)
console.log('notificări: rămân necitite doar ultimele 4 pe persoană')
