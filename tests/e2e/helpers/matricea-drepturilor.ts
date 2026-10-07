/**
 * Rândurile din „Cine ce poate face: admin, consultant senior, consultant
 * junior” (docs/drepturi-admin-senior-junior.pdf), în ordinea lor. Suita de
 * drepturi (API și bază) și cea de interfață le verifică pe aceleași id-uri,
 * ca rapoartele lor să se poată pune unul lângă altul.
 */

export type Row = {
  id: string
  section: string
  title: string
  note?: string
  admin: string
  senior: string
  junior: string
  isNew?: boolean
}

export const ROWS: Row[] = [
  { id: 'p-vede', section: 'Proiecte', title: 'Vede proiectul', admin: 'Toate', senior: 'Da*', junior: 'Da*' },
  // Juniorul nu deschide dosare: decizie din discuție (1 octombrie 2026), după PDF, unde avea „Da”.
  { id: 'p-creeaza', section: 'Proiecte', title: 'Creează un proiect nou', note: 'Cine îl creează devine automat membru. Juniorul nu deschide dosare', admin: 'Da', senior: 'Da', junior: 'Nu' },
  { id: 'p-continut', section: 'Proiecte', title: 'Adaugă și modifică faze, activități și cereri de documente', admin: 'Da', senior: 'Da*', junior: 'Da*' },
  { id: 'p-aproba', section: 'Proiecte', title: 'Aprobă sau respinge documentele trimise de client', admin: 'Da', senior: 'Da*', junior: 'Da*' },
  { id: 'p-editeaza', section: 'Proiecte', title: 'Schimbă titlul, statusul și reminderele automate', admin: 'Da', senior: 'Da*', junior: 'Nu', isNew: true },
  // #109, decizia D1 (5 octombrie 2026): juniorul nu încheie și nu marchează nimic ca finalizat.
  { id: 'p-incheie', section: 'Proiecte', title: 'Încheie și redeschide proiectul', note: 'Doar din pagina proiectului. Cât e încheiat, reminderele automate sunt oprite', admin: 'Da', senior: 'Da*', junior: 'Nu', isNew: true },
  { id: 'p-finalizeaza', section: 'Proiecte', title: 'Marchează faze, activități și cereri ca finalizate și le redeschide', note: 'Cererile se închid din „De încărcat”, „Respins” și „Aprobat”, niciodată din „În verificare”. Aprobarea documentelor rămâne la orice membru', admin: 'Da', senior: 'Da*', junior: 'Nu', isNew: true },
  { id: 'p-sterge-faze', section: 'Proiecte', title: 'Șterge faze și activități', note: 'Cu confirmare, ca azi. Cererile de documente din ele nu se pierd', admin: 'Da', senior: 'Da*', junior: 'Nu', isNew: true },
  { id: 'p-adauga-colegi', section: 'Proiecte', title: 'Adaugă colegi în echipa proiectului', admin: 'Da', senior: 'Da*', junior: 'Nu', isNew: true },
  { id: 'p-scoate-colegi', section: 'Proiecte', title: 'Scoate colegi din echipa proiectului', note: 'Seniorul scoate doar juniori. Nu poate scoate alt senior, pe el însuși, consultantul general sau pe cineva cu sarcini asignate', admin: 'Da', senior: 'Da*', junior: 'Nu', isNew: true },
  { id: 'p-chat-sterge', section: 'Proiecte', title: 'Șterge mesajele altora din chatul proiectului', admin: 'Da', senior: 'Da*', junior: 'Nu', isNew: true },
  { id: 'p-chat-editeaza', section: 'Proiecte', title: 'Modifică textul mesajelor scrise de alții în chat', note: 'Fiecare își modifică doar propriile mesaje', admin: 'Da', senior: 'Nu', junior: 'Nu' },
  { id: 'p-reasigneaza', section: 'Proiecte', title: 'Schimbă clientul sau consultantul general', admin: 'Da', senior: 'Nu', junior: 'Nu' },
  { id: 'p-sterge', section: 'Proiecte', title: 'Șterge proiectul', admin: 'Da', senior: 'Nu', junior: 'Nu' },
  { id: 's-vede', section: 'Șabloane de proiect', title: 'Vede șabloanele', admin: 'Da', senior: 'Da', junior: 'Da' },
  { id: 's-ciorne', section: 'Șabloane de proiect', title: 'Creează și modifică ciorne de șablon', admin: 'Da', senior: 'Da', junior: 'Da' },
  { id: 's-publicat', section: 'Șabloane de proiect', title: 'Modifică conținutul unui șablon publicat', note: 'Nume, descriere, faze, activități, documente. Se vede imediat în proiectele noi', admin: 'Da', senior: 'Da', junior: 'Nu', isNew: true },
  { id: 's-duplica', section: 'Șabloane de proiect', title: 'Duplică un șablon', admin: 'Da', senior: 'Da', junior: 'Nu', isNew: true },
  { id: 's-sterge', section: 'Șabloane de proiect', title: 'Șterge un șablon', note: 'Blocat dacă îl folosește vreun proiect', admin: 'Da', senior: 'Da', junior: 'Nu', isNew: true },
  { id: 's-dezactiveaza', section: 'Șabloane de proiect', title: 'Dezactivează un șablon sau îl face implicit', admin: 'Da', senior: 'Nu', junior: 'Nu' },
  { id: 's-publica', section: 'Șabloane de proiect', title: 'Publică un șablon', admin: 'Da', senior: 'Nu', junior: 'Nu' },
  { id: 's-aplica', section: 'Șabloane de proiect', title: 'Aplică modificările șablonului în proiectele existente', note: 'Adminul vede eticheta „Modificări neaplicate în proiecte” când un senior a schimbat ceva', admin: 'Da', senior: 'Nu', junior: 'Nu' },
  { id: 'a-conturi', section: 'Administrarea platformei', title: 'Conturi: creare, roluri, nivel senior/junior, ștergere, parole', admin: 'Da', senior: 'Nu', junior: 'Nu' },
  { id: 'a-statusuri', section: 'Administrarea platformei', title: 'Statusurile de proiect', admin: 'Da', senior: 'Nu', junior: 'Nu' },
  { id: 'a-audit', section: 'Administrarea platformei', title: 'Jurnalul de audit', admin: 'Da', senior: 'Nu', junior: 'Nu' },
  { id: 'a-tablou', section: 'Administrarea platformei', title: 'Tabloul de bord cu toate proiectele', admin: 'Da', senior: 'Nu', junior: 'Nu' },
  { id: 'r-junior', section: 'Reguli generale', title: 'Toți pornesc junior', note: 'La lansare nimeni nu primește drepturi noi', admin: '—', senior: '—', junior: '—' },
  { id: 'r-nivel', section: 'Reguli generale', title: 'Doar adminul schimbă nivelul, din pagina utilizatorului', note: 'Consultantul nu își poate schimba singur nivelul', admin: 'Da', senior: 'Nu', junior: 'Nu' },
  { id: 'r-retrogradare', section: 'Reguli generale', title: 'Retrogradarea are efect imediat, la următoarea acțiune, fără delogare', admin: '—', senior: '—', junior: '—' },
  { id: 'r-audit', section: 'Reguli generale', title: 'Totul rămâne în audit', note: 'Schimbarea nivelului și acțiunile seniorului apar în jurnal sub numele lui', admin: '—', senior: '—', junior: '—' },
  { id: 'x-supervizor', section: 'Reguli adăugate în aplicație', title: 'Un proiect nou cere cel puțin un supervizor senior', note: 'Cerință din discuție, nu din PDF', admin: 'Da', senior: 'Da', junior: 'Da' },
]

export const ROW: Record<string, Row> = Object.fromEntries(ROWS.map(row => [row.id, row]))
