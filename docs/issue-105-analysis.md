# Analiză issue #105 — dezactivarea conturilor fără pierdere de date

Analizat la 5 octombrie 2026, pe checkout-ul `b8d6e41`. Referință: [issue #105](https://github.com/DominteEmanuelBeniamin/platforma-fonduri/issues/105).

Au fost verificate codul, migrările, metadatele schemei live BonieDocs și documentația Supabase. Configurația locală folosește Supabase local; verificarea live nu dovedește că instanța locală are exact aceeași schemă. Interogările live au fost exclusiv SELECT-uri. Nu au fost schimbate codul aplicației, schema sau datele.

Acest document este snapshotul analizei inițiale, înainte de schimbările de produs. Implementarea ulterioară și dovezile de acceptare locală sunt în [planul finalizat](./issue-105-implementation-plan.md#acceptarea-implementării--5-octombrie-2026); raportul fazei 0 este [aici](./issue-105-phase0.md). Rezervarea CIF rămâne dependentă de #110.

## Verdict

Direcția are sens și rezolvă un defect real. Păstrarea profilului și a identității Auth permite conservarea proiectelor, autorilor, conversațiilor și asignărilor, cu reactivare ulterioară. Separarea dezactivării contului de încheierea proiectului este corectă.

Înainte de implementare trebuie completat contractul. Două endpointuri și filtrarea selectoarelor nu acoperă accesul direct Supabase, concurența, toate dependențele contului și impactul asupra importului, duplicării și notificărilor.

Nu este necesară o restructurare generală sau o bibliotecă nouă. Extindem gărzile, helper-ele de notificare, RPC-urile și componentele existente.

## Ce refolosim

| Există deja | Implicație |
| --- | --- |
| `profiles.is_active`, documentat în schemă drept dezactivare | Rămâne starea canonică; `deactivated_at` și `deactivated_by` sunt metadatele tranziției. |
| `requireProfile`, folosit de gărzile pentru admin, proiect și chat privat | Blocarea API-ului se face central. |
| Filtrarea inactivilor în `selectEligibleNotificationRecipients` și SQL `insert_notification_event` | Oprirea notificărilor este deja parțial implementată. |
| Verificarea supervizorilor activi la creare proiect | Refolosim regula pentru relații noi. |
| Formularul „Dosar nou” ignoră consultantul implicit inactiv din șablon | Scenariul există deja, dar nu acoperă formulare rămase deschise și duplicarea. |
| Erori cu `reason` la scoaterea membrilor | Model pentru explicarea refuzului 409 în UI. |
| Audit cu valori vechi/noi și confirmarea prin „sterge” | Păstrăm convențiile existente. |

În live, `is_active` este nullable, iar `deactivated_at` și `deactivated_by` lipsesc. Profilurile au doar indexul cheii primare, fără unicitate CIF. Toate profilurile găsite în această verificare sunt active.

Recomandare: normalizăm valorile legacy NULL conform comportamentului actual, apoi `is_active NOT NULL DEFAULT true`. Dezactivarea setează false și metadatele; reactivarea setează true și golește metadatele dezactivării curente. Istoricul ciclurilor rămâne în audit. Nu păstrăm două criterii independente pentru starea contului.

## Probleme care trebuie rezolvate în #105

### 1. API-ul nu este singura cale către date

[requireProfile](D:/work/platforma-fonduri/app/api/_utils/auth.ts:44) citește profilul la fiecare cerere, dar nu verifică `is_active`. Extinderea lui este locul potrivit pentru blocarea API-ului.

Schema live păstrează acces direct, prin granturi și RLS, la proiecte, faze, activități, echipe, chat privat și Storage. `get_my_role`, `is_admin` și `can_select_project_chat_read` nu verifică starea contului. Politicile de client, membership și chat privat au și ramuri independente de rol: modificarea doar a lui `get_my_role` nu este suficientă.

Un JWT emis anterior poate fi folosit direct împotriva Data API, RPC, Storage și Realtime fără Next.js. Ban-ul nu revocă singur sesiunile existente. [Documentația Supabase](https://supabase.com/docs/guides/auth/managing-user-data#removing-account-access).

De completat: verificarea stării curente în RLS/RPC, revocarea sesiunilor distinctă de ban și teste cu JWT vechi pe aceste suprafețe, inclusiv abonamente Realtime deja deschise. Nu folosim doar o stare din JWT, care poate rămâne veche.

`AuthProvider` închide sesiunea automat la 401. Un simplu 403 păstrează interfața deschisă; trebuie un contract controlat pentru cont dezactivat. Dacă RLS ascunde și propriul profil, absența acestuia trebuie tratată ca acces refuzat, nu ca actualul 500 generic. Coloanele de stare rămân imposibil de modificat direct din browser, păstrând revocarea scrierilor pe profiles.

### 2. URL-urile de fișiere deja emise au propria expirare

Imaginile din chat primesc URL-uri semnate pentru o oră. Uploadurile folosesc `createSignedUploadUrl`: Supabase documentează două ore de valabilitate și utilizare fără autentificare suplimentară. [URL de upload](https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl). URL-urile de download semnate au propria expirare, independentă de cheile Auth. [Servirea fișierelor](https://supabase.com/docs/guides/storage/serving/downloads#signing-urls).

„Refuzat la următoarea cerere” nu poate fi promis automat pentru orice URL semnat anterior. Contractul trebuie să precizeze limita. Finalizarea uploadului trebuie refuzată după dezactivare, chiar dacă obiectul a ajuns în Storage. Dacă se cere și oprirea imediată a downloadului prin URL vechi, trebuie schimbată livrarea fișierelor astfel încât accesul să fie verificat la fiecare cerere.

### 3. Profilul și Supabase Auth nu se modifică într-o singură tranzacție

Două apeluri consecutive în același handler nu sunt atomice. Starea profilului trebuie să controleze accesul la date.

Recomandare: la dezactivare, blocăm în DB și audităm tranziția, apoi sincronizăm ban/revocare Auth. Dacă Auth eșuează, accesul la date rămâne blocat prin aplicație și RLS, iar adminul vede sincronizarea incompletă. La reactivare, anulăm întâi ban-ul, apoi activăm în DB. Reîncercarea finalizează sincronizarea chiar dacă profilul este deja inactiv; nu sare peste un ban eșuat anterior.

Aceste operații necesită control al tranzițiilor concurente pe același cont: dezactivare și reactivare simultane nu trebuie să lase un profil activ cu Auth blocat sau să redeschidă accidental accesul. Folosim verificarea versiunii/tranziției și reîncercări explicite; nu este necesară o infrastructură generală de joburi.

### 4. Ultimul admin trebuie protejat atomic și la retrogradare

Două cereri pot număra simultan doi admini activi și îi pot dezactiva pe amândoi. Verificarea și tranziția trebuie serializate în DB. O gardă comună acoperă dezactivarea, ștergerea și schimbarea rolului prin [PATCH utilizator](D:/work/platforma-fonduri/app/api/users/[userId]/route.ts:95). Revalidăm și că autorul este încă admin activ în tranzacția care scrie.

Aceeași regulă este cerută în [#106](https://github.com/DominteEmanuelBeniamin/platforma-fonduri/issues/106); nu construim două variante. Gărzile împotriva dezactivării/ștergerii proprii rămân pe server.

### 5. Lista de legături care blochează ștergerea este incompletă

[DELETE-ul actual](D:/work/platforma-fonduri/app/api/users/[userId]/route.ts:210) șterge manual proiecte, membri, cereri și fișiere înainte de Auth, continuând după erori intermediare. Contextul defectului din issue este corect.

Inventarul trebuie să includă și următoarele referințe confirmate în live:

| Grup | Referințe |
| --- | --- |
| Proiecte și echipe | Client, consultant general, membri |
| Activități/faze | Persoană asignată, autorul asignării, persoana care a finalizat |
| Cereri/fișiere | Autor, persoană asignată, autorul asignării/ștergerii, uploader, batch-uri de upload |
| Review/atașamente | `document_request_reviews.reviewed_by`, `document_requirement_attachments.created_by` |
| Șabloane | Autorul șablonului, `template_activities.default_consultant_id`, inclusiv structuri inactive |
| Chat | Autorul mesajelor de proiect; creatorul conversației private, participanții, mesajele private și marcajele de citire |
| Notificări/remindere | Destinatar, autorul trimiterii |
| Audit/metadate | `audit_logs.user_id`, viitorul `deactivated_by` și viitoare referințe de încheiere a proiectelor |
| Storage | Proprietatea obiectelor prin `owner`/`owner_id`, în afara inventarului FK public |

Conversațiile și mesajele private au FK-uri cu CASCADE. Consultantul general, consultantul implicit din șablon și unele referințe de finalizare folosesc SET NULL. Aceste FK-uri nu vor opri singure ștergerea greșită: vor elimina date sau atribuire. Guard-ul trebuie să le blocheze explicit.

Rândurile șterse logic sunt date păstrate. Verificarea „fără date” nu filtrează `deleted_at IS NULL`; filtrul are sens numai la numărătoarea muncii curente.

Există o incompatibilitate concretă: `audit_logs.user_id` are SET NULL, iar triggerul append-only refuză orice UPDATE/DELETE. Ștergerea unui autor din audit poate eșua după ștergerea datelor din fluxul actual. Noul flux trebuie să dea 409 înainte de modificări.

Trebuie definită excepția pentru auditul de creare: `logUserAction` stochează autorul în `user_id`, contul vizat în `entity_id`. Un cont creat din greșeală poate fi șters cu păstrarea evenimentelor care îl menționează ca țintă și a snapshoturilor. Dacă orice asemenea mențiune ar bloca ștergerea, niciun cont nou nu ar mai fi „gol”. Conturile care au acționat ele însele în audit rămân blocante.

**RPC de verificare urmat de `auth.admin.deleteUser` nu înseamnă ștergere atomică.** Între apeluri pot apărea legături noi. Garda finală trebuie să participe la tranzacția ștergerii reale: gardă DB pe calea ștergerii Auth sau operație DB internă completă, validată față de comportamentul Supabase și restricțiile Storage. Auditul ștergerii trebuie inclus în mecanismul ales. Funcțiile privilegiate nu se expun către anon/authenticated. Mecanismul trebuie ales și demonstrat local înainte de livrare; formularea „de exemplu RPC” nu rezolvă singură această cerință.

### 6. Un selector filtrat nu garantează validarea noilor relații

Un formular vechi sau o cerere manuală poate trimite ID-ul unui inactiv. Verificăm starea la scriere pentru clientul proiectului, membri, consultant general, asignări activitate/cerere, consultant implicit în șablon, import și duplicare.

Astăzi adăugarea membrului verifică rolul, nu starea; asignarea verifică membership-ul; consultantul general se scrie fără validarea persoanei. Trigger-ele de asignare resping deja unele conturi inactive prin eligibilitatea notificării, dar această eroare SQL nu este un contract de validare. Unele INSERT-uri nu declanșează acele trigger-e, definite pentru UPDATE.

Distincție necesară: păstrarea asignării vechi este permisă; o asignare nouă către un inactiv este refuzată. Editarea titlului nu trebuie blocată pentru că payloadul retrimite aceeași persoană dezactivată.

`GET /api/users` servește atât adminul, cât și selectoarele. Filtrarea globală ar elimina conturile dezactivate și din administrare. Este suficient un filtru explicit pentru listele de alegere, cu controlul de acces corespunzător. Echipa și istoricul păstrează persoanele deja existente. Selectorul afișează inactivul ca valoare curentă marcată, fără să-l ofere pentru alte atribuiri.

### 7. Importul, duplicarea și publicarea au nevoie de reguli

Formularul „Dosar nou” ignoră deja consultantul implicit inactiv. Rămâne însă dezactivarea după încărcarea formularului sau între creare proiect și import. [Importul](D:/work/platforma-fonduri/app/api/projects/[id]/import-template/route.ts:143) refuză tot setul când o asignare nu este validă. [Formularul](D:/work/platforma-fonduri/app/projects/new/page.tsx:292) păstrează proiectul deja creat, cu import nereușit.

Recomandare: implicitul inactiv este omis; o alegere explicită devenită invalidă primește conflict clar și se poate corecta/reîncerca în proiectul existent. Nu recreăm proiectul și nu schimbăm tacit o alegere explicită.

[Duplicarea](D:/work/platforma-fonduri/app/api/_utils/duplicate-project-items.ts:294) copiază persoana asignată în activități și cereri noi. Recomandare: originalul păstrează asignarea; copia pornește neasignată dacă persoana este inactivă, cu informare în rezultat. Această excepție de la copierea atribuirilor trebuie declarată în #105.

Publicarea verifică prezența responsabilului, inclusiv responsabil moștenit din activitate/consultant general. Recomandare: elementele publicate rămân editabile, dar o publicare nouă nu consideră un inactiv responsabil eligibil. Dezactivarea nu este blocată de necesitatea reasignării.

### 8. Destinatarul inactiv este o situație normală, nu o avarie

Filtrarea notificărilor există, însă [Anunță clientul](D:/work/platforma-fonduri/app/api/projects/[id]/notify-client/route.ts:323), [reminderul manual](D:/work/platforma-fonduri/app/api/_utils/document-reminder.ts:230) și cronul tratează lipsa destinatarului eligibil ca eroare. La dezactivare se poate ajunge la 500 și reîncercări inutile.

Oprim trimiterea înainte de claims și de furnizorul de email, cu rezultat controlat „destinatar dezactivat”. Nu marcăm clientul drept anunțat pentru ceva netrimis. Păstrăm notificările vechi și istoricul trimiterilor. Publicarea, review-ul și lucrul echipei active continuă; reminderele persoanelor active din același proiect continuă.

Emailurile de asignare individuale și în batch trebuie filtrate și în [helperul lor](D:/work/platforma-fonduri/app/api/_utils/activity-assignment-email.ts:84), ale cărui interogări nu citesc acum starea profilului.

Un lot citit la începutul cronului poate deveni vechi: se revalidează destinatarul înainte de trimitere și se testează dezactivarea în timpul rulării. Un email deja acceptat de furnizor înaintea dezactivării nu poate fi retras prin schimbarea profilului; această limită trebuie precizată.

### 9. Istoricul, auditul și erorile cer integrare suplimentară

Join-urile pentru autorii mesajelor, persoane asignate, echipă și audit selectează adesea doar nume/email. Transmitem și starea, apoi afișăm sufixul printr-un helper comun. Nu modificăm `full_name` sau descrierile vechi din audit.

Notificările păstrează `actor_name` ca snapshot, fără `actor_id`. Dacă „oriunde în istoric” include actorul notificării, avem nevoie de un identificator pentru evenimentele noi și backfill numai unde identitatea poate fi demonstrată. Nu identificăm persoane prin presupuneri pornind de la nume identice.

[logUserAction](D:/work/platforma-fonduri/app/api/_utils/audit.ts:229) înghite erorile, scriindu-le în consolă. Poate exista succes fără audit. Pentru tranzițiile de stare, modificarea DB și auditul ei trebuie să fie în aceeași tranzacție; eșecul sincronizării Auth se raportează distinct. Convenția existentă `action_type = update`, cu valori vechi/noi și descriere explicită, este suficientă dacă nu se cere filtrare separată.

[AuthProvider](D:/work/platforma-fonduri/app/providers/AuthProvider.tsx:74) înlocuiește `error` cu text generic. Refuzul ștergerii trebuie să conțină `code`/`reason` și blocante structurate cu număr de legături. UI-ul construiește mesajul controlat, după modelul scoaterii membrilor; altfel explicația 409 din issue nu ajunge la admin.

## Scenarii și dependențe de clarificat

| Scenariu | Recomandare |
| --- | --- |
| Reactivare după reasignarea muncii | Reactivează același cont cu relațiile existente atunci; nu restaurează un snapshot care ar lua munca înapoi de la coleg. |
| Singurul senior/supervizor dezactivat | Dezactivarea rămâne permisă; dialogul arată proiectele rămase fără supervizor activ. Adminul păstrează accesul. |
| Consultant general fără activități directe | Dialogul arată și responsabilitățile generale și supervizarea: zero activități nu înseamnă zero impact. |
| Număr de asignări active | Definim stările și folosim lifecycle_status, nu statusul legacy. Separăm activități, cereri, proiecte distincte și supervizare; evităm dublarea muncii cu responsabil moștenit. |
| Chat privat | Păstrăm istoricul pentru celălalt participant, ascundem inactivul din căutare și recomandăm refuzul mesajelor noi către el, cu explicație. |
| Recovery/resetare parolă | Integrare cu [#107](https://github.com/DominteEmanuelBeniamin/platforma-fonduri/issues/107) și [#108](https://github.com/DominteEmanuelBeniamin/platforma-fonduri/issues/108): fără resetare/email pentru inactiv; tokenul vechi nu redeschide accesul la date. |
| Email editat pentru un inactiv | [#106](https://github.com/DominteEmanuelBeniamin/platforma-fonduri/issues/106) cere email la ambele adrese; #105 interzice emailurile. Recomandare: editarea nu le trimite cât timp contul este inactiv, iar adminul vede rezultatul. |
| Unicitate CIF | [#110](https://github.com/DominteEmanuelBeniamin/platforma-fonduri/issues/110) trebuie să includă toți clienții, inclusiv inactivi, cu normalizare și curățare. Un index numai pentru active ar încălca #105. Schema actuală nu garantează criteriul. |
| Rezervare email | Păstrăm identitatea Auth; verificările viitoare de unicitate la editare includ inactivii. |
| Încheiere proiect | Rămâne separat în [#109](https://github.com/DominteEmanuelBeniamin/platforma-fonduri/issues/109); dezactivarea clientului nu încheie și nu ascunde proiectul de echipă. |
| Migrare/deploy | Verificăm și conturile inactive, și ban-urile Auth existente; nu presupunem că orice ban este o decizie de dezactivare a profilului. |

## Ordine recomandată

1. Contractul stării, sensul „fără date”, limitele URL-urilor/emailurilor și regulile copiilor/importului.
2. Metadate și protecții DB: concurență, ultimul admin, audit și gardă pentru ștergerea finală.
3. `requireProfile`, RLS/RPC și sincronizarea Auth; verificare cu tokenul vechi înainte de UI.
4. Validarea noilor relații, importul, duplicarea și publicarea, păstrând relațiile existente.
5. Oprirea emailurilor/reminderelor cu rezultate controlate, fără afectarea echipei active.
6. Dialoguri, filtru admin și etichete istorice. Criteriul CIF se livrează numai după pregătirea dependenței #110.

## Criterii de acceptare de adăugat

1. JWT-ul vechi este refuzat pe API, Data API, RPC, Storage cu JWT și evenimente Realtime noi. Sesiunile revocate cer autentificare nouă după reactivare.
2. Linkurile semnate anterior au limita documentată; finalizarea uploadului început anterior este refuzată după dezactivare.
3. Dezactivarea clientului păstrează integral proiecte, documente, chat și audit; adminul/echipa activă pot lucra.
4. Asignarea veche rămâne și elementul se poate edita; asignarea nouă către un inactiv este refuzată inclusiv prin API direct.
5. Fiecare categorie din inventarul referințelor blochează ștergerea cu 409, inclusiv date șterse logic, chat privat și autoria din audit; nicio referință nu este nulificată/cascadată înainte de refuz.
6. Un cont creat din greșeală, fără activitate proprie și relații, se poate șterge; auditul de creare și ștergere păstrează identificarea.
7. Două dezactivări/retrogradări concurente nu elimină ultimul admin. Apariția unei legături în timpul ștergerii nu pierde date.
8. Eșecul Auth la dezactivare păstrează blocarea datelor, iar retry repară sincronizarea. Eșecul Auth la reactivare nu activează profilul. Tranzițiile concurente nu lasă stări contradictorii.
9. Eșecul auditului nu produce tranziție DB fără audit și nu este raportat ca succes complet.
10. Clientul inactiv nu produce 500 la pregătirea digestului/reminderului și nu este marcat ca anunțat. Notificările și reminderele persoanelor active continuă.
11. Importul cu formular vechi și duplicarea respectă regulile stabilite; retry-ul importului nu creează alt proiect.
12. Dialogul avertizează despre supervizare și consultant general chiar cu zero asignări directe.
13. Reasignările făcute în timpul dezactivării rămân după reactivare.
14. Selectoarele ascund inactivii; valoarea curentă și istoricul îi arată marcați; lista adminului îi poate filtra/reactiva.
15. Parolele, tokenurile, URL-urile semnate și erorile SQL brute nu ajung în audit sau în textele de eroare afișate.

## Verificări și limite

Au trecut **31/31 teste unitare existente**, pentru notification-utils, review-notification, duplicate-project-items, user-error și project-state. Ele verifică mecanismele actuale; nu validează #105, încă neimplementat.

[Matricea E2E](D:/work/platforma-fonduri/tests/e2e/matricea-acces.spec.ts:372) include deja scenarii cunoscute de ștergere parțială, audit și ștergere proprie. Nu a fost rulată în această analiză, deoarece face scrieri/ștergeri. După implementare, aceste cazuri trebuie să ceară comportamentul corect; testele de lifecycle și concurență se rulează pe baza locală izolată.

Schema live a fost verificată prin SELECT-uri pe coloane, indexuri, FK-uri, politici, granturi, funcții, trigger-e și publicația Realtime. Recomandările privind revocarea, concurența și fluxurile noi trebuie demonstrate prin teste de integrare; nu sunt rezultate ale unei dezactivări deja implementate.
