# Issue #110 — plan de implementare

Data: 22 octombrie 2026. Bază verificată: commit 1e05f67, branch feat/sabloane-compacte.

Acesta este planul de lucru. Faza 0 a trecut local pe 22 octombrie 2026: 19/19 verificări, pe Auth v2.197.0 și PostgreSQL 17.6, conform [raportului](issue-110-phase0-results.json). Faza 1 este implementată local: modulul CIF pentru cele 27 de țări și 49/49 teste dedicate trecute. Faza 2 are migrarea pregătită și 38/38 verificări trecute pe o bază izolată, conform [raportului](issue-110-phase2-results.json). Faza 3 integrează POST/PATCH și are 54/54 verificări izolate trecute, conform [raportului](issue-110-phase3-results.json), plus 423/423 teste unitare. Faza 4 integrează controlul țară/număr și starea pending în UI, cu 26/26 probe desktop/telefon trecute, conform [raportului](issue-110-phase4-results.json). Faza 5 este implementată: fixture adaptate, 427/427 teste unitare, verificarea globală completă trecută și 122/122 cazuri Playwright din 10 suite, conform [raportului final](issue-110-phase5-acceptance-results.json). Migrarea nu este aplicată pe baza locală sursă sau hosted. Urmează recepția manuală descrisă în [instrucțiunile de rollout](issue-110-rollout.md), apoi pregătirea datelor reale și activarea coordonată. Limita TypeScript raportată istoric în secțiunile 5–8 este rezolvată în faza 5 prin excluderea artefactelor generate.

## 1. Rezultatul și deciziile acceptate

- România: CUI obligatoriu, 2–10 cifre după normalizare și cifră de control validă, pentru firme plătitoare sau neplătitoare de TVA. Prefixul intern RO nu atestă statutul TVA.
- Celelalte 26 de țări UE: identificator TVA cu format valid pentru țara respectivă, fără verificarea cifrei de control sau VIES. Firmele UE fără identificator TVA și țările din afara UE au ticket separat.
- Formularul are țară și număr. În bază rămâne un singur profiles.cif canonic; nu adăugăm coloane pentru țară sau număr.
- CIF-ul completat este unic pe toate profilurile, inclusiv inactive și profiluri care au trecut ulterior de la client la alt rol. Un CIF istoric rămâne ascuns și rezervat la consultant/admin.
- CIF-ul poate fi corectat numai de admin. Dezactivarea și schimbarea rolului nu îl eliberează; corectarea explicită a valorii sau ștergerea definitivă eligibilă a contului îl eliberează.
- La trecerea către client se cere un CIF valid. La ieșirea din rolul client valoarea existentă se păstrează. Aceste reguli nu înlocuiesc blocantele de schimbare a rolului din #106.
- Crearea refuzată pentru CIF invalid sau duplicat nu trebuie să lase un cont utilizabil. Emailul cu parola pleacă după confirmarea profilului și activării.
- Păstrăm generarea parolei, marcajul temporar, override-ul de email și fallback-ul la eșecul Resend din #103.
- Un checksum corect sau un format străin corect nu dovedește existența firmei. Fără ANAF, VIES, câmp TVA, completare automată sau bibliotecă nouă.

## 2. Situația de pornire și dependențele

Verificarea read-only a bazei conectate BonieDocs a găsit 5 clienți, dintre care unul inactiv, 4 CIF-uri fără prefix care necesită normalizare, un CUI cu checksum invalid și un profil care nu e client dar are CIF. Nu au apărut duplicate după normalizarea simplă. Acesta este un instantaneu, nu înlocuiește preflight-ul de lansare.

profiles.cif este nullable și nu are index unic. POST /api/users creează Auth, apoi face UPDATE de profil; un eșec la al doilea pas lasă contul creat. Triggerul handle_new_user inserează inițial rolul client, fără CIF. PATCH folosește update_user_profile_guarded, care permite încă modificarea CIF-ului propriu.

- Cerința 25: corectarea manuală a datelor greșite și rezolvarea duplicatelor preced activarea constrângerilor. Migrarea indexului este livrată în #110, nu presupusă ca existentă.
- #105: refolosim starea activă, blocarea comună a mutațiilor contului și ștergerea protejată a conturilor goale. Păstrăm protecția ultimului admin și accesul RLS.
- #107: conturile incomplet create trebuie excluse din recovery, loginul aplicației și reactivare necontrolată. Păstrăm invalidarea și ordinea de blocare existente.
- #106: primește modulul și componenta comune pentru editor; după #110 nu mai poate salva CIF liber sau permite modificarea lui de către client.
- #111: reorganizează formularul folosind același control CIF. Numele firmei, adresa și persoana de contact nu sunt reorganizate aici.

## 3. Contractul CIF și erorile

### Reprezentare și API

POST și PATCH păstrează câmpul cif de tip string și acceptă suplimentar cifCountry, cod ISO al țării selectate. Interfața trimite ambele câmpuri. cifCountry este context de validare, nu o coloană nouă.

Exemplu: cifCountry = RO, cif = ro 5258486 produce RO5258486.

Pentru compatibilitate cu apelurile existente, dacă cifCountry lipsește, prefixul recunoscut determină țara; un număr simplu este tratat ca România. EL și GR se citesc ca Grecia și se salvează întotdeauna cu EL. cifCountry singur într-un PATCH este invalid.

Cu țară explicită, numărul care respectă formatul țării selectate are prioritate față de interpretarea primelor litere ca prefix. Pentru FR, DE123456789 și FR123456789 sunt numere valide ca format și se salvează ca FRDE123456789, respectiv FRFR123456789. Numai dacă valoarea întreagă nu corespunde formatului numărului țării selectate interpretăm un prefix fiscal; un prefix al altei țări produce CIF_COUNTRY_MISMATCH. Nu schimbăm automat țara selectată.

În PATCH, prezența cheii cif sau cifCountry la un non-admin produce 403 inclusiv pentru null, șir gol sau valoare neschimbată. Pentru admin, null/gol la un client produce CIF_REQUIRED. CIF-ul explicit se editează pentru rolul final client; schimbarea către alt rol păstrează intern CIF-ul vechi, fără un câmp de firmă în formularul noului rol.

### Normalizare și validare

