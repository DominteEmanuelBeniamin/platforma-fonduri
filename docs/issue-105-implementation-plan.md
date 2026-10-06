# Plan de implementare — Issue #105

Data inițială: 5 octombrie 2026. Completare de produs: 6 octombrie 2026. Punct de plecare: checkout-ul `b8d6e41`.

Referințe: [issue #105](https://github.com/DominteEmanuelBeniamin/platforma-fonduri/issues/105) și [analiza tehnică](./issue-105-analysis.md). Planul include recomandările acceptate și contractul completat în issue.

Implementăm dezactivarea fără pierdere de date, reactivarea și ștergerea definitivă a conturilor fără relații. Refolosim `profiles.is_active`, gărzile de acces, RPC-urile, destinatarii notificărilor, auditul și dialogurile existente. Nu adăugăm dependențe sau o infrastructură generală de joburi.

## Contractul stabilit

| Situație | Comportament |
| --- | --- |
| Dezactivare | Profil inactiv, fără acces la date; Auth blocat și sesiuni revocate; relațiile și istoricul se păstrează. |
| Reactivare | Aceeași identitate și parolă; rolul și relațiile curente, fără restaurarea asignărilor vechi; autentificare nouă. |
| Asignare existentă | Rămâne afișată și poate fi păstrată când se editează alte câmpuri. |
| Relație nouă către inactiv | Refuzată și pe server, inclusiv la concurență cu dezactivarea. |
| Import | Implicit inactiv omis; alegere explicită devenită invalidă explicată și corectabilă în același proiect. |
| Duplicare | Original intact; copia pornește neasignată pentru responsabili inactivi, cu informare. |
| Publicare | Responsabilul direct/moștenit trebuie să fie activ; elementele deja publicate rămân editabile. |
| Destinatar inactiv | Skip controlat înainte de claims/trimitere; fără 500 și fără marcarea drept anunțat. |
| Ștergere definitivă | Numai fără referințe blocante de business/istoric/Storage; autentificarea singură este exceptată conform regulii de audit de mai jos. Verificare, ștergere și audit în aceeași tranzacție. |
| Audit despre cont | Snapshoturile în care contul este ținta și login/logout proprii se păstrează fără să blocheze, inclusiv când emailul/ținta lipsesc din eveniment; identitatea rămâne în UUID-ul autorului și snapshotul ștergerii. Alte acțiuni proprii în audit blochează ștergerea. |

Dezactivarea nu încheie proiecte și nu reasignează automat munca. Seniorul nu primește drepturi asupra lifecycle-ului conturilor. URL-urile semnate anterior expiră normal; finalizarea unui upload prin aplicație este refuzată după dezactivare. Emailurile a căror predare către furnizor a început înaintea dezactivării pot fi livrate ulterior; cele deja acceptate și informația deja afișată nu pot fi retrase.

Nu mai sunt necesare întrebări de produs. Există două mecanisme care trebuie demonstrate local înainte de implementarea completă: coordonarea cu Auth și ștergerea atomică. Aceste verificări sunt livrabile ale fazei 0, nu decizii lăsate implicit pentru final.

## Faza 0 — Demonstrarea mecanismelor critice

Se folosește numai stackul Supabase local existent. Nu se aplică migrări de produs și nu se scrie în live/staging. Rezultatele și probele reproductibile sunt în [docs/issue-105-phase0.md](issue-105-phase0.md).

1. Verifică read-only compatibilitatea efectivă Auth/Storage, triggerul append-only, FK-urile, grants, views/RPC și publicația Realtime. Schema administrată nu se tratează ca un contract stabil; repetă verificarea pe versiunile țintă.
2. Lifecycle-ul ales după test este SQL service-only, atomic cu auditul. Lockul advisory de tranzacție se ia înaintea lockurilor pe profil/Auth. Tranzițiile opuse se serializează; a doua tranzacție citește starea comisă de prima și aplică intenția sa. Nu există apel Auth Admin API în afara tranzacției, CAS după HTTP, versiuni de operație, worker sau outbox.
3. Dezactivarea scrie profilul inactiv și auditul, aplică un banned_until finit și șterge sesiunile în aceeași tranzacție. Un sub-block cu savepoint izolează eșecul DML Auth: DB rămâne inactivă cu auth_sync_pending pentru retry. Reactivarea șterge din nou toate sesiunile înainte de activare, chiar dacă retry-ul dezactivării nu a salvat un marker de ban aplicat. Ban-urile externe sunt păstrate; auditul tranziției nu se dublează la retry/no-op.
4. Helperul de eligibilitate verifică auth.uid(), claim-ul session_id curent în auth.sessions, profilul activ și ban-ul. JWT-ul de access vechi rămâne refuzat după unban, iar refresh-ul vechi eșuează. auth.admin.signOut din SDK cere JWT, nu user ID; această semnătură nu este folosită ca API pentru coordonarea lifecycle.
5. Hard-delete-ul verifică actorul și blocantele, șterge direct rândul Auth și adaugă auditul în aceeași tranzacție. Verifică explicit autoria audit_logs.user_id chiar dacă FK-ul lipsește. Profilul FOR UPDATE serializează inserările FK; verificarea owner/owner_id Storage folosește un trigger de protecție temporar cu FOR KEY SHARE. Eșecul auditului face rollback la ștergerea Auth. Nu se modifică triggerul append-only și nu se șterg date de business/Storage existente pentru a goli contul.
6. Testul fazei 0 nu demonstrează încă efectul publicației asupra canalelor Realtime active: publicația locală este goală. Faza de migrare trebuie să repare numai cele șase tabele live confirmate și să publice INSERT/UPDATE; testul E2E separat verifică absența DELETE și continuarea INSERT/UPDATE pe canale deschise.

**Livrabil faza 0:** prototip SQL izolat și runner local trecute, cu cod exit 0. Auth/DB/Storage au fost demonstrate pe tagurile locale listate în docs/issue-105-phase0.md; nu se pretinde compatibilitate pe altă versiune doar din această probă. Schema temporară și triggerul Storage au fost curățate, iar testul a păstrat numai userii locali necesari pentru auditul append-only. Faza nu aplică încă nicio migrare de produs.

## Faza 1 — Schema, tranzacții și integritate

Adaugă migrări noi, cu timestamp după ultima migrare aplicată. Nu rescrie baseline-ul.

### Stare și audit

- Normalizează `is_active IS NULL` la true, conform comportamentului actual, apoi `NOT NULL DEFAULT true`.
- Adaugă `deactivated_at timestamptz` și `deactivated_by uuid`, cu FK. Starea activă nu păstrează metadatele dezactivării curente; istoricul ciclurilor rămâne în audit. Inventariază profilurile deja inactive și completează metadatele numai când proveniența este cunoscută.
- Adaugă numai metadatele de coordonare rezultate din faza 0. Nu inventa un framework generic de lifecycle.
- Mută tranziția DB și auditul ei în aceeași funcție/tranzacție. Refolosește structura `audit_logs` și convenția `action_type = update/delete`, cu valori vechi/noi, autor și descriere. Nu te baza pe helperul `logUserAction` care înghite erori.
- Auditul nu conține parole, JWT-uri, refresh tokens, URL-uri semnate sau mesaje SQL brute. Nu se schimbă triggerul append-only pentru a permite ștergerea unui autor.

### Ultimul admin și relații concurente

- Folosește o singură regulă DB pentru dezactivare, ștergere și schimbarea rolului unui admin. Serializează operațiile care pot reduce numărul adminilor activi, de exemplu cu un advisory lock de tranzacție dedicat acestei reguli.
- Revalidează autorul și starea țintei în tranzacție; nu folosi numărul citit anterior în handler/dialog.
- Garda împotriva dezactivării/ștergerii proprii este pe server și în funcția privilegiată.
- Integrează garda și în `PATCH /api/users/[userId]`, înainte de #106, astfel încât endpointul deja existent să nu ocolească protecția.
- Pentru relații noi, verifică starea în tranzacția scrierii, cu blocarea profilului țintă în mod compatibil cu tranzițiile. Păstrarea aceluiași ID nu este o relație nouă.
- Definește o ordine stabilă a lockurilor și testează concurența; un simplu `SELECT count(*)` sau un `SELECT is_active` urmat de alt apel nu este o gardă atomică.

### Ștergere

- Centralizează inventarul blocantelor; aceeași sursă alimentează impactul din dialog și garda finală.
- Include toate categoriile din analiza tehnică: proiecte/echipe, consultant general, asignări/autori/finalizări, cereri/fișiere/batch-uri/review-uri/atașamente, șabloane, chat/participanți/citiri, notificări/remindere, autoria auditului și metadatele de lifecycle.
- Datele șterse logic rămân blocante. Evenimentele în care contul este doar ținta, prin `audit_logs.entity_id`, și snapshoturile despre țintă nu blochează. Din 6 octombrie, sunt exceptate și evenimentele proprii `login`/`logout` cu `entity_type = user` și `entity_id` egal cu autorul sau NULL; emailul poate lipsi din eveniment, fiind păstrat în snapshotul atomic al ștergerii. Referirile explicite la altă țintă/entitate și alte acțiuni ale contului rămân blocante.
- Verifică și Storage `owner`/`owner_id`; nu șterge și nu transfera obiectele pentru a transforma artificial contul într-unul gol.
- Lockul profilului trebuie să împiedice apariția unei referințe FK înainte de ștergerea efectivă. Proprietatea Storage și referințele fără FK au mecanismul verificat în faza 0.
- Adaugă o verificare a inventarului față de catalogul FK: un FK nou relevant, inclusiv `closed_by` din #109 sau actorul notificării, nu poate intra fără actualizarea gardului.
- Ștergerea păstrează snapshotul email/rol/nume și `entity_id` al țintei. Auditul propriu de autentificare își păstrează UUID-ul istoric `user_id`, emailul și toate celelalte câmpuri, fără UPDATE/DELETE. Garda de INSERT validează și blochează profilul autorilor noi; FK-ul legacy `audit_logs_user_id_fkey` cu SET NULL se elimină prin migrarea suplimentară, pentru a nu modifica istoricul. Nu există ștergeri manuale în tabelele de business.

Funcțiile de mutație se acordă numai rolului service, cu `search_path` sigur și obiecte calificate. Revocă explicit EXECUTE pentru PUBLIC/anon/authenticated; păstrează revocarea DML pe `profiles`.

**Gata când:** testele de ultim admin concurent, relație creată concurent, ștergere a contului gol și rollback la audit eșuat trec.

## Faza 2 — Blocarea accesului și sincronizarea Auth

Puncte principale: `app/api/_utils/auth.ts`, `app/api/_utils/supabase.ts`, `app/providers/AuthProvider.tsx`, funcțiile și politicile din migrări.

1. Extinde garda comună: profil activ și sesiune eligibilă. Citește starea curentă la fiecare cerere; nu adăuga cache între cereri.
2. Separă lipsa reală/revocarea profilului de indisponibilitatea DB. Returnează 401 pentru cont inactiv/sesiune invalidă, 5xx controlat pentru eroare de infrastructură.
3. Un helper DB pentru eligibilitatea **apelantului** verifică `auth.uid()`, starea profilului și sesiunea curentă; nu acceptă un ID arbitrar de la browser și nu expune `auth.sessions`. Claims lipsă/invalide sunt refuzate controlat.
4. Refolosește helperul în RLS, funcțiile de acces și Storage. Acoperă ramurile independente de rol: client, membership, participant/chat și notificări. Dacă folosești politici restrictive, acestea se adaugă peste politicile de permisiuni existente, fără extinderea accesului.
5. Evită recursia politicilor pe `profiles`. Propriul profil inactiv poate rămâne citibil strict pentru detectarea blocării, fără acces la date de business; alternativa este verificarea internă în garda serverului.
6. Verifică și RPC-urile SECURITY DEFINER/granturile care pot ocoli politicile. Restrânge sau adaugă garda unde este necesar.
7. La dezactivare, aceeași funcție SQL comite profilul inactiv și auditul după rezultatul sub-blockului Auth. Ban-ul finit și revocarea sesiunilor se execută într-un savepoint; dacă DML Auth eșuează, profilul rămâne inactiv cu auth_sync_pending pentru retry. Eșecul auditului anulează întreaga tranzacție.
8. La reactivare: contul rămâne inactiv în timpul pregătirii Auth; sesiunile vechi sunt eliminate, ban-ul lifecycle este anulat, apoi DB devine activ cu audit. Nu se anulează în masă ban-uri independente existente.
9. Retry-ul repară sincronizarea existentă și nu dublează auditul tranziției. Lockul SQL serializează tranzițiile opuse și a doua tranzacție recitește starea după commit; nu există efect secundar Auth HTTP întârziat care să reaplice o intenție veche.
10. `AuthProvider` păstrează `code/reason/details` pe lângă mesajul sigur. La 401 șterge sesiunea/starea locală și abonamentele, apoi trimite la login.

Nu se presupune că închiderea tabului sau un signOut local revocă sesiunea de pe alte dispozitive. Nu se presupune nici că ban-ul retrage URL-uri semnate anterior.

**Gata când:** același JWT, salvat înainte de dezactivare, nu citește/scrie prin Next API, REST/RPC sau Storage și nu primește evenimente noi pe canalele deja deschise. După reactivare, JWT-ul vechi rămâne refuzat și o autentificare nouă cu parola existentă funcționează.

## Faza 3 — Endpointurile de lifecycle și contractul erorilor

Adaugă rutele `deactivate`, `reactivate`, `lifecycle-impact` lângă ruta existentă. Un helper server mic poate coordona cele două tranziții și maparea erorilor; nu este necesar un serviciu generic pentru administrarea conturilor.

| Endpoint/rezultat | Contract |
| --- | --- |
| GET lifecycle-impact | Număr de activități/cereri, proiecte distincte, responsabilități generale/supervizare și blocante de ștergere, numai admin. |
| POST deactivate/reactivate, reușit | 200 cu starea efectivă și sincronizarea completă; repetarea nu dublează tranziția/auditul. |
| Tranziție opusă în curs | Lockul de tranzacție serializează apelurile SQL; al doilea recitește starea după commit și aplică intenția lui. Nu există un al doilea apel HTTP Auth. |
| Auth indisponibil/sincronizare incompletă | 503 controlat cu cod `AUTH_SYNC_INCOMPLETE`, `is_active: false` și acțiunea de retry. Nu se raportează succes complet. |
| DELETE cu date legate | 409, cod `USER_HAS_RELATED_DATA`, blocante `{ kind, count }` și acțiunea de dezactivare. |
| Gardă cont propriu/ultim admin | 409, motiv stabil pentru UI; verificarea nu se bazează pe ascunderea butonului. |
| Apelant neautorizat | 401/403, înainte de expunerea impactului sau blocantelor. |

Documentează numărătoarea impactului:

- activități nefinalizate conform regulii existente `isActivityDone`;
- cereri neșterse logic, neaprobate și, după #109, neînchise; include `review`, deoarece există încă muncă de verificare;
- drafturile se includ; proiectele active/încheiate se separă prin regula `isProjectActive` din `lib/calendar.ts`, nu prin `projects.status`;
- persoanele responsabile moștenite se rezolvă prin regulile existente, fără dublarea aceleiași cereri/activități;
- proiectele distincte se numără separat de totalul asignărilor; lipsa altui senior activ este avertisment, nu blocaj.

Înlocuiește DELETE-ul existent complet. Nicio ramură de retry/error/cleanup nu revine la cascada manuală.

**Gata când:** API-ul este utilizabil fără UI și toate erorile relevante sunt controlate, cu motive structurate.

## Faza 4 — Relații noi, import, duplicare și publicare

Zone: `app/api/users/route.ts`, `app/api/clients/route.ts`, proiecte/echipe/activități/cereri, `app/api/_utils/template-tree.ts`, `lib/template-tree.ts`, `app/api/_utils/duplicate-project-items.ts`, `lib/publish-rules.js`, `app/projects/new/page.tsx`.

- Introduce filtru explicit pentru listele de alegere, de exemplu `state=active`; administrarea rămâne capabilă să ceară active/inactive/toate. Nu modifica global lista astfel încât adminul să piardă conturile inactive.
- Validează clientul proiectului, membrul nou, consultantul general, responsabilul și implicitul de șablon: rol potrivit, activ și membership unde acesta este cerut.
- Interfața păstrează valoarea curentă inactivă, marcată și indisponibilă pentru o alegere nouă. Backendul permite editarea altor câmpuri când ID-ul asociat nu se schimbă.
- Importul distinge o alegere explicită de implicitul din șablon. Dacă payloadul nu păstrează azi această proveniență, adaugă minimul necesar; absența unei alegeri explicite nu devine un override inventat de client.
- La conflict după crearea proiectului, UI păstrează ID-ul existent, explică ce trebuie corectat și reîncearcă importul în el. Nu repetă crearea.
- Duplicarea verifică starea la scriere pentru INSERT-uri, nu doar pentru UPDATE-uri. Omiterea asignărilor inactive apare în rezultatul existent; nu schimbă originalul și nu face reasignare automată.
- Publicarea verifică responsabilul efectiv activ, fără o restricție nouă de rol pentru asignările istorice. Editarea unui element deja publicat nu retrage automat publicarea.
- Integrează regula și în copierea responsabilului la mutarea cererilor după ștergerea unui părinte.

**Gata când:** un formular deschis înainte de dezactivare și un apel direct nu pot crea relații noi către inactiv; păstrarea relațiilor vechi funcționează.

## Faza 5 — Notificări, emailuri și chat privat

Zone: `app/api/_utils/notifications.ts`, `activity-assignment-email.ts`, `document-reminder.ts`, `reminder-run.ts`, `app/api/projects/[id]/notify-client/route.ts`, `app/api/cron/deadline-reminders/route.ts`, review-ul și SQL `insert_notification_event`; helper-ele/rutele chatului privat.

- Refolosește resolverele de destinatari active existente și extinde interogările de email individual/batch pentru starea profilului.
- Exclude destinatarul inactiv înainte de claims, inserări noi și predarea emailului către furnizor. Revalidează starea după încărcarea unui lot și cât mai aproape de predare.
- La dezactivare în timpul unui lot, skip/release afectează numai claimul încercării curente care poate fi eliberat sigur. Nu șterge notificări vechi și nu pierde claims ale unei trimiteri deja acceptate.
- `notify-client` și reminderul manual/automat primesc un rezultat controlat pentru clientul inactiv. Nu marchează elementele drept anunțate și nu rulează compensații generice ca pentru o avarie a furnizorului.
- Publicarea/review-ul și notificările către destinatarii activi continuă. Păstrează distincția existentă între evenimentele de business deja comise și digesturile cu claims.
- Gărzile SQL de notificare nu trebuie să anuleze un review valid doar pentru că un destinatar este inactiv. O asignare nouă către inactiv este însă refuzată de regula de integritate, nu tolerată prin skip.
- La search/create/send în chatul privat, verifică activitatea partenerului. Citirea istoricului de către participantul activ rămâne permisă.
- Pentru viitoarele #106–#108: editarea emailului unui inactiv nu trimite informări; resetarea adminului este refuzată, iar recovery nu trimite email și nu dezvăluie existența contului. Nu se implementează integral acele issue-uri aici.

**Gata când:** testele cu client inactiv nu produc 500, nu consumă evenimentul ca trimis și nu opresc destinatarii activi din același proiect.

## Faza 6 — Administrare și etichete istorice

Zone: `app/admin/users/page.tsx`, tipurile de profil, afișarea proiectelor/echipei/asignărilor/chatului/auditului/notificărilor și `AuthProvider`.

- Înlocuiește acțiunea principală cu „Dezactivează”; păstrează „Șterge definitiv” ca acțiune separată, cu „sterge”.
- Adaugă badge și filtre active/inactive/toate; lista pornește implicit cu conturile active. Pe contul inactiv apare „Reactivează”. Tranziția în curs/sincronizarea incompletă este afișată cu posibilitatea de retry.
- Dialogul încarcă impactul, arată asignările și responsabilitățile generale/supervizarea și rămâne utilizabil când acestea sunt nenule. Dacă impactul nu se poate încărca, nu pretinde zero; explică lipsa informației și păstrează posibilitatea dezactivării rapide.
- Dialogul de ștergere verifică legăturile înainte de confirmare. Cât timp verifică, când există blocante sau când verificarea eșuează, ascunde confirmarea și acțiunea de ștergere. Un refuz final 409 actualizează același dialog. Contul deja inactiv este indicat explicit și nu primește încă un buton de dezactivare; pentru cel activ, refuzul oferă dezactivarea. Mesajul nu depinde de textul brut `error`.
- Extinde join-urile necesare cu starea profilului și folosește un singur formatter pentru sufix. Nu modifica `full_name`, texte din audit sau snapshoturi.
- Pentru notificările noi, adaugă identificatorul actorului, nullable pentru legacy, și transmiterea lui din producători. Această referință intră și în garda de ștergere. Completează istoria numai unde identitatea este demonstrabilă; numele egal nu este dovadă.
- Verifică desktop/mobil și dialogurile existente, cu tastatură și focus. Nu introduce o componentă nouă dacă dialogul/panoul existent acoperă fluxul.

**Gata când:** adminul poate finaliza toate trei acțiunile, iar istoricul și selectoarele arată starea corectă după reîncărcare și după reactivare.

## Faza 7 — Verificări finale și livrare

Se refolosesc helper-ele E2E din `tests/e2e/helpers/project-state.ts`. Configurația dedicată cere `E2E_WRITES=1` și `E2E_TEST_PROJECT=1`; URL-ul bazei se verifică explicit ca fiind instanța locală de test. Nu se folosește fallback la credențiale live.

Adaugă o suită de integrare, de exemplu `tests/e2e/conturi-lifecycle.spec.ts`, și actualizează cazurile de defect cunoscut din `matricea-acces.spec.ts`. Nu crea o a doua infrastructură de fixtures și nu transforma testele în copii ale implementării.

| Verificare | Dovadă necesară |
| --- | --- |
| API și acces direct | JWT vechi refuzat la REST/RPC/Storage și evenimente noi Realtime pe conexiunea deschisă. |
| Sesiuni și reactivare | Refresh vechi refuzat; token vechi rămâne refuzat; login nou cu aceeași parolă reușește. |
| Păstrare date | Identificatori, număr de rânduri, Storage și relații intacte pentru client/consultant; colegul activ poate continua. |
| Drepturi | Client/junior/senior nu pot face lifecycle; contul propriu și ultimul admin sunt protejate. |
| Concurență admin | Două dezactivări/retrogradări și combinația lor lasă cel puțin un admin activ. |
| Concurență lifecycle | Apeluri SQL opuse și dublu submit sunt serializate; eșecurile Auth rămân inactive/pending și retry-ul nu dublează auditul. |
| Auth/audit indisponibil | Dezactivarea parțială blochează datele; retry repară; audit eșuat produce rollback; reactivarea eșuată păstrează profilul inactiv. |
| Ștergere condiționată | Fiecare categorie de FK/Storage/soft-delete și auditul de business sau despre altă țintă/entitate blochează; contul cu numai login/logout proprii se șterge activ/inactiv, inclusiv cu email/țintă lipsă, cu audit păstrat integral. |
| Ștergere concurentă | Relația/obiectul apărut în timpul operației nu este șters accidental; refuzul nu are efecte parțiale. |
| Relații și UI | Asignare veche păstrată, nouă refuzată; filtre, impact, sufix și confirmări corecte. |
| Import/duplicare/publicare | Formular vechi corectabil în același proiect; copii neasignate cu avertisment; responsabil inactiv refuzat la publicare nouă. |
| Trimiteri | Zero trimiteri noi către inactiv, fără 500/mark notified; destinatarii activi continuă; test cu dezactivare în lot. |
| Chat și upload | Istoric păstrat; mesaj nou către inactiv refuzat; uploadul vechi nu poate fi finalizat în aplicație. |
| Rezervare identitate | Emailul rămâne rezervat; testul CIF se activează după integrarea constrângerii din dependență. |

Comenzi de validare pentru implementare, din PowerShell:

```powershell
npm.cmd run verifica
npm.cmd run audit:check
$env:E2E_ENV_FILE = '.env.e2e.localdb'
npx.cmd playwright test tests/e2e/conturi-lifecycle.spec.ts tests/e2e/matricea-acces.spec.ts
```

Serverul și baza locală sunt pornite separat pe configurația dedicată. Testele de email folosesc providerul/fetch-ul controlat din test, fără trimiteri către destinatari reali. Se rulează și regresiile relevante pentru senior, import/duplicare, upload/review și remindere atunci când fazele le modifică.

Cei 31 de unit tests care au trecut în analiza inițială sunt baseline. Dovada fazei 0 este consemnată în docs/issue-105-phase0.md; acceptarea implementării necesită verificările și testele de mai sus, rulate pe codul și migrarea finale.

### Ordine de rollout și criteriu de închidere

1. Înainte de aplicarea migrărilor/livrării complete, elimină posibilitatea ca handlerul DELETE legacy să mai ruleze cascada manuală. Dacă livrarea este etapizată, prima livrare refuză controlat ștergerea definitivă până există mecanismul sigur.
2. Verifică read-only stările existente, FK-urile, granturile și versiunile pe mediul țintă. Migrările de stare/acces se aplică înaintea codului care le cere; nu presupune că baseline-ul local este identic cu live.
3. Aplică și verifică migrările pe staging/local, apoi livrează backendul și UI-ul împreună cu mecanismul Auth dovedit. Nu introduce o fereastră în care contul pare dezactivat, dar politicile vechi lasă accesul deschis.
4. Fă smoke cu un cont de test și urmărește explicit erorile de sincronizare, audit și claims. Nu dezactiva utilizatori reali pentru verificare.
5. Rollbackul UI/backendului nu trebuie să reinstaleze DELETE-ul destructiv sau să reactiveze implicit conturile deja inactive. Protecțiile DB se păstrează; corecțiile de migrare sunt forward.
6. Integrează rezervarea CIF prin curățarea/normalizarea și constrângerea pentru **toți** clienții din cerința 25/#110, fără index limitat la active. Nu dubla validarea de țară/checksum sau formularul din #110 în acest issue.
7. #105 se închide numai când toate criteriile sale sunt demonstrate. Dacă dependența CIF nu este livrată, criteriul rămâne explicit neîndeplinit; nu declarăm unicitate pe baza unei verificări doar în cod.

## Împărțire recomandată a schimbărilor

Se poate lucra pe un branch `codex/issue-105-account-lifecycle` pornit din checkout-ul curent, fără resetarea modificărilor locale. Fiecare grup păstrează un diff verificabil:

1. **Protecții și acces:** rezultatele fazei 0, eliminarea cascadei legacy, migrări, ultim admin, gardă de ștergere, RLS/sesiuni.
2. **Lifecycle și fluxuri:** endpointuri, Auth/retry, validarea relațiilor, import/duplicare/publicare și trimiteri.
3. **Interfață și regresii:** administrare, sufixe istorice, dovezile E2E și verificarea finală.

Acestea sunt grupuri de implementare pentru aceeași funcționalitate, nu trei lansări obligatorii. Prima acțiune efectivă este faza 0; interfața vine după demonstrarea protecțiilor.

## Acceptarea implementării — 5 octombrie 2026

Implementarea din checkout-ul `feat/safe-user-deletion` a fost realizată de subagenți Luna max și acceptată prin review și teste independente ale orchestratorului. Punctul de plecare rămâne `b8d6e41`; schimbările sunt în workspace.

Migrarea de produs este [20261005103332_issue_105_account_lifecycle.sql](../supabase/migrations/20261005103332_issue_105_account_lifecycle.sql). A fost aplicată în stackul Supabase local existent, într-o tranzacție împreună cu înregistrarea sa în ledger, fără resetarea bazei sau reluarea migrărilor vechi. Cele două corecții găsite la review pentru funcțiile de blocante Storage și publicare au fost aplicate local înaintea testelor finale; numai intrarea acestei migrări încă nelivrate a fost aliniată cu sursa finală. Hashul conținutului din ledger corespunde fișierului, după normalizarea CRLF.

Mecanismul final folosește tranzacții SQL native, un savepoint pentru DML Auth, `auth_sync_pending` și lockul advisory comun. Nu adaugă dependențe, worker, outbox sau versiuni de operație. La publicare se cere responsabil efectiv **activ**; o relație istorică către un responsabil activ care și-a schimbat rolul rămâne validă. Asignările noi păstrează verificările de rol și apartenență. Proprietatea Storage prin `owner_id` este comparată ca UUID valid, inclusiv când textul folosește majuscule; textul legacy invalid nu produce o eroare de cast.

### Verificări executate

| Verificare | Rezultat pe implementarea finală |
| --- | --- |
| `npm.cmd run verifica` | PASS: lint fără erori, TypeScript, 265/265 unit tests, build Next.js. |
| Lint și TypeScript după ajustările finale ale testelor E2E | PASS; aceleași trei avertismente lint existente în baseline. |
| `npm.cmd run audit:check` | PASS după E2E; append-only activ, fără tipuri necunoscute sau imposibil de afișat. |
| `conturi-lifecycle.spec.ts` | 8/8 PASS. |
| `matricea-acces.spec.ts` | 6/6 PASS; 269 puncte, 267 respectate, zero abateri noi și două defecte deja cunoscute. |
| `regresii-senior.spec.ts` | 15/15 PASS. |
| `duplicare.spec.ts` | 4/4 PASS. |
| `sabloane.spec.ts` | 3/3 PASS, inclusiv creare/import/propagare cu 144 de elemente. |
| `git -c core.safecrlf=false diff --check` | PASS. |

Cele **36 de teste E2E distincte** au fost verificate în rulări pe suite, pe același backend și aceeași migrare finale. Suitele de regresie au necesitat numai alinierea unor așteptări vechi: tabul „Faze & Activități”, navigarea efectivă în fază, afișarea valorii istorice inactive și conflictul 409 cu detalii pentru o asignare explicită invalidă. Aserțiile despre păstrarea originalului, fișiere, relații și absența efectelor parțiale au rămas obligatorii.

Cele două defecte cunoscute din matrice rămân separate de #105: citirea unui singur status fără autentificare întoarce 200, iar auto-retrogradarea unui admin temporar întoarce 200, deși PDF-ul o interzice. Garda ultimului admin activ este verificată și funcționează.

Suita lifecycle demonstrează autentificare/refresh reale, JWT vechi refuzat după reactivare, RLS/RPC/Storage, abonament Realtime deja deschis și participant activ care continuă, snapshoturi de date păstrate, chat privat, import corectabil în același proiect, copii și publicare cu responsabili activi/inactivi. Include upload complet și review pozitive, refuzul finalizării de către inactiv, metadate ale actorilor notificărilor, refuz înainte de claims pentru client inactiv, blocante de business/soft-delete/Storage/FK nou, inserare concurentă de FK Auth și autor audit, fault injection Auth/audit cu retry/rollback și trei curse de ultim admin. Dialogul este verificat la 1440 și 390 px, inclusiv tastatură, Escape și revenirea focusului.

### Mediul de test și cleanup

E2E a folosit explicit `.env.e2e.localdb`, Supabase `http://127.0.0.1:54321` și serverul compilat separat `http://127.0.0.1:3175`. Serverul de dezvoltare existent pe 3000 a avut o eroare de handshake HMR; verificarea a folosit buildul validat, fără modificări ale loginului pentru acel defect de mediu. Emailurile au fost capturate numai de mockul Resend local pe 4010, în configurația preview.

Pentru reproducere, pornește mockul într-un terminal separat:

```powershell
node tests/e2e/helpers/resend-mock.mjs 4010 playwright-report/dovezi/issue105-resend.jsonl
```

În alt terminal, după build, pornește serverul de test cu providerul local și adresă de test:

```powershell
$env:RESEND_API_KEY = 're_test_local'
$env:RESEND_BASE_URL = 'http://127.0.0.1:4010'
$env:VERCEL_ENV = 'preview'
$env:REMINDER_EMAIL_OVERRIDE_TO = 'issue105-delivery@example.invalid'
npx.cmd next start --port 3175 --hostname 127.0.0.1
```

În terminalul testelor:

```powershell
$env:E2E_ENV_FILE = '.env.e2e.localdb'
$env:E2E_BASE_URL = 'http://127.0.0.1:3175'
$env:E2E_RESEND_LOG = 'playwright-report/dovezi/issue105-resend.jsonl'
npx.cmd playwright test tests/e2e/conturi-lifecycle.spec.ts tests/e2e/matricea-acces.spec.ts tests/e2e/duplicare.spec.ts tests/e2e/regresii-senior.spec.ts tests/e2e/sabloane.spec.ts
```

Catalogul final confirmă un admin activ, auditul append-only păstrat, zero triggere/funcții temporare `issue105_test_*`, zero tabele temporare cu FK Auth și zero proiecte de import/șabloane/obiecte Storage create de probele lifecycle. Cele 19 profiluri `issue105.*@example.invalid` păstrate pentru autoria de audit sunt inactive, fără sincronizare pending și fără sesiuni. Probele fazei 0 au și ele cleanup consemnat în [raportul separat](./issue-105-phase0.md). Proiectele și șabloanele temporare ale regresiilor au fost curățate.

Publicația locală `supabase_realtime` conține cele șase tabele folosite de aplicație și permite INSERT/UPDATE; DELETE/TRUNCATE sunt dezactivate pentru a nu ocoli RLS pe abonamente. Limitele URL-urilor semnate deja emise, datelor deja descărcate și emailurilor deja predate furnizorului rămân cele din contract.

### Stare de livrare și dependență

Dovada privește implementarea și stackul **local**. Aplicarea pe un alt mediu cere preflight-ul de catalog și smoke-ul din ordinea de rollout de mai sus. Driftul vechi al ledgerului local și diferența FK audit local/live nu au fost reparate prin presupuneri.

Rezervarea emailului este demonstrată. Rezervarea CIF prin normalizare și constrângere pentru toți clienții rămâne **neîndeplinită**, dependentă de **#110 / cerința 25**. #105 rămâne deschis până când această integrare este livrată și verificată.

## Completare — conturi create din greșeală, 6 octombrie 2026

Decizie acceptată: crearea, modificările administrative și dezactivarea/reactivarea înregistrate de admin despre contul țintă nu îl blochează. Nici login/logout proprii identificabile nu îl blochează. Proiectele, asignările, mesajele, fișierele, Storage și orice altă acțiune proprie în audit, inclusiv acțiunile administrative asupra altor conturi, continuă să blocheze. Contul propriu și ultimul admin activ păstrează protecțiile existente. Un cont eligibil poate fi șters indiferent de starea activ/dezactivat; nu se cere reactivarea lui.

Motivul: o autentificare de verificare nu trebuie să facă imposibilă curățarea unui cont creat accidental. Păstrăm dovada autentificării și identificarea istorică, în timp ce activitatea de business și relațiile rămân protejate.

Migrarea incrementală este `20261006073752_issue_105_auth_audit_deletion.sql`, generată cu CLI și aplicată numai în stackul local, cu ledgerul exact în aceeași tranzacție. Migrarea din 5 octombrie nu este rescrisă. Același `user_account_blockers` deservește verificarea din dialog și ștergerea finală. UUID-ul istoric din audit nu este nulificat; triggerul append-only și garda autorilor noi rămân active. Interfața auditului și exportul CSV folosesc emailul din eveniment pentru autorul unui login/logout al cărui profil a fost șters, fără a atribui autorului emailul altei ținte.

Validare inițială din 6 octombrie, înaintea corecției de mai jos:

- **2/2 E2E lifecycle selectate:** conturi active/inactive cu login/logout, audit identic înainte/după ștergere, profil și Auth eliminate, istoric citibil; acțiune de business și auth audit incomplet refuzate; date șterse logic, Storage, FK nou și inserarea concurentă de FK/autor audit protejate.
- **1/1 E2E UI:** filtrul Active implicit, verificarea înainte de confirmare, cont deja dezactivat și 409 concurent, desktop/mobil, email istoric afișat și exportat în CSV.
- **266/266 unitare**, TypeScript, lint pe fișierele schimbate, `audit:check` și `git diff --check`: PASS. Diagnosticele de securitate au aceleași 11 avertismente legacy, fără unele noi.
- Migrarea a fost verificată cu rollback și pe varianta FK SET NULL din baseline. Catalogul final păstrează toate cele trei triggere audit; nu rămân tabele temporare cu FK Auth. Contul din captura utilizatorului a fost doar verificat, fără ștergere.

Comenzile E2E folosesc `E2E_ENV_FILE=.env.e2e.localdb` și `E2E_BASE_URL=http://localhost:3000`:

```powershell
node node_modules/@playwright/test/cli.js test tests/e2e/conturi-lifecycle.spec.ts --project=chromium --grep 'authentication audit|hard delete'
node node_modules/@playwright/test/cli.js test tests/e2e/conturi-ui.spec.ts --project=chromium
```

Decizia este consemnată și în issue #105. Branchul nu are un PR asociat la data verificării; acest plan păstrează decizia pentru descrierea viitorului PR. Dependența CIF #110 și starea deschisă a issue-ului rămân cele din acceptarea inițială.

### Corecție — autentificare cu email sau țintă lipsă, 6 octombrie 2026

Condiția inițială care cerea email nevid în fiecare eveniment de login/logout era mai strictă decât decizia acceptată și bloca un cont temporar fără alte legături. Identitatea este deja garantată prin `audit_logs.user_id` păstrat și snapshotul complet adăugat atomic la ștergere.

Regula finală permite login/logout cu `entity_type = user`, al căror `entity_id` este autorul sau NULL, chiar dacă `entity_name` este NULL, gol sau conține numai spații. O referire explicită la altă țintă sau alt tip de entitate rămâne blocantă, la fel ca activitatea și referințele de business.

Migrarea corectivă `20261006080652_issue_105_auth_audit_snapshot_fallback.sql` este aplicată numai local, cu ledger corespunzător fișierului. Nu rescrie migrările anterioare. API-ul audit recuperează emailul lipsă pentru autorul șters din `old_values` al evenimentului de ștergere: UUID-ul snapshotului trebuie să coincidă cu ținta acelui eveniment și cu autorul login/logout. Emailul salvat direct în eveniment are prioritate. Aceeași identificare este folosită în UI și CSV, fără modificarea auditului original și fără asociere după nume/email.

Verificări după corecție: **3/3 E2E** (2 lifecycle și 1 UI/CSV), **9/9 unitare de audit**, TypeScript și lint pe fișierele schimbate: PASS. Sunt verificate email NULL/gol/spații și țintă NULL, audit identic înainte/după ștergere, snapshot recuperat prin API, refuz pentru altă țintă/entitate și business, plus protecțiile la concurență. Contul indicat de utilizator este încă dezactivat, are zero blocante, iar evenimentul său `logout` a rămas cu email NULL; nu a fost șters automat.
