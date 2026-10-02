// Date de test pentru Supabase-ul LOCAL: conturi, statusuri, programe,
// 3 șabloane mici, un șablon mare (9 faze, ~118 cereri de document) și
// proiecte în stadii diferite. Refuză să ruleze pe altă bază decât cea locală.
//
// Folosire: pornește `supabase start` și aplicația (`npm run dev`), apoi
//   npm run seed:local
// Toate conturile au parola `Parola123!` (admin: admin@test.local).
// Se poate rula de mai multe ori: șabloanele de test se recreează de la zero.
import nextEnv from '@next/env'
import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

nextEnv.loadEnvConfig(process.cwd())
const env = process.env
if (!env.NEXT_PUBLIC_SUPABASE_URL?.startsWith('http://127.0.0.1')) {
  console.error('NEXT_PUBLIC_SUPABASE_URL nu e Supabase-ul local (http://127.0.0.1…). Mă opresc.')
  process.exit(1)
}

const APP = env.SEED_APP_URL || 'http://localhost:3000'
const DB_CONTAINER = env.SEED_DB_CONTAINER || 'supabase_db_platforma-fonduri'
const PAROLA = 'Parola123!'
const service = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const sql = (q) => execFileSync('docker', ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt', '-c', q], { encoding: 'utf8' }).trim()
const esc = (s) => s == null ? 'null' : `'${String(s).replace(/'/g, "''")}'`
const slugify = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

try {
  const res = await fetch(APP)
  if (!res.ok && res.status >= 500) throw new Error(String(res.status))
} catch {
  console.error(`Aplicația nu răspunde la ${APP}. Pornește întâi \`npm run dev\`.`)
  process.exit(1)
}

// ---------- Utilizatori ----------
const users = [
  { key: 'admin', email: 'admin@test.local', role: 'admin', full_name: 'Elena Admin' },
  { key: 'ana', email: 'ana.popescu@test.local', role: 'consultant', full_name: 'Ana Popescu', specializare: 'Fonduri europene' },
  { key: 'mihai', email: 'mihai.ionescu@test.local', role: 'consultant', full_name: 'Mihai Ionescu', specializare: 'Agricultură (AFIR)', consultant_level: 'senior' },
  { key: 'agro', email: 'client.agroverde@test.local', role: 'client', full_name: 'Ion Vasilescu', nume_firma: 'Agro Verde SRL', cif: 'RO31245678', telefon: '0744123456' },
  { key: 'brutaria', email: 'client.brutaria@test.local', role: 'client', full_name: 'Maria Stan', nume_firma: 'Brutăria Moldovei SRL', cif: 'RO28765432', telefon: '0755987654' },
  { key: 'tech', email: 'client.technord@test.local', role: 'client', full_name: 'Andrei Rusu', nume_firma: 'TechNord Solutions SRL', cif: 'RO40123987', telefon: '0766112233' },
]
const { data: existing } = await service.auth.admin.listUsers({ perPage: 1000 })
const id = {}
for (const u of users) {
  let authUser = existing.users.find(x => x.email === u.email)
  if (!authUser) {
    const { data, error } = await service.auth.admin.createUser({ email: u.email, password: PAROLA, email_confirm: true })
    if (error) throw error
    authUser = data.user
  }
  id[u.key] = authUser.id
  sql(`insert into profiles(id,email,role,consultant_level,full_name,nume_firma,cif,telefon,specializare,is_active)
       values (${esc(authUser.id)},${esc(u.email)},${esc(u.role)},${esc(u.consultant_level ?? 'junior')},${esc(u.full_name)},${esc(u.nume_firma)},${esc(u.cif)},${esc(u.telefon)},${esc(u.specializare)},true)
       on conflict (id) do update set role=excluded.role, consultant_level=excluded.consultant_level, full_name=excluded.full_name, nume_firma=excluded.nume_firma, cif=excluded.cif, telefon=excluded.telefon, specializare=excluded.specializare, is_active=true`)
}
console.log('utilizatori:', Object.keys(id).length)

const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
const { data: login, error: loginError } = await anon.auth.signInWithPassword({ email: 'admin@test.local', password: PAROLA })
if (loginError) throw loginError
const headers = { Authorization: `Bearer ${login.session.access_token}`, 'Content-Type': 'application/json' }
async function api(method, path, body) {
  const send = () => fetch(`${APP}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  // Conexiunea keep-alive se închide cât stăm în SQL; eroarea apare înainte
  // să ajungă la server, deci reîncercarea e sigură.
  const res = await send().catch(send)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json)}`)
  return json
}

// ---------- Statusuri, programe, măsuri ----------
const statuses = [
  ['Pregătire', 'pregatire', '#6B7280', 'FileText', 1],
  ['Depunere', 'depunere', '#2563EB', 'Send', 2],
  ['Evaluare', 'evaluare', '#D97706', 'Search', 3],
  ['Contractare', 'contractare', '#7C3AED', 'FileSignature', 4],
  ['Implementare', 'implementare', '#059669', 'Hammer', 5],
  ['Monitorizare', 'monitorizare', '#0891B2', 'Eye', 6],
]
const status = {}
for (const [name, slug, color, icon, order] of statuses) {
  status[slug] = sql(`insert into project_statuses(name,slug,color,icon,order_index,is_active) values (${esc(name)},${esc(slug)},${esc(color)},${esc(icon)},${order},true)
    on conflict (slug) do update set name=excluded.name returning id`).split('\n')[0]
}
const programId = sql(`insert into programs(name,slug,description,is_active) values ('Programul Național de Dezvoltare Rurală','pndr','Finanțări AFIR pentru agricultură și mediul rural',true) on conflict (slug) do update set name=excluded.name returning id`).split('\n')[0]
const programId2 = sql(`insert into programs(name,slug,description,is_active) values ('Start-Up Nation România','start-up-nation','Granturi pentru firme nou înființate',true) on conflict (slug) do update set name=excluded.name returning id`).split('\n')[0]
const measure = (slug, insert) => sql(`select id from program_measures where slug='${slug}' limit 1`) || sql(`${insert} returning id`).split('\n')[0]
const measureAfir = measure('dr-30', `insert into program_measures(program_id,name,slug,code,max_funding_amount,currency,is_active) values (${esc(programId)},'Instalarea tinerilor fermieri','dr-30','DR-30',70000,'EUR',true)`)
const measureSun = measure('sun-2026', `insert into program_measures(program_id,name,slug,code,max_funding_amount,currency,is_active) values (${esc(programId2)},'Start-Up Nation 2026','sun-2026','SUN-2026',200000,'RON',true)`)
console.log('statusuri și programe: ok')

// ---------- Fișier-model real în storage ----------
const pdf = Buffer.from(`%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 60>>stream
BT /F1 18 Tf 60 780 Td (Model plan de afaceri - date de test) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF`)
const modelPath = `templates/attachments/${crypto.randomUUID()}_Model_plan_de_afaceri.pdf`
const { error: uploadError } = await service.storage.from('project-files').upload(modelPath, pdf, { contentType: 'application/pdf' })
if (uploadError) throw uploadError
const modelAttachment = [{ storage_path: modelPath, original_name: 'Model plan de afaceri.pdf', mime_type: 'application/pdf', file_size: pdf.length, order_index: 0 }]

// ---------- Curățenie înainte de o nouă rulare ----------
// Șabloanele de test se recunosc după nume sau după slug-ul inițial (oricare
// poate fi schimbat din editor), iar proiectele după clienții @test.local.
// Așa o rulare nouă nu lasă în urmă dubluri.
const SEED_TEMPLATES = [
  ['Start-Up Nation 2026', 'start-up-nation-2026'],
  ['AFIR — Instalarea tinerilor fermieri (DR-30)', 'afir-dr-30'],
  ['PNRR — Digitalizare IMM', 'pnrr-digitalizare-imm'],
  ['PR Nord-Est 2021-2027 — Investiții în IMM-uri (Prioritatea 1)', 'pr-nord-est-imm-p1'],
]
const seedNames = SEED_TEMPLATES.map(([name]) => esc(name)).join(',')
const seedSlugs = SEED_TEMPLATES.map(([name, slug]) => `${esc(slug)},${esc(slugify(name))}`).join(',')
const seedTemplateIds = `select id from project_templates where name in (${seedNames}) or slug in (${seedSlugs})`
const seedProjectIds = `select id from projects where template_id in (${seedTemplateIds})
  or client_id in (select id from profiles where email like 'client.%@test.local')`
sql(`delete from document_requirements where project_id in (${seedProjectIds})`)
sql(`delete from projects where id in (${seedProjectIds})`)
const removedTemplates = sql(`with removed as (delete from project_templates where id in (${seedTemplateIds}) returning 1) select count(*) from removed`)
console.log('curățenie: șabloane de test vechi șterse:', removedTemplates)

// ---------- Șabloane ----------
const O = 'obligatoriu', C = 'daca_e_cazul', P = 'optional'
const templates = [
  {
    name: 'Start-Up Nation 2026', slug: 'start-up-nation-2026', measure: measureSun, publish: true,
    description: 'Grant de până la 200.000 lei pentru firme nou înființate.',
    phases: [
      ['Pregătire dosar', 'pregatire', [
        ['Colectare documente firmă', 'ana', [['Certificat constatator ONRC', O], ['Act constitutiv', O], ['Carte de identitate asociați', O], ['Certificat de cazier fiscal', C]]],
        ['Plan de afaceri', 'ana', [['Model plan de afaceri (de completat)', P, true], ['Plan de afaceri completat', O], ['Oferte de preț echipamente', O]]],
      ]],
      ['Depunere cerere', 'depunere', [
        ['Înscriere în aplicația electronică', 'ana', [['Confirmare înscriere', O]]],
        ['Depunere dosar complet', null, [['Declarație pe propria răspundere', O], ['Declarație de minimis', O]]],
      ]],
      ['Contractare', 'contractare', [
        ['Semnare acord de finanțare', null, [['Acord de finanțare semnat', O], ['Extras de cont dedicat proiectului', O]]],
      ]],
      ['Implementare', 'implementare', [
        ['Achiziții', null, [['Facturi achiziții', O], ['Procese-verbale de recepție', O], ['Dovezi plată', O]]],
        ['Cerere de plată', null, [['Cerere de rambursare', O], ['Raport de progres', O]]],
      ]],
    ],
  },
  {
    name: 'AFIR — Instalarea tinerilor fermieri (DR-30)', slug: 'afir-dr-30', measure: measureAfir, publish: true,
    description: 'Sprijin forfetar de până la 70.000 EUR pentru tinerii fermieri.',
    phases: [
      ['Pregătire', 'pregatire', [
        ['Documente exploatație', 'mihai', [['Extras APIA / Registrul agricol', O], ['Contracte de arendă', C], ['Certificat de competențe profesionale', O]]],
        ['Plan de afaceri agricol', 'mihai', [['Plan de afaceri DR-30', O], ['Studiu de piață', P]]],
      ]],
      ['Evaluare AFIR', 'evaluare', [
        ['Răspuns la clarificări', 'mihai', [['Răspuns informații suplimentare', C]]],
      ]],
      ['Monitorizare', 'monitorizare', [
        ['Raportare anuală', null, [['Raport anual de activitate', O], ['Dovada comercializării producției', O]]],
      ]],
    ],
  },
  {
    name: 'PNRR — Digitalizare IMM', slug: 'pnrr-digitalizare-imm', measure: null, publish: false,
    description: 'Ciornă: șablon în lucru pentru apelul de digitalizare.',
    phases: [
      ['Pregătire', 'pregatire', [
        ['Analiză maturitate digitală', 'ana', [['Chestionar autoevaluare', O], ['Inventar echipamente IT', P]]],
      ]],
      ['Depunere', 'depunere', [
        ['Depunere pe platforma MIPE', null, [['Cerere de finanțare', O]]],
      ]],
    ],
  },
]

const created = {}
for (const t of templates) {
  const { template } = await api('POST', '/api/admin/templates', { name: t.name, slug: t.slug, description: t.description, measure_id: t.measure })
  const tree = { id: template.id, phases: [] }
  for (const [pIdx, [phaseName, statusSlug, activities]] of t.phases.entries()) {
    const { phase } = await api('POST', '/api/admin/templates/phases', { template_id: template.id, project_status_id: status[statusSlug], name: phaseName, slug: slugify(phaseName), order_index: pIdx + 1 })
    const phaseTree = { id: phase.id, activities: [] }
    for (const [aIdx, [activityName, consultant, docs]] of activities.entries()) {
      const { activity } = await api('POST', '/api/admin/templates/activities', { template_phase_id: phase.id, name: activityName, order_index: aIdx + 1, default_consultant_id: consultant ? id[consultant] : null })
      phaseTree.activities.push(activity.id)
      for (const [dIdx, [docName, type, outgoing]] of docs.entries()) {
        await api('POST', '/api/admin/templates/documents', {
          template_activity_id: activity.id, name: docName, requirement_type: outgoing ? 'optional' : type, order_index: dIdx + 1,
          is_outgoing: outgoing === true,
          ...(outgoing ? { attachments: modelAttachment, attachment_path: modelPath, attachment_original_name: 'Model plan de afaceri.pdf' } : {}),
        })
      }
    }
    tree.phases.push(phaseTree)
  }
  if (t.publish) await api('PATCH', `/api/admin/templates/${template.id}`, { status: 'published' })
  created[t.slug] = tree
  console.log('șablon:', t.name, t.publish ? '(publicat)' : '(ciornă)')
}

// ---------- Proiecte ----------
const projects = [
  ['Agro Verde — dotare fermă legumicolă', 'agro', 'afir-dr-30', ['mihai']],
  ['Brutăria Moldovei — linie nouă de panificație', 'brutaria', 'start-up-nation-2026', ['ana']],
  ['TechNord — atelier de prototipare', 'tech', 'start-up-nation-2026', ['ana', 'mihai']],
  ['Agro Verde — depozit frigorific', 'agro', 'start-up-nation-2026', ['mihai']],
]
for (const [title, client, templateSlug, members] of projects) {
  // Mihai e singurul senior din seed, deci supervizează fiecare dosar.
  const { project } = await api('POST', '/api/projects', { title, client_id: id[client], supervisor_ids: [id.mihai] })
  await api('POST', `/api/projects/${project.id}/import-template`, { template_id: created[templateSlug].id })
  for (const m of members.filter(m => m !== 'mihai')) await api('POST', `/api/projects/${project.id}/members`, { consultant_id: id[m] })
  sql(`update projects set general_consultant_id=${esc(id[members[0]])} where id=${esc(project.id)}`)
  console.log('proiect:', title)
}

// ---------- Modificări în șablon după crearea proiectelor ----------
// Ca preview-ul de propagare să aibă ce arăta: o cerere nouă și o activitate nouă.
const sun = created['start-up-nation-2026']
await api('POST', '/api/admin/templates/documents', { template_activity_id: sun.phases[0].activities[0], name: 'Certificat ANAF de atestare fiscală', requirement_type: O, order_index: 5 })
await api('POST', '/api/admin/templates/activities', { template_phase_id: sun.phases[3].id, name: 'Vizită de monitorizare', order_index: 3 })
console.log('șablonul Start-Up Nation are acum modificări de propagat în 3 proiecte')

// ---------- Șablonul mare și proiectele lui ----------
{
  const who = Object.fromEntries(sql(`select split_part(email,'@',1)||'='||id from profiles where email like '%@test.local'`).split('\n').map(l => l.split('=')))
  const ana = who['ana.popescu'], mihai = who['mihai.ionescu']
  const status = Object.fromEntries(sql(`select slug||'='||id from project_statuses`).split('\n').map(l => l.split('=')))

  // ---------- Fișiere-model reale în storage ----------
  function pdfBytes(title) {
    const text = title.replace(/[()\\]/g, '')
    const stream = `BT /F1 16 Tf 60 780 Td (${text}) Tj ET`
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
  async function uploadModel(fileName) {
    const bytes = pdfBytes(`${fileName.replace(/\.pdf$/, '')} - model de test`)
    const path = `templates/attachments/${crypto.randomUUID()}_${fileName.replace(/[^\w.\-]+/g, '_')}`
    const { error } = await service.storage.from('project-files').upload(path, bytes, { contentType: 'application/pdf' })
    if (error) throw error
    return [{ storage_path: path, original_name: fileName, mime_type: 'application/pdf', file_size: bytes.length, order_index: 0 }]
  }

  // ---------- Șablonul mare ----------
  // [nume, tip] ; tip: O obligatoriu, C dacă e cazul, P opțional, M = trimis clientului (cu fișier-model)
  const O = 'obligatoriu', C = 'daca_e_cazul', P = 'optional', M = 'model'
  const T = {
    name: 'PR Nord-Est 2021-2027 — Investiții în IMM-uri (Prioritatea 1)',
    slug: 'pr-nord-est-imm-p1',
    description: 'Flux complet pentru o cerere de finanțare nerambursabilă de până la 200.000 EUR, de la eligibilitate până la monitorizarea ex-post de 3 ani.',
    phases: [
      ['Eligibilitate și pregătire', 'pregatire', [
        ['Verificare eligibilitate solicitant', ana, [['Certificat constatator ONRC (extins)', O], ['Situații financiare ultimii 3 ani', O], ['Declarație privind încadrarea în categoria IMM', O], ['Certificat de atestare fiscală ANAF', O], ['Certificat de atestare fiscală local', O], ['Cazier judiciar reprezentant legal', O]]],
        ['Verificare eligibilitate proiect', ana, [['Fișa de verificare a codurilor CAEN', O], ['Chestionar de eligibilitate (model)', M], ['Declarație privind evitarea dublei finanțări', O]]],
        ['Analiza locației investiției', mihai, [['Extras de carte funciară (sub 30 zile)', O], ['Contract de închiriere / comodat', C], ['Certificat de urbanism', O], ['Plan de încadrare în zonă', O], ['Fotografii ale amplasamentului', P]]],
        ['Stabilirea bugetului preliminar', ana, [['Oferte de preț pentru echipamente (min. 2)', O], ['Oferte de preț pentru construcții', C], ['Grilă de buget preliminar (model)', M]]],
        ['Semnare contract de consultanță', null, [['Contract de consultanță semnat', O], ['Împuternicire pentru depunere', O], ['Acord GDPR prelucrare date', O]]],
      ]],
      ['Elaborare documentație tehnică', 'pregatire', [
        ['Studiu de fezabilitate / DALI', mihai, [['Temă de proiectare', O], ['Studiu geotehnic', C], ['Studiu topografic', C], ['Studiu de fezabilitate (draft)', O], ['Studiu de fezabilitate (final, semnat)', O]]],
        ['Avize și acorduri', mihai, [['Aviz de mediu (APM)', O], ['Aviz ISU', C], ['Aviz DSP', C], ['Aviz furnizor energie electrică', C], ['Aviz furnizor apă-canal', C]]],
        ['Plan de afaceri', ana, [['Plan de afaceri (model)', M], ['Plan de afaceri completat', O], ['Analiză cost-beneficiu', O], ['Proiecții financiare pe 5 ani', O]]],
        ['Analiza pieței', ana, [['Studiu de piață', O], ['Scrisori de intenție de la clienți', P], ['Contracte comerciale existente', P]]],
        ['Documente privind resursa umană', ana, [['Organigrama firmei', O], ['CV-uri echipă de management', O], ['Extras REVISAL', O], ['Plan de angajări', O]]],
      ]],
      ['Depunere cerere de finanțare', 'depunere', [
        ['Înregistrare în MySMIS2021', ana, [['Confirmare cont MySMIS', O], ['Certificat de semnătură electronică', O]]],
        ['Completarea cererii de finanțare', ana, [['Cerere de finanțare (export PDF)', O], ['Anexa — declarație unică', O], ['Anexa — declarație de minimis', O], ['Anexa — acord de parteneriat', C]]],
        ['Verificare finală înainte de depunere', null, [['Checklist de conformitate (model)', M], ['Checklist completat și semnat', O]]],
        ['Transmiterea cererii', null, [['Recipisă de depunere MySMIS', O]]],
      ]],
      ['Evaluare și selecție', 'evaluare', [
        ['Verificarea conformității administrative', null, [['Solicitare de clarificări (CAE)', C], ['Răspuns la clarificări (CAE)', C]]],
        ['Evaluare tehnico-financiară', ana, [['Solicitare de clarificări (ETF)', C], ['Răspuns la clarificări (ETF)', C], ['Grila de punctaj estimată', P]]],
        ['Vizită pe teren', mihai, [['Proces-verbal vizită pe teren', C], ['Fotografii de la vizită', P]]],
        ['Rezultatul evaluării', null, [['Notificare rezultat evaluare', O], ['Contestație', C], ['Răspuns la contestație', C]]],
      ]],
      ['Contractare', 'contractare', [
        ['Documente precontractare', ana, [['Certificat de atestare fiscală actualizat', O], ['Certificat constatator actualizat', O], ['Dovada cofinanțării (extras de cont / scrisoare bancară)', O], ['Declarație de eligibilitate actualizată', O]]],
        ['Semnarea contractului de finanțare', null, [['Contract de finanțare semnat', O], ['Anexe la contractul de finanțare', O]]],
        ['Deschidere conturi', null, [['Extras cont dedicat proiectului', O], ['Specimen de semnătură', O]]],
        ['Constituire garanții', null, [['Scrisoare de garanție pentru avans', C], ['Polițe de asigurare active', C]]],
      ]],
      ['Achiziții', 'implementare', [
        ['Plan de achiziții', mihai, [['Plan de achiziții aprobat', O], ['Calendarul achizițiilor', O]]],
        ['Achiziție echipamente', mihai, [['Anunț de atribuire publicat', O], ['Oferte primite', O], ['Raport de atribuire', O], ['Contract de furnizare semnat', O]]],
        ['Achiziție lucrări de construcții', mihai, [['Caiet de sarcini lucrări', C], ['Contract de execuție lucrări', C], ['Autorizație de construire', C]]],
        ['Achiziție servicii (publicitate, audit)', ana, [['Contract servicii de publicitate', O], ['Contract servicii de audit financiar', O]]],
      ]],
      ['Implementare', 'implementare', [
        ['Începerea proiectului', ana, [['Notificare privind începerea implementării', O], ['Grafic de implementare actualizat', O]]],
        ['Livrare și montaj echipamente', mihai, [['Facturi furnizor', O], ['Avize de însoțire a mărfii', O], ['Procese-verbale de recepție', O], ['Procese-verbale de punere în funcțiune', O]]],
        ['Execuție lucrări', mihai, [['Situații de lucrări', C], ['Procese-verbale de recepție parțială', C], ['Proces-verbal de recepție la terminarea lucrărilor', C]]],
        ['Informare și publicitate', ana, [['Fotografii panou temporar', O], ['Anunț de presă — început proiect', O], ['Anunț de presă — final proiect', O], ['Fotografii placă permanentă', O]]],
        ['Angajări', ana, [['Contracte de muncă noi', O], ['Extras REVISAL actualizat', O]]],
      ]],
      ['Cereri de plată și rambursare', 'implementare', [
        ['Cerere de prefinanțare', ana, [['Cerere de prefinanțare', C], ['Facturi aferente prefinanțării', C]]],
        ['Cerere de rambursare intermediară', ana, [['Cerere de rambursare', O], ['Raport tehnic de progres', O], ['Raport de audit financiar', O], ['Dovezi plată (OP, extrase)', O]]],
        ['Cerere de rambursare finală', ana, [['Cerere de rambursare finală', O], ['Raport final de implementare', O], ['Raport de audit final', O]]],
        ['Vizite de verificare la fața locului', mihai, [['Proces-verbal de verificare', C], ['Plan de măsuri corective', C]]],
      ]],
      ['Monitorizare post-implementare', 'monitorizare', [
        ['Raport de durabilitate — anul 1', ana, [['Raport de durabilitate anul 1', O], ['Situații financiare anul 1', O], ['Dovada menținerii locurilor de muncă (anul 1)', O]]],
        ['Raport de durabilitate — anul 2', ana, [['Raport de durabilitate anul 2', O], ['Situații financiare anul 2', O], ['Dovada menținerii locurilor de muncă (anul 2)', O]]],
        ['Raport de durabilitate — anul 3', ana, [['Raport de durabilitate anul 3', O], ['Situații financiare anul 3', O], ['Dovada menținerii locurilor de muncă (anul 3)', O]]],
        ['Închiderea proiectului', null, [['Notificare de închidere a monitorizării', O], ['Arhivarea documentelor proiectului', O]]],
      ]],
    ],
  }

  const measureId = sql(`select id from program_measures where slug='sun-2026' limit 1`) || null
  const { template } = await api('POST', '/api/admin/templates', { name: T.name, slug: T.slug, description: T.description, measure_id: measureId })
  let counts = { phases: 0, activities: 0, docs: 0, models: 0 }
  for (const [pIdx, [phaseName, statusSlug, activities]] of T.phases.entries()) {
    const { phase } = await api('POST', '/api/admin/templates/phases', { template_id: template.id, project_status_id: status[statusSlug], name: phaseName, slug: slugify(phaseName), order_index: pIdx + 1 })
    counts.phases++
    for (const [aIdx, [activityName, consultant, docs]] of activities.entries()) {
      const { activity } = await api('POST', '/api/admin/templates/activities', { template_phase_id: phase.id, name: activityName, order_index: aIdx + 1, default_consultant_id: consultant })
      counts.activities++
      for (const [dIdx, [docName, type]] of docs.entries()) {
        const outgoing = type === M
        const attachments = outgoing ? await uploadModel(`${docName.replace(/\s*\(model\)/, '')}.pdf`) : null
        await api('POST', '/api/admin/templates/documents', {
          template_activity_id: activity.id, name: docName, order_index: dIdx + 1,
          requirement_type: outgoing ? 'optional' : type, is_outgoing: outgoing,
          ...(attachments ? { attachments, attachment_path: attachments[0].storage_path, attachment_original_name: attachments[0].original_name } : {}),
        })
        counts.docs++
        if (outgoing) counts.models++
      }
    }
  }
  await api('PATCH', `/api/admin/templates/${template.id}`, { status: 'published' })
  console.log(`șablon: ${T.name} — ${counts.phases} faze, ${counts.activities} activități, ${counts.docs} cereri de document (${counts.models} cu fișier-model)`)

  // ---------- Proiecte, fiecare în alt stadiu ----------
  // `upTo`: câte faze sunt terminate; faza următoare e în lucru pe jumătate.
  const projects = [
    { title: 'Brutăria Moldovei — extindere capacitate de producție', client: 'client.brutaria', members: [ana, mihai], upTo: 5 },
    { title: 'TechNord — centru de producție imprimare 3D', client: 'client.technord', members: [ana], upTo: 2 },
    { title: 'Agro Verde — linie de procesare legume', client: 'client.agroverde', members: [mihai, ana], upTo: 0 },
  ]
  const day = 24 * 3600 * 1000
  for (const p of projects) {
    const { project } = await api('POST', '/api/projects', { title: p.title, client_id: who[p.client], supervisor_ids: [mihai] })
    await api('POST', `/api/projects/${project.id}/import-template`, { template_id: template.id })
    for (const m of p.members.filter(m => m !== mihai)) await api('POST', `/api/projects/${project.id}/members`, { consultant_id: m })

    const phases = sql(`select id from project_phases where project_id=${esc(project.id)} order by order_index`).split('\n')
    const startedAt = Date.now() - (p.upTo * 45 + 20) * day
    for (const [i, phaseId] of phases.entries()) {
      const done = i < p.upTo, current = i === p.upTo
      const phaseStatus = done ? 'completed' : current ? 'in_progress' : 'pending'
      // Faze terminate și cea curentă sunt publicate pentru client; restul rămân ciornă.
      const visibility = done || current ? 'published' : 'draft'
      sql(`update project_phases set status=${esc(phaseStatus)}, visibility=${esc(visibility)} where id=${esc(phaseId)}`)
      const acts = sql(`select id from project_activities where phase_id=${esc(phaseId)} order by order_index`).split('\n').filter(Boolean)
      for (const [j, actId] of acts.entries()) {
        const actDone = done || (current && j < Math.floor(acts.length / 2))
        const actNow = current && j === Math.floor(acts.length / 2)
        const s = actDone ? 'completed' : actNow ? 'in_progress' : 'pending'
        const base = startedAt + (i * 45 + j * 7) * day
        const deadline = new Date(base + 14 * day).toISOString()
        const started = actDone || actNow ? `'${new Date(base).toISOString()}'` : 'null'
        const completed = actDone ? `'${new Date(base + 10 * day).toISOString()}'` : 'null'
        sql(`update project_activities set status=${esc(s)}, visibility=${esc(visibility)}, deadline_at='${deadline}', started_at=${started}, completed_at=${completed},
             assigned_to=coalesce(assigned_to, ${esc(p.members[j % p.members.length])}) where id=${esc(actId)}`)
        sql(`update document_requirements set visibility=${esc(visibility)}, deadline_at='${deadline}' where activity_id=${esc(actId)}`)
      }
    }
    const currentStatus = sql(`select project_status_id from project_phases where project_id=${esc(project.id)} and status='in_progress' limit 1`)
    sql(`update projects set general_consultant_id=${esc(p.members[0])}, current_status_id=${esc(currentStatus || null)}, created_at='${new Date(startedAt).toISOString()}' where id=${esc(project.id)}`)
    console.log(`proiect: ${p.title} — ${p.upTo} faze terminate, faza ${p.upTo + 1} în lucru`)
  }
}

console.log(`\nGata. Intră pe ${APP} cu admin@test.local / ${PAROLA}`)