- Trim, uppercase și eliminarea spațiilor și punctelor. Cu țară explicită verificăm întâi formatul numărului întreg; dacă nu corespunde, eliminăm cel mult un prefix fiscal al țării selectate, inclusiv aliasul GR pentru Grecia, și validăm restul. Nu eliminăm litere care aparțin numărului.
- La RO se elimină zerourile inițiale, se respinge zero și se validează lungimea rezultatului și checksum-ul cu cheia 753217532, aliniată la dreapta; restul 10 devine cifra 0.
- În alte țări zerourile și literele semnificative se păstrează. Nu eliminăm arbitrar caractere speciale: variantele istorice IE se verifică după regula lor, inclusiv caracterele permise în poziția specială.
- Catalogul conține țara ISO, prefixul fiscal, eticheta, regula exactă și un exemplu. România prima, restul în ordinea alfabetică a etichetelor românești.
- AT, NL, SE, IE, ES, FR și GR/EL au teste explicite pentru pozițiile caracterelor și variante, pe lângă câte un caz valid și invalid pentru fiecare țară. Pentru FR testăm numerele DE123456789 și FR123456789, variantele lor cu prefix FR și idempotenta valorilor canonice rezultate; cazul RO + DE123456789 rămâne eroare de țară.
- parseCif desparte valoarea salvată în țară și număr fără pierderi, eliminând numai prefixul fiscal exterior: FRFR123456789 devine țară FR și număr FR123456789. O valoare legacy nerecunoscută produce o eroare explicită, nu revenire silențioasă la RO.

### Răspunsuri controlate

| HTTP | Cod | Comportament |
| --- | --- | --- |
| 400 | CIF_REQUIRED | Cere completarea CIF-ului pentru client. |
| 400 | CIF_INVALID | RO: „CUI-ul nu e valid. Verifică cifrele.”; pentru UE indică formatul cerut. |
| 400 | CIF_COUNTRY_MISMATCH | Cere alinierea prefixului cu țara selectată. |
| 400 | CIF_COUNTRY_UNSUPPORTED | Explică limita UE a versiunii. |
| 403 | CIF_FORBIDDEN | Modificarea CIF-ului necesită admin. |
| 409 | CIF_DUPLICATE | „Firma are deja un cont. Nu poți folosi același CIF.” |
| 409 | ACCOUNT_CREATION_PENDING | Cont incomplet: editarea și reactivarea obișnuită sunt refuzate. |
| 409 | ACCOUNT_CREATION_INACTIVE | Finalizat, apoi dezactivat; nu trimitem date de acces și nu reactivăm. |
| 500 | ACCOUNT_CREATION_FAILED | Finalizarea a eșuat; nu trimitem date de acces. |
| 500 | ACCOUNT_CREATION_PENDING | Compensarea a eșuat; contul nou rămâne incomplet și blocat, cu remediere în lista de utilizatori. |
| 503 | ACCOUNT_CREATION_UNCONFIRMED | Rezultat neconfirmat; verificare în listă înainte de retry, fără email sau parolă în răspuns. |
| 503 | ACCOUNT_DATA_UNAVAILABLE | Verificarea anticipată a datelor/schema nu este disponibilă; nu creăm Auth. |

Erorile includ code, message și, pentru formular, field = cif sau cifCountry. Folosim convenția message/serverMessage existentă, deoarece apiFetch rescrie error. Nu întoarcem UUID-ul, emailul, starea sau numele titularului CIF-ului duplicat.

## 4. Faza 0 — probă locală a creării protejate

Mediul Docker disponibil folosește Auth v2.197.0. Sursa acestei versiuni arată că adminUserCreate inserează mai întâi utilizatorul și aplică ulterior app_metadata și ban_duration, în aceeași tranzacție Auth. Un trigger de INSERT nu poate presupune că vede metadatele administrative. Planul folosește fluxul explicit de mai jos, fără roluri citite din user_metadata.

Proba se execută pe stack local dedicat, cu verificarea hostului și configurație E2E explicită. Nu folosește baza hosted și nu trimite emailuri reale.

### Mecanismul ales pentru probă

1. Adăugăm un singur marcaj profiles.creation_pending, boolean, implicit false pentru rândurile existente.
2. handle_new_user creează orice profil nou cu creation_pending = true și is_active = false. Rolul inițial rămâne client; CIF-ul temporar poate fi NULL numai cât timp marcajul este true.
3. POST creează Auth cu o parolă aleatorie și ban_duration lung, pe modelul existent din #105. Ban-ul este aplicat înainte de commit-ul Auth, iar profilul inactiv asigură și blocarea accesului aplicației.
4. O funcție DB dedicată finalizării primește UUID-ul nou, autorul verificat, profilul validat și timestampul ban-ului inițial întors de Auth. Pentru Auth v2.197.0, trunchiem fracțiunea timestampului la 6 zecimale înainte de trimiterea spre SQL, conform preciziei persistate; conversia prin Date pierde microsecunde, iar un cast SQL direct al nanosecundelor poate rotunji diferit. Sub blocare verificăm egalitatea exactă a ban-ului curent cu cel inițial, fără toleranțe de timp; un ban schimbat refuză finalizarea. Funcția revalidează adminul activ, existența și marcajul țintei, apoi salvează profilul final, rolul, CIF-ul și marcajul parolei temporare, elimină ban-ul inițial și setează creation_pending = false / is_active = true într-o singură tranzacție.
5. Finalizarea folosește ordinea de blocare comună #105/#107. Nu reactivează un cont existent sau unul dezactivat. Funcția este accesibilă numai service_role și verifică autorul în DB.
6. Dezactivarea/reactivarea obișnuită și PATCH refuză țintele creation_pending. În lista adminului ele apar ca „Creare incompletă”, cu opțiunea existentă de ștergere protejată, fără buton de reactivare.
7. Dacă finalizarea eșuează cert, se încearcă delete_empty_user_account numai pentru UUID-ul creat în cererea curentă, revalidând că e încă pending și fără date. Nicio ștergere după CIF/email și nicio forțare a blocantelor.
8. Dacă anularea eșuează sau procesul se întrerupe, contul rămâne blocat și vizibil pentru remediere. Nu adăugăm cron, coadă sau reactivare automată. Emailul și parola nu sunt predate înainte de finalizare.

creation_pending este necesar pentru a distinge un cont nefinalizat de un cont dezactivat valid. Nu reutilizăm auth_sync_pending, care are deja semantica sincronizării lifecycle.

### Probe care trebuie să treacă

- La pauza dintre Auth și finalizare: login prin parolă refuzat, API și datele de business prin REST/RPC fără acces, recovery omis și reactivare administrativă refuzată. Păstrăm excepția RLS din #105 care permite citirea propriului profil inactiv, necesară identificării stării contului; nu oferă acces la alte profiluri sau drept de scriere.
- Client, consultant și admin se finalizează corect; un CIF obligatoriu pentru client nu blochează crearea celorlalte roluri.
- Două creări cu același CIF, dar emailuri diferite: exact un cont finalizat; celălalt primește conflict și este anulat sau rămâne blocat cu rezultat explicit de remediere.
- Eșec forțat înainte de finalizare, la indexul unic, la scoaterea ban-ului și la ștergerea compensatorie: fără cont incomplet utilizabil și fără email.
- Timeout la finalizare poate însemna commit reușit. Reconcilierea citește UUID-ul creat; nu șterge și nu refinalizează un cont deja finalizat. Dacă starea nu poate fi confirmată, nu declară eșec cert sau succes și nu trimite parola.
- Finalizare concurentă cu ștergerea, cu pierderea dreptului adminului sau cu un retry: fără activare a altui cont și fără eliminarea unui ban ulterior.
- user_metadata.role/cif/is_active nu oferă drepturi și nu poate finaliza contul.

Livrabil: un script mic cu aserțiuni, strict local, și un raport al rezultatelor. Dacă mecanismul nu trece aceste probe, se revizuiește secțiunea de creare înainte de implementarea fluxului final; nu se declară atomic un lanț de apeluri HTTP.

Proba executată este în scripts/issue-110-phase0.mjs, cu prototipul SQL separat în scripts/issue-110-phase0.sql. Folosește o bază temporară fără conturile existente și containere Auth/REST separate, eliminate la final. Funcțiile prototipului rulează cu owner postgres; rolul administrativ local este folosit numai pentru pregătirea copiei schemei și a metadatelor native Auth. Garda API reală este încărcată din surse prin transpilare. Raportul confirmă păstrarea numărului de conturi/profiluri din baza sursă, fără scrieri hosted sau emailuri reale. Validarea completă CIF, rutele POST/PATCH finale, UI-ul și compatibilitatea hosted se recepționează în fazele următoare; prototipul nu este o migrare de lansare.

## 5. Faza 1 — modulul comun

Fișiere principale: lib/cif.ts și lib/cif.test.mjs.

- Implementăm catalogul UE, normalizeCif, validateCif și parseCif; fără I/O, dependențe sau apeluri online.
- Același modul va fi importat în formular și în cele două rute API în fazele 3–4.
- Testăm idempotenta normalizării, prefixele repetate/contradictorii, tipurile greșite la intrarea API, RO cu checksum greșit, limitele de lungime, zero și zerouri inițiale.
- Folosim exemple valide verificate. RO12345678 rămâne doar caz negativ; exemplele pozitive pot include RO5258486 și RO4221306.
- Datele de integrare primesc CIF-uri sintetice valide și distincte. Nu folosim un singur CIF real pentru toate conturile de test.

Rezultat: contractul pur și toate cele 27 de formate sunt testate înainte de conectarea la DB.

### Rezultate faza 1 — 22 octombrie 2026

- Implementate [lib/cif.ts](../lib/cif.ts) și [lib/cif.test.mjs](../lib/cif.test.mjs), fără importuri, I/O sau dependențe noi în modul.
- Catalogul exportat CIF_COUNTRIES include codul ISO, prefixul fiscal, eticheta românească, expresia de format, explicația și exemplul. Grecia folosește codul ISO GR și prefixul canonic EL; intrarea EL este acceptată ca alias.
- normalizeCif(cif, cifCountry?) verifică tipurile, țara și forma, apoi întoarce țara, numărul și CIF-ul canonic. validateCif are același contract și verifică suplimentar checksum-ul RO. parseCif(cif) validează valoarea salvată și refuză valorile legacy fără prefix recunoscut. Succesul are forma { ok: true, country, number, cif }; eroarea are forma { ok: false, code, message, field }.
- 49/49 teste dedicate trecute: caz valid/invalid pentru fiecare țară, idempotentă, prefixe, cheile FR care seamănă cu prefixe, aliasul GR/EL, variantele IE cu +/*, pozițiile AT/NL/SE/ES, checksum și limite RO, zerouri semnificative, tipuri API greșite și valori legacy.
- npm test: 399/399 teste trecute. npm run lint: 0 erori, 3 avertismente existente în fișiere nemodificate.
- Verificarea TypeScript strictă a modulului trece: npx.cmd tsc --noEmit --skipLibCheck --target ES2017 --lib dom,dom.iterable,esnext --module esnext --moduleResolution bundler --strict lib/cif.ts.
- Verificarea globală npx.cmd tsc --noEmit rămâne blocată de 9 importuri lipsă în copii vechi de teste din playwright-report/verificare-pr123-pr124/spec-uri/. Aceste artefacte ignorate de Git sunt incluse de tsconfig.json. Înainte de acest rezultat au fost regenerate tipurile Next, după eliminarea a două fișiere cache corupte din .next/dev/types; nu s-au modificat sursele sau configurația proiectului pentru a ascunde erorile.

Comanda suitei dedicate: node --experimental-strip-types --test lib/cif.test.mjs. Nu s-au conectat încă apelanții API/UI, nu s-au schimbat fixturele de integrare sau migrarea și nu s-a accesat baza hosted. Exemplele străine demonstrează formatul, nu înregistrarea TVA sau existența firmei. Formatele au fost confruntate cu sursele fiscale de mai jos; excluderea literelor I și O din cheia FR este documentată de HMRC.

## 6. Faza 2 — schema și mutațiile DB

Construim migrarea după proba locală. Generăm numele prin Supabase CLI, după verificarea comenzilor cu --help; nu edităm migrările istorice.

- creation_pending, inițial false pentru conturile existente; CHECK impune ca un pending să fie inactiv.
- Regula obligatorie este condiționată de finalizare: orice client cu creation_pending = false are CIF nenul și nevid, inclusiv dacă este dezactivat. Fără NOT NULL global pe cif.
- Un helper SQL mic normalizează identitatea CIF pentru toate scrierile: prefix, case, spații/puncte și zerourile RO. Păstrează caracterele semnificative ale identificatorilor străini, inclusiv cheia FR care seamănă cu un prefix; valorile canonice FRDE123456789 și FRFR123456789 rămân neschimbate. Valorile nenule se stochează canonic.
- Index unic pe profiles.cif pentru toate valorile nenule, fără filtru pe rol sau is_active. Numim indexul explicit, pentru a distinge încălcarea sa de alte erori 23505.
- Validarea completă RO/UE rămâne în modulul TypeScript, la granița API. Nu duplicăm întregul catalog de formate și checksum în SQL; verificăm separat paritatea normalizatorului SQL cu cel comun.
- Actualizăm handle_new_user, funcția de finalizare și update_user_profile_guarded. Ultima verifică dreptul adminului la CIF și rolul final sub blocare, păstrând CIF-ul la ieșirea din rolul client. Returnează și valorile anterioare ale câmpurilor modificate, citite sub aceeași blocare, pentru auditul din API.
- Extindem lifecycle numai pentru refuzul reactivării/modificării unui pending și pentru anularea protejată, condiționată de marcaj, a contului proaspăt creat.
- Păstrăm revocările de scriere directă pentru anon/authenticated. RPC-urile noi au search_path fix, privilegii minime și verificare de autor.
- Actualizăm tipurile de profil în lib/database.types.ts, types/database.ts și consumatorii care au nevoie de noul marcaj.

Preflight-ul migrării refuză date lipsă, invalide/necanonice sau coliziuni rămase; nu inventează corecții și nu șterge/unește conturi. Aplicarea normalizărilor aprobate și indexarea se fac în aceeași fereastră controlată, cu revalidare sub blocare, fără gol între verificare și constrângere.

### Rezultate faza 2 — 22 octombrie 2026

- Migrarea [20261022112933_issue_110_cif_account_creation.sql](../supabase/migrations/20261022112933_issue_110_cif_account_creation.sql) a fost creată cu Supabase CLI 2.118.0, după verificarea comenzilor prin --help, și executată prin SQL numai în copia temporară a schemei locale. Nu s-au editat migrări istorice, nu s-a modificat istoricul bazei sursă și nu s-a rulat db push/pull/reset.
- Sunt implementate creation_pending, constrângerile și indexul profiles_cif_unique; normalizatorul privat account_creation.normalize_cif și triggerul pentru toate scrierile CIF; inițializarea Auth inactivă; finalizarea și compensarea; protecția lifecycle pentru pending; editarea CIF numai de admin, cu păstrarea istoricului la schimbarea rolului. Tipul Profile din ambele fișiere include noul marcaj.
- finalize_new_user_account primește p_target_id, p_actor_id, p_expected_ban, p_role, p_cif și opțional p_profile. Ultimul acceptă numai full_name, telefon, nume_firma, adresa_firma, persoana_contact, departament, specializare și consultant_level, cu tipurile verificate. Controalele de acces, marcajele de stare și parola temporară nu provin din metadata sau din acest obiect. cancel_new_user_account primește numai ținta pending și autorul și reutilizează ștergerea protejată #105.
- update_user_profile_guarded păstrează contractul profile/changed și adaugă oldValues/newValues numai pentru câmpurile efectiv schimbate, citite sub aceeași blocare. Un no-op normalizat nu schimbă updated_at și întoarce obiecte de audit goale. Testul concurent pe aceeași țintă confirmă A→B și B→C.
- [lib/cif-preflight.ts](../lib/cif-preflight.ts) validează toate profilurile prin modulul comun, întoarce numai totaluri și nu corectează datele. Migrarea cere amprenta instantaneului verificat în parametrul SQL de sesiune app.issue110_cif_preflight, apoi o compară după blocarea comună și blocarea tabelului; o schimbare între inventar și aplicare refuză migrarea. Verificările canonice și indexarea sunt în aceeași tranzacție. Testele confirmă și rollback-ul întregii migrări dacă preflight-ul lipsește sau eșuează.
- [Probele fazei 2](../scripts/issue-110-phase2-checks.mjs) reutilizează infrastructura izolată din faza 0. Au trecut 38/38 verificări: probele Auth existente pe funcțiile finale, paritatea normalizării pentru 27 de țări, finalizarea tuturor formatelor, tipurile profilului, privilegii, CIF rezervat la inactiv/alt rol, hard-delete eligibil, creare/editare și editare/editare concurente, revalidarea autorului/rolului și auditul tranzacțional. SQL lint: 0 erori. Advisorii: 103 avertismente existente în inventarul de dinaintea migrării, 0 probleme introduse după migrare.
- npm test: 402/402 teste trecute, inclusiv 3 teste noi de preflight. npm run lint: 0 erori și cele 3 avertismente existente. Verificarea TypeScript strictă a modulelor CIF/preflight și a ambelor fișiere de tipuri trece; verificarea globală păstrează cele 9 importuri lipsă din rapoartele Playwright vechi, descrise în faza 1.
- Baza temporară, containerele Auth/REST și directorul temporar al rulării au fost eliminate; numărul conturilor/profilurilor din baza sursă a fost verificat ca neschimbat. S-a completat și curățarea directorului de fișiere transpiliate din infrastructura fazei 0.

Comanda de reproducere: node --experimental-strip-types scripts/issue-110-phase0.mjs --phase2, cu configurația locală dedicată .env.e2e.localdb. Raportul nu conține CIF-uri, conturi reale sau date de conectare.

Migrarea rămâne neaplicată pe baza sursă; migration list --local o arată ca fișier local fără versiune aplicată. Un db push obișnuit nu îndeplinește preflight-ul și este refuzat intenționat. În faza de rollout, instrumentul de aplicare trebuie să valideze instantaneul cu inspectCifProfiles, să transmită amprenta calculată din exact aceleași rânduri în aceeași sesiune SQL și apoi să execute migrarea. Fluxul testat este în installPhase2; pregătirea comenzii de lansare pentru hosted rămâne în faza 5, după integrarea API/UI și corectarea manuală a datelor reale. La încheierea fazei 2, aplicația folosea încă fluxul vechi; integrarea serverului este descrisă în faza 3. Publicarea trebuie coordonată cu migrarea.

## 7. Faza 3 — server și fluxul contului

Fișiere principale: app/api/users/route.ts, app/api/users/[userId]/route.ts, un helper server pentru erorile CIF/finalizare și app/api/_utils/user-lifecycle.ts.

### POST

1. requireAdmin și validarea completă a corpului înainte de Auth.
2. Normalizare/validare CIF pentru client; pentru celelalte roluri nu se acceptă un CIF nou.
3. Verificare anticipată a duplicatului pe toate profilurile, fără excluderea inactivilor. Este optimizare pentru mesaj, nu garanția unicității.
4. Creare Auth blocată, apoi finalizare DB conform fazei 0; eliminăm UPDATE-ul direct al profilului din ruta actuală.
5. Clasificăm exact conflictul indexului CIF ca 409; alte erori DB rămân distincte.
6. Reconciliem răspunsurile necunoscute înainte de compensare. Cleanup numai cu condiția pending, în aceeași protecție DB ca verificarea.
7. După confirmare se execută emailul și auditul existente, cu CIF normalizat. Eșecul emailului păstrează contul finalizat și parola de rezervă, conform #103. Parolele și tokenurile nu ajung în audit sau loguri.

### PATCH

- Verificarea de prezență a cheilor și dreptului adminului preced mutația.
- Normalizăm valoarea cerută și validăm profilul rezultat. Rolul și CIF-ul se salvează împreună; clientul nu poate rezulta cu CIF lipsă.
- Verificarea anticipată exclude numai UUID-ul țintei. Indexul rămâne autoritatea la concurență.
- Funcția DB revalidează autorul și invarianta rol/CIF pe rândul blocat; nu se bazează exclusiv pe oldProfile citit anterior.
- Un CIF neschimbat este no-op; o corectare efectivă apare în audit cu valorile vechi și noi returnate de funcția DB. Nu construim auditul din oldProfile citit înaintea tranzacției. Două PATCH concurente pe aceeași țintă trebuie să consemneze A→B și B→C, conform ordinii efective a mutațiilor, inclusiv dacă ambele cereri au citit inițial A.
- Nu schimbăm semantica generală de editare a emailului sau parola; acestea rămân în #106/#108.

### Rezultate faza 3 — 22 octombrie 2026

- POST validează corpul, câmpurile opționale și CIF-ul înainte de Auth. Verificarea duplicatului include toate profilurile și verifică disponibilitatea coloanei creation_pending pentru toate rolurile; pe schema veche refuză crearea înainte de Auth. Contul Auth este creat cu ban_duration = 87600h și finalizat prin RPC, cu rolul/CIF-ul separate de câmpurile profilului; UPDATE-ul direct a fost eliminat. Adminul și consultantul se pot crea fără CIF.
- [Helperul server](../app/api/_utils/user-creation.ts) clasifică numai încălcarea indexului profiles_cif_unique ca duplicat și nu transmite detaliile SQL/titularul. Ban-ul inițial păstrează precizia de șase zecimale prin trunchierea răspunsului Auth, fără conversie prin Date. Finalizarea se apelează o singură dată; răspunsurile pierdute se reconciliază numai după UUID. Un rezultat incert pending sau o citire indisponibilă produce 503 fără compensare, email ori credențiale. Un eșec cert poate anula numai UUID-ul nou care este încă pending; compensarea eșuată lasă contul blocat și raportat pentru remediere. Un cont între timp finalizat/dezactivat nu este șters sau reactivat.
- Emailul existent se execută după confirmarea activării, păstrând override-ul de dezvoltare, expeditorul în funcție de rol și cheia welcome-user/UUID. Un eșec Resend păstrează contul finalizat și întoarce parola temporară cu Cache-Control: no-store; un email confirmat exclude parola din răspuns. Auditul de creare conține CIF-ul canonic, fără parolă/token.
- PATCH refuză prezența cheii cif/cifCountry pentru orice non-admin, inclusiv consultant senior, înainte de citirea țintei. Validează rolul final și CIF-ul, exclude numai UUID-ul țintei la verificarea duplicatului și trimite rolul+CIF-ul împreună. O editare a altui câmp nu rescrie CIF-ul citit anterior. Auditul folosește strict oldValues/newValues returnate de RPC sub blocare; no-op-ul nu produce audit. Refuzul pending are mesaj și cod comune cu lifecycle.
- [Probele API](../scripts/issue-110-phase3-checks.mjs) execută sursele reale POST/PATCH, gărzile de autentificare, Supabase Auth/REST, RPC-urile și scrierea auditului în copia izolată; numai livrarea Resend este simulată. Încărcătorul TypeScript este exclusiv pentru teste, fără bypass sau comutatoare în codul aplicației. Cele 16 probe API noi și cele 38 anterioare au trecut: 54/54. Sunt acoperite validările înainte de Auth, toate rolurile, pauza pending, login după finalizare, cheia FR asemănătoare unui prefix, rezervarea la inactiv/alt rol, create–create/create–edit/edit–edit, rollback-ul, compensarea eșuată, pierderea reală a răspunsului TCP după commit, reconcilierea indisponibilă, drepturile seniorului și lanțul real al auditului pentru PATCH concurente pe aceeași țintă. Raport: [issue-110-phase3-results.json](issue-110-phase3-results.json).
- npm test: 423/423, inclusiv 21 de teste noi pentru helper și rutele reale cu servicii simulate. npm run lint: 0 erori, 3 avertismente existente; lint-ul instrumentelor de probă trece. SQL lint: 0 probleme; advisorii păstrează cele 103 avertismente existente și 0 introduse. TypeScript global raportează aceleași 9 importuri lipsă din playwright-report; verificarea strictă a întregii aplicații, cu numai acel director de rapoarte exclus din configurația încărcată în memorie, trece. Nu s-a modificat tsconfig.json.
- Baza temporară, containerele Auth/REST și directorul temporar al rulării au fost eliminate; totalurile Auth/profiles ale bazei sursă sunt neschimbate și coloana creation_pending este încă absentă acolo. Nu s-au aplicat migrări pe sursă/hosted și nu s-au trimis emailuri reale. A fost eliminat și fișierul temporar folosit la consultarea changelog-ului.

Comanda de reproducere: node --experimental-strip-types scripts/issue-110-phase0.mjs --phase3, cu .env.e2e.localdb. Raportul conține numai rezultatele probelor și totaluri tehnice.

Urmează faza 4 pentru controlul țară/număr, afișarea erorilor și a conturilor pending. Verificarea manuală în browser se face după această integrare. Creatorii generali de fixture și regresiile Playwright rămân în faza 5 conform inventarului; acele suite și build-ul nu sunt validate prin probele API ale fazei 3. Serverul nou depinde de migrarea pregătită, deci nu este încă o versiune de publicat independent.

## 8. Faza 4 — formularul și integrarea viitoare

Fișiere principale: components/CifInput.tsx și app/admin/users/page.tsx; ajustări în components/UserDrawer.tsx și app/admin/users/[id]/page.tsx pentru starea pending.

- Componentă controlată țară/număr, folosind componentele și stilurile existente. România este valoarea inițială; câmpul număr rămâne text, cu tastatură numerică numai pentru RO.
- Label-uri distincte, aria-invalid/aria-describedby, asocierea mesajului cu câmpul și focus pe prima eroare. Funcționează din tastatură și la lățime de telefon.
- Validare la părăsirea câmpului și submit; o eroare afișată se actualizează la corectare. La schimbarea țării păstrăm textul introdus și îl revalidăm.
- Erorile serverului rămân lângă CIF și păstrează formularul completat. Refacem doar tratarea locală necesară; folosim convenția existentă message.
- CIF-ul apare numai la client. Limita pentru firmele UE fără TVA este explicată în ajutorul câmpului, fără a sugera că prefixul RO atestă TVA.
- La resetarea formularului se resetează și țara. La editare, parseCif precompletează cele două controale.
- Până la editorul #106, schimbarea rolului din listă către client fără CIF este refuzată cu explicație. API-ul acceptă rol + CIF într-o singură salvare; nu adăugăm aici încă un editor.
- Conturile pending au eticheta „Creare incompletă”, explicația remedierei și numai acțiunile permise de verificarea serverului.
- Actualizăm mesajele/ramurile profile_update_failed și testele lor conform noului rezultat real; nu păstrăm un mesaj de succes când activarea nu e confirmată.

Componenta este pregătită pentru #106, dar editorul complet nu este implementat în #110. Criteriul de editare din panou se recepționează la integrarea #106; dacă acesta nu există la livrare, limita rămâne explicit deschisă în recepția issue-ului.

### Rezultate faza 4 — 22 octombrie 2026

- [CifInput](../components/CifInput.tsx) este controlat prin valoarea { country, number } și folosește catalogul comun al celor 27 de țări. România este prima și implicită; numărul rămâne text în toate țările, cu inputMode numeric numai pentru RO. Controalele au etichete distincte, identificatori unici, aria-invalid și aria-describedby. Ajutorul explică situația RO și limita firmelor UE fără identificator TVA. Mesajul de eroare este imediat sub controale și precedă ajutorul inclusiv pentru cititoarele de ecran.
- Formularul validează la blur și submit. La corectare actualizează eroarea, iar schimbarea țării păstrează textul și îl revalidează, inclusiv cheia FR asemănătoare unui prefix. Resetarea după succes și schimbarea rolului resetează țara la RO. Payload-ul clientului include cif și cifCountry; celelalte roluri nu trimit aceste chei. Componenta poate primi direct țara/numărul produse de parseCif la integrarea editorului #106; nu există încă un editor de CIF în această pagină.
- Erorile CIF din API folosesc message/field, rămân lângă control și păstrează toate datele formularului. Un conflict server rămâne afișat și după blur până la modificarea valorii. Focusul server este aplicat după reactivarea câmpurilor și centrează controlul în zona derulabilă, astfel încât eroarea să fie vizibilă și pe telefon. Validarea nativă a celorlalte câmpuri păstrează focalizarea primei erori din formular.
- Ramura profile_update_failed și afișarea UUID-ului parțial au fost eliminate. ACCOUNT_CREATION_PENDING, ACCOUNT_CREATION_UNCONFIRMED și ACCOUNT_CREATION_INACTIVE păstrează formularul, afișează mesajul real și cer verificarea listei înainte de retry. Formularul nu poate fi retrimis până la această verificare; butonul deschide toate stările și caută emailul introdus. Nici erorile de rețea, nici un răspuns 201 incomplet nu afișează succes sau parolă. Fallback-ul existent apare numai pentru un răspuns de creare confirmată cu emailSent = false și parolă prezentă.
- Panoul folosește dialogul Radix deja instalat: focusul rămâne în panou și revine la declanșator, Escape respectă mai întâi tooltip-ul existent și apoi închide panoul. În timpul trimiterii sunt blocate câmpurile și închiderea, păstrând rezultatul cererii asociat formularului trimis.
- Lista, fișa reală a utilizatorului și UserDrawer afișează „Creare incompletă” și explicația accesului blocat. Lista dezactivează rolul și nu oferă reactivare/dezactivare pentru pending. Ștergerea eligibilă păstrează verificarea legăturilor și confirmarea existente. Trecerea din listă către client fără CIF valid este oprită înaintea confirmării, cu explicația limitei editorului. CIF-ul istoric al unui consultant/admin rămâne rezervat în DB și nu este afișat în fișă sau drawer.
- [Testele UI](../tests/ui/cif-input.spec.ts) folosesc numai identități sintetice și interceptează Auth, API și Realtime. [Instrumentul fazei 4](../scripts/issue-110-phase4.mjs) copiază sursele curente într-un director temporar și pornește Next CLI separat pe loopback, cu un endpoint Supabase deliberat indisponibil și fără cheia service. Nu copiază fișiere .env. Îndepărtează separat junction-ul node_modules înainte de ștergerea copiei. Serverul existent de pe portul 3000 nu este oprit; copia izolată a fost necesară deoarece conexiunea lui HMR nu funcționa și browserul nu inițializa aplicația.
- Recepție UI: 26/26 probe trecute, câte 13 pe Chromium desktop și telefon. Acoperă catalogul și etichetele, validarea/primele erori, corectarea, păstrarea textului la schimbarea țării, cheia FR, duplicatul și țara refuzate de server, păstrarea întregului formular, cele trei rezultate de creare ce cer verificarea listei, fallback-ul și răspunsul incomplet, rolurile interne, conturile pending, protecția ștergerii și schimbarea rolului fără CIF. Capturile la 320 și 390 px au fost inspectate; testul cere ca eroarea să fie integral în zona vizibilă, iar controalele să nu depășească lățimea ecranului. S-au corectat focusul aplicat cât câmpurile erau încă dezactivate și poziția erorii sub ajutorul lung.
- npm test: 423/423; lint fără erori, cu cele 3 avertismente existente după eliminarea copiei temporare. TypeScript strict pentru aplicație și testele noi trece, excluzând doar rapoartele vechi și directorul temporar; verificarea globală confirmă aceleași 9 importuri lipsă din playwright-report. Nu s-au schimbat tsconfig.json, next.config.ts sau dependențele. Serverul temporar și copia surselor au fost eliminate după rularea finală; raportul confirmă cleanupPassed și absența scrierilor DB/hosted sau a livrărilor reale de email.

Comanda de reproducere: node scripts/issue-110-phase4.mjs. Folosește configurația UI din .env.e2e.localdb numai pentru pornirea runnerului; toate autentificările și mutațiile din noua suită sunt simulate. Raportul compact este [issue-110-phase4-results.json](issue-110-phase4-results.json), iar capturile și urmele sunt în test-results, ignorat de Git. Datele hosted și baza locală sursă nu sunt modificate.

Rămân pentru faza 5 creatorii generali de fixture, regresiile cu DB/Auth reale, build-ul și pregătirea rollout-ului. Verificarea manuală a fluxului pe o bază migrată urmează după acea pregătire; capturile fazei 4 verifică numai interfața cu răspunsuri simulate. Nu s-au aplicat migrări sau făcut deploy în această fază.

## 9. Faza 5 — date de test și verificare

Actualizăm doar creatorii de conturi afectați de noua inițializare pending:

- scripts/create-local-admin.mjs și scripts/seed-local-demo.mjs;
- testele de conturi și helper-ele care folosesc auth.admin.createUser urmat de UPDATE/upsert: conturi-lifecycle, drepturi, drepturi-interfata, matricea-acces, regresii-senior, verificare-modificari și incheiere-finalizare;
- tests/e2e/recovery-fixtures.spec.ts, care presupune autentificare imediată după auth.admin.createUser;
- scripts/issue-107-check.mjs și phase0 dacă rămâne un instrument reluabil;
- testele UI/mocks care au nevoie de noua stare sau de payload-ul țării.

Fixturele locale pot face bootstrap explicit prin SQL privilegiat local sau prin finalizator cu un admin existent; nu adăugăm un bypass public pentru bootstrap și nu activăm global profiluri incomplete. Pregătirea profilului, creation_pending = false și is_active = true se salvează împreună, cu CIF valid pentru client, înainte de primul login sau de folosirea contului în scenarii. Creatorii de admin/consultant trebuie să funcționeze și fără CIF. Verificăm toți apelanții auth.admin.createUser din scripts/ și tests/, inclusiv cei fără UPDATE explicit, pentru a nu lăsa alte fixture blocate.

### Matricea de acceptare

| Arie | Cazuri obligatorii |
| --- | --- |
| Modul | Toate țările, checksum RO, limite, prefix/country, caractere semnificative, parse și normalizare repetată. |
| API | CIF lipsă/null/tip greșit; țară invalidă; non-admin, inclusiv senior, modifică propriul CIF; rol + CIF; același CIF neschimbat. |
| Unicitate | Activ/inactiv/alt rol cu CIF istoric; aliasuri normalizate; create–create, create–edit și edit–edit concurente. |
| Creare | Toate rolurile; pauză după Auth; erori certe și timeout cu commit; cleanup eșuat; retry întârziat; zero email înainte de confirmare. |
| Lifecycle | Pending nu se reactivează; dezactivarea rezervă CIF; reactivarea păstrează CIF; hard-delete eligibil îl eliberează. |
| Acces | Login, recovery, REST/RPC/RLS pentru pending și pentru clientul finalizat; fără escaladare prin metadata. |
| UI | Țară implicită, paste, mesaje reale server, păstrarea câmpurilor, focus, tastatură și telefon. |
| Regresii | Parolă temporară, fallback email, audit normalizat fără secrete și cu valori anterioare corecte la PATCH concurente pe aceeași țintă, ultimul admin, recovery și fixturele existente. |

Verificări după implementare: npm run verifica; proba locală și suita CIF pe DB/Auth reale; conturi-lifecycle, conturi-ui, incheiere-finalizare, recovery-fixtures și testele recovery relevante, plus suitele cu creatori de conturi modificați; verificarea locală a privilegiilor/indexurilor și advisorii disponibili. Testele cu scriere folosesc explicit .env.e2e.localdb, confirmă că serverul folosește aceeași bază și simulează Resend. Comenzile se execută potrivit shell-ului, fără sintaxa de env POSIX din unele scripturi npm.

Nu rulăm aceste suite pentru simpla adăugare a planului.

### Rezultate faza 5 — 22 octombrie 2026

- [Bootstrap-ul comun pentru fixture](../scripts/local-account-fixtures.mjs) refuză URL-uri non-locale și finalizează numai UUID-ul primit: rolul, CIF-ul sintetic valid pentru client, `creation_pending=false` și `is_active=true` se salvează în același UPDATE privilegiat. Adminii și consultanții funcționează fără CIF. Creatorul local de admin, seed-ul, creatorii celor șapte suite inventariate, recovery-fixtures și instrumentul curent #107 folosesc acest contract. Seed-ul complet a trecut de două ori pe aceeași bază; elimină și adăugarea redundantă a consultanților deja importați din șablon. Instrumentul #107 phase0 rămâne o probă istorică pentru baseline-ul anterior, nu o suită de recepție pe schema curentă; nu i s-a schimbat contractul.
- Scenariile API care trec către client trimit acum CIF și țară împreună cu rolul. Matricea UI verifică refuzul trecerii fără CIF și păstrarea rolului, apoi o schimbare permisă din listă; nu presupune existența editorului #106. Testul conturi-ui închide întâi tooltip-ul (inclusiv timerul său), apoi dialogul. Aserțiunile lifecycle respectă revocarea SELECT direct pe faze/activități din #109, iar ocolirea redeschiderii unui proiect prin PATCH așteaptă conflictul 409. Nu s-au relaxat privilegiile sau gărzile aplicației pentru a trece testele.
- [Runnerul](../scripts/issue-110-phase5-checks.mjs), apelat prin `scripts/issue-110-phase0.mjs --phase5`, folosește baza fără conturi copiate și containerele Auth/REST ale probei existente, adăugând Storage fără volumul sursă și Realtime separat. Aplicația rulează dintr-o copie prin build Turbopack și `next start`. Numai configurația copiei primește rădăcina workspace-ului pentru junction-ul node_modules. Recovery HTTP rulează într-o a doua copie development pe aceeași bază, fiindcă #107 refuză HTTP și furnizorii simulați în producție. Cheile recovery sunt efemere; Resend și SMTP nu livrează emailuri reale.
- Cele 53 de probe DB/API au trecut în rularea completă, incluzând privilegiile, indexul, concurența și advisorii. [Noua suită HTTP/browser](../tests/e2e/cif-creation.spec.ts) confirmă cele trei roluri, parola temporară extrasă din emailul capturat și autentificarea, audit fără parolă, recovery pentru clientul finalizat și refuzul pending-ului, rezervarea CIF-ului inactiv/istoric, cursele create–create și create–edit, crearea și duplicatul în browser la 1440/390 px. Capturile au fost inspectate.
- Recepția Playwright finală este **122/122 cazuri din 10 suite**, fără cazuri omise în rezultatul final. Raportul combină rularea completă cu reluarea celor două matrice după corectarea așteptărilor vechi: codul 400 în loc de 409 și trecerea la client fără CIF. Celelalte opt suite nu au fost reluate inutil. Matricea API are 313/313 verificări interne trecute; observațiile cunoscute ale matricei generale rămân în raportul său detaliat. [Raportul de recepție](issue-110-phase5-acceptance-results.json) păstrează proveniența celor două rulări; rapoartele `phase5-results` și `phase5-playwright-results` descriu ultima rulare, care poate fi selectivă.
- `npm.cmd run verifica`: lint fără erori (cele 3 avertismente existente), TypeScript global, **427/427 teste unitare** și build reușite. `tsconfig.json` exclude rapoartele Playwright, rezultatele generate și `supabase/.temp`; ESLint exclude și el copiile temporare. Sursele și testele reale rămân verificate. [Preflight-ul de rollout](../scripts/issue-110-preflight.mjs) validează offline snapshot-ul SQL privat cu modulul CIF comun și afișează numai totaluri; amprenta este emisă numai pentru un inventar valid. Testele sale refuză date invalide și snapshot-uri malformed.
- Rularea completă și resursele sale au fost curățate, cu totalurile sursă păstrate. Mediul ultimei rulări a fost lăsat pornit intenționat pentru recepția manuală; `manualEnvironmentActive` și `cleanupPending` descriu starea la data raportului. S-a confirmat separat că `creation_pending` încă lipsește din baza sursă și că exemplele CIF din ghid sunt libere. Nu s-au făcut scrieri hosted sau livrări reale de email.

Recepția umană poate începe acum în mediul temporar, conform [pașilor concreți](issue-110-rollout.md). Telefonul fizic, HTTPS și livrabilitatea emailului se verifică în preview; nu sunt dovedite de emularea Chromium sau mock. Scriptul complet istoric `issue-107-check.mjs` nu a fost reluat: acoperirea recovery din această fază constă în unitare, recovery-fixtures, proba DB pending și noul flux HTTP complet. Curățarea datelor reale, migrarea hosted, deploy-ul și editorul #106 rămân pași ulteriori.

## 10. Ordinea de livrare și recepție

1. Proba Auth locală și raportul ei.
2. Modulul CIF și teste unitare.
3. Schema/finalizatorul și testele de concurență, apoi migrarea stabilă.
4. POST/PATCH și fixturele afectate.
5. Controlul CIF și tratarea mesajelor în formular.
6. Regresiile, review-ul și instrucțiunile exacte de rollout.

Înainte de activare pe hosted:

- Rulăm din nou inventarul read-only pentru toate profilurile cu CIF și clienții fără CIF. Corectăm valorile greșite din documentele firmei; rezolvarea duplicatelor este manuală, fără mutarea automată a proiectelor sau fișierelor.
- Păstrăm o dovadă a corecțiilor, cu valori vechi/noi și autor, în canalul administrativ existent. Nu publicăm lista CIF-urilor sau date personale în raportul din repository.
- Confirmăm compatibilitatea Auth și a gărzilor #105/#107, backup-ul și faptul că aplicația nouă este pregătită.
- Folosim o fereastră coordonată care oprește efectiv scrierile de conturi către aceeași bază, inclusiv din deployment-uri vechi. Migrarea schimbă inițializarea Auth; aplicația veche nu este compatibilă cu noul flux.
- Aplicăm schema și aplicația, repetăm preflight-ul, verificăm conturile noi pentru toate rolurile și apoi reluăm scrierile.
- Dacă verificarea eșuează, păstrăm conturile pending blocate și remediem versiunea; nu revenim la fluxul vechi cu creare activă în doi pași și nu eliminăm indexul pentru a permite duplicate.

Recepția tehnică a #110 cere proba Auth trecută, toate testele CIF, zero coliziuni/date invalide în preflight și mesaje verificate în browser. [Fișa de recepție manuală](issue-110-manual-reception.md) păstrează probele umane în așteptare până la testarea ulterioară cerută de utilizator. Recepția editării din panou este legată explicit de #106. Firmele UE fără identificator TVA rămân în ticket separat.

Documentul a fost creat inițial ca plan; execuția autorizată a început cu faza 0 de mai sus. Aplicarea migrărilor pe hosted, curățarea datelor reale, deploy-ul și modificarea issue-urilor GitHub rămân pași ulteriori.

## Surse tehnice

- [Issue #110](https://github.com/DominteEmanuelBeniamin/platforma-fonduri/issues/110), [#105](https://github.com/DominteEmanuelBeniamin/platforma-fonduri/issues/105), [#106](https://github.com/DominteEmanuelBeniamin/platforma-fonduri/issues/106), [#111](https://github.com/DominteEmanuelBeniamin/platforma-fonduri/issues/111).
- [Formate TVA UE — administrația fiscală finlandeză](https://vero.fi/en/businesses-and-corporations/taxes-and-charges/vat/international-commerce/vat-number/vat-numbers-issued-by-different-eu-countries/).
- [Formate TVA UE — HMRC, inclusiv restricțiile cheii FR](https://www.gov.uk/guidance/vat-eu-country-codes-vat-numbers-and-vat-in-other-languages).
- [Auth v2.197.0, adminUserCreate](https://github.com/supabase/auth/blob/v2.197.0/internal/api/admin.go#L371): ordinea inserării, tranzacția și aplicarea ban-ului.
- [Supabase createUser](https://supabase.com/docs/reference/javascript/auth-admin-createuser) și [updateUserById](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid).
- [Algoritm CUI documentat în FinTPc, secțiunea 3.6.13.4.1](https://fintp.org/wp-content/uploads/2020/03/FinTPc-SRS.pdf).
- Documentația Next.js instalată: node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md.
