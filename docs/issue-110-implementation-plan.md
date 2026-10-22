# Issue #110 — plan de implementare

Data: 22 octombrie 2026. Bază verificată: commit 1e05f67, branch feat/sabloane-compacte.

Acesta este planul de lucru, fără implementare sau modificări de date. Proba Auth din faza 0 este obligatorie înainte de stabilizarea migrării; rezultatele ei nu sunt încă demonstrate.

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

Pentru compatibilitate cu apelurile existente, dacă cifCountry lipsește, prefixul recunoscut determină țara; un număr simplu este tratat ca România. EL și GR se citesc ca Grecia și se salvează întotdeauna cu EL. Cu țară explicită, un prefix străin produce eroare, fără schimbarea automată a țării. cifCountry singur într-un PATCH este invalid.

În PATCH, prezența cheii cif sau cifCountry la un non-admin produce 403 inclusiv pentru null, șir gol sau valoare neschimbată. Pentru admin, null/gol la un client produce CIF_REQUIRED. CIF-ul explicit se editează pentru rolul final client; schimbarea către alt rol păstrează intern CIF-ul vechi, fără un câmp de firmă în formularul noului rol.

### Normalizare și validare

- Trim, uppercase, eliminarea spațiilor și punctelor, eliminarea unui singur prefix recunoscut care corespunde țării.
- La RO se elimină zerourile inițiale, se respinge zero și se validează lungimea rezultatului și checksum-ul cu cheia 753217532, aliniată la dreapta; restul 10 devine cifra 0.
- În alte țări zerourile și literele semnificative se păstrează. Nu eliminăm arbitrar caractere speciale: variantele istorice IE se verifică după regula lor, inclusiv caracterele permise în poziția specială.
- Catalogul conține țara ISO, prefixul fiscal, eticheta, regula exactă și un exemplu. România prima, restul în ordinea alfabetică a etichetelor românești.
- AT, NL, SE, IE, ES, FR și GR/EL au teste explicite pentru pozițiile caracterelor și variante, pe lângă câte un caz valid și invalid pentru fiecare țară.
- parseCif desparte valoarea salvată în țară și număr fără pierderi. O valoare legacy nerecunoscută produce o eroare explicită, nu revenire silențioasă la RO.

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
| 500/503 | cod de creare/remediere | Explică rezultatul parțial real, fără succes fals. |

Erorile includ code, message și, pentru formular, field = cif sau cifCountry. Folosim convenția message/serverMessage existentă, deoarece apiFetch rescrie error. Nu întoarcem UUID-ul, emailul, starea sau numele titularului CIF-ului duplicat.

## 4. Faza 0 — probă locală a creării protejate

Mediul Docker disponibil folosește Auth v2.197.0. Sursa acestei versiuni arată că adminUserCreate inserează mai întâi utilizatorul și aplică ulterior app_metadata și ban_duration, în aceeași tranzacție Auth. Un trigger de INSERT nu poate presupune că vede metadatele administrative. Planul folosește fluxul explicit de mai jos, fără roluri citite din user_metadata.

Proba se execută pe stack local dedicat, cu verificarea hostului și configurație E2E explicită. Nu folosește baza hosted și nu trimite emailuri reale.

### Mecanismul ales pentru probă

1. Adăugăm un singur marcaj profiles.creation_pending, boolean, implicit false pentru rândurile existente.
2. handle_new_user creează orice profil nou cu creation_pending = true și is_active = false. Rolul inițial rămâne client; CIF-ul temporar poate fi NULL numai cât timp marcajul este true.
3. POST creează Auth cu o parolă aleatorie și ban_duration lung, pe modelul existent din #105. Ban-ul este aplicat înainte de commit-ul Auth, iar profilul inactiv asigură și blocarea accesului aplicației.
4. O funcție DB dedicată finalizării primește UUID-ul nou, autorul verificat și profilul validat. Revalidează adminul activ, existența și marcajul țintei, apoi salvează profilul final, rolul, CIF-ul și marcajul parolei temporare, elimină ban-ul inițial și setează creation_pending = false / is_active = true într-o singură tranzacție.
5. Finalizarea folosește ordinea de blocare comună #105/#107. Nu reactivează un cont existent sau unul dezactivat. Funcția este accesibilă numai service_role și verifică autorul în DB.
6. Dezactivarea/reactivarea obișnuită și PATCH refuză țintele creation_pending. În lista adminului ele apar ca „Creare incompletă”, cu opțiunea existentă de ștergere protejată, fără buton de reactivare.
7. Dacă finalizarea eșuează cert, se încearcă delete_empty_user_account numai pentru UUID-ul creat în cererea curentă, revalidând că e încă pending și fără date. Nicio ștergere după CIF/email și nicio forțare a blocantelor.
8. Dacă anularea eșuează sau procesul se întrerupe, contul rămâne blocat și vizibil pentru remediere. Nu adăugăm cron, coadă sau reactivare automată. Emailul și parola nu sunt predate înainte de finalizare.

creation_pending este necesar pentru a distinge un cont nefinalizat de un cont dezactivat valid. Nu reutilizăm auth_sync_pending, care are deja semantica sincronizării lifecycle.

### Probe care trebuie să treacă

- La pauza dintre Auth și finalizare: login prin parolă refuzat, API/REST/RPC fără acces, recovery omis și reactivare administrativă refuzată.
- Client, consultant și admin se finalizează corect; un CIF obligatoriu pentru client nu blochează crearea celorlalte roluri.
- Două creări cu același CIF, dar emailuri diferite: exact un cont finalizat; celălalt primește conflict și este anulat sau rămâne blocat cu rezultat explicit de remediere.
- Eșec forțat înainte de finalizare, la indexul unic, la scoaterea ban-ului și la ștergerea compensatorie: fără cont incomplet utilizabil și fără email.
- Timeout la finalizare poate însemna commit reușit. Reconcilierea citește UUID-ul creat; nu șterge și nu refinalizează un cont deja finalizat. Dacă starea nu poate fi confirmată, nu declară eșec cert sau succes și nu trimite parola.
- Finalizare concurentă cu ștergerea, cu pierderea dreptului adminului sau cu un retry: fără activare a altui cont și fără eliminarea unui ban ulterior.
- user_metadata.role/cif/is_active nu oferă drepturi și nu poate finaliza contul.

Livrabil: un script mic cu aserțiuni, strict local, și un raport al rezultatelor. Dacă mecanismul nu trece aceste probe, se revizuiește secțiunea de creare înainte de implementarea fluxului final; nu se declară atomic un lanț de apeluri HTTP.

## 5. Faza 1 — modulul comun

Fișiere principale: lib/cif.ts și lib/cif.test.mjs.

- Implementăm catalogul UE, normalizeCif, validateCif și parseCif; fără I/O, dependențe sau apeluri online.
- Același modul este importat în formular și în cele două rute API.
- Testăm idempotenta normalizării, prefixele repetate/contradictorii, tipurile greșite la intrarea API, RO cu checksum greșit, limitele de lungime, zero și zerouri inițiale.
- Folosim exemple valide verificate. RO12345678 rămâne doar caz negativ; exemplele pozitive pot include RO5258486 și RO4221306.
- Datele de integrare primesc CIF-uri sintetice valide și distincte. Nu folosim un singur CIF real pentru toate conturile de test.

Rezultat: contractul pur și toate cele 27 de formate sunt testate înainte de conectarea la DB.

## 6. Faza 2 — schema și mutațiile DB

Construim migrarea după proba locală. Generăm numele prin Supabase CLI, după verificarea comenzilor cu --help; nu edităm migrările istorice.

- creation_pending, inițial false pentru conturile existente; CHECK impune ca un pending să fie inactiv.
- Regula obligatorie este condiționată de finalizare: orice client cu creation_pending = false are CIF nenul și nevid, inclusiv dacă este dezactivat. Fără NOT NULL global pe cif.
- Un helper SQL mic normalizează identitatea CIF pentru toate scrierile: prefix, case, spații/puncte și zerourile RO. Păstrează caracterele semnificative ale identificatorilor străini. Valorile nenule se stochează canonic.
- Index unic pe profiles.cif pentru toate valorile nenule, fără filtru pe rol sau is_active. Numim indexul explicit, pentru a distinge încălcarea sa de alte erori 23505.
- Validarea completă RO/UE rămâne în modulul TypeScript, la granița API. Nu duplicăm întregul catalog de formate și checksum în SQL; verificăm separat paritatea normalizatorului SQL cu cel comun.
- Actualizăm handle_new_user, funcția de finalizare și update_user_profile_guarded. Ultima verifică dreptul adminului la CIF și rolul final sub blocare, păstrând CIF-ul la ieșirea din rolul client.
- Extindem lifecycle numai pentru refuzul reactivării/modificării unui pending și pentru anularea protejată, condiționată de marcaj, a contului proaspăt creat.
- Păstrăm revocările de scriere directă pentru anon/authenticated. RPC-urile noi au search_path fix, privilegii minime și verificare de autor.
- Actualizăm tipurile de profil în lib/database.types.ts, types/database.ts și consumatorii care au nevoie de noul marcaj.

Preflight-ul migrării refuză date lipsă, invalide/necanonice sau coliziuni rămase; nu inventează corecții și nu șterge/unește conturi. Aplicarea normalizărilor aprobate și indexarea se fac în aceeași fereastră controlată, cu revalidare sub blocare, fără gol între verificare și constrângere.

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
- Un CIF neschimbat este no-op; o corectare efectivă apare în audit cu valorile vechi și noi.
- Nu schimbăm semantica generală de editare a emailului sau parola; acestea rămân în #106/#108.

## 8. Faza 4 — formularul și integrarea viitoare

Fișiere principale: components/CifInput.tsx și app/admin/users/page.tsx; ajustări în components/UserDrawer.tsx pentru starea pending.

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

## 9. Faza 5 — date de test și verificare

Actualizăm doar creatorii de conturi afectați de noua inițializare pending:

- scripts/create-local-admin.mjs și scripts/seed-local-demo.mjs;
- testele de conturi și helper-ele care folosesc auth.admin.createUser urmat de UPDATE: conturi-lifecycle, drepturi, drepturi-interfata, matricea-acces, regresii-senior, verificare-modificari;
- scripts/issue-107-check.mjs și phase0 dacă rămâne un instrument reluabil;
- testele UI/mocks care au nevoie de noua stare sau de payload-ul țării.

Fixturele locale pot face bootstrap explicit prin SQL privilegiat local sau prin finalizator cu un admin existent; nu adăugăm un bypass public pentru bootstrap și nu activăm global profiluri incomplete. Creatorii de admin/consultant trebuie să funcționeze și fără CIF.

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
| Regresii | Parolă temporară, fallback email, audit normalizat fără secrete, ultimul admin, recovery și fixturele existente. |

Verificări după implementare: npm run verifica; proba locală și suita CIF pe DB/Auth reale; conturi-lifecycle, conturi-ui și testele recovery relevante; verificarea locală a privilegiilor/indexurilor și advisorii disponibili. Testele cu scriere folosesc explicit .env.e2e.localdb, confirmă că serverul folosește aceeași bază și simulează Resend. Comenzile se execută potrivit shell-ului, fără sintaxa de env POSIX din unele scripturi npm.

Nu rulăm aceste suite pentru simpla adăugare a planului.

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

Recepția tehnică a #110 cere proba Auth trecută, toate testele CIF, zero coliziuni/date invalide în preflight și mesaje verificate în browser. Recepția editării din panou este legată explicit de #106. Firmele UE fără identificator TVA rămân în ticket separat.

Această cerere livrează numai planul. Aplicarea migrărilor, curățarea datelor, implementarea, deploy-ul și modificarea issue-urilor GitHub sunt pași ulteriori.

## Surse tehnice

- [Issue #110](https://github.com/DominteEmanuelBeniamin/platforma-fonduri/issues/110), [#105](https://github.com/DominteEmanuelBeniamin/platforma-fonduri/issues/105), [#106](https://github.com/DominteEmanuelBeniamin/platforma-fonduri/issues/106), [#111](https://github.com/DominteEmanuelBeniamin/platforma-fonduri/issues/111).
- [Formate TVA UE — administrația fiscală finlandeză](https://vero.fi/en/businesses-and-corporations/taxes-and-charges/vat/international-commerce/vat-number/vat-numbers-issued-by-different-eu-countries/).
- [Auth v2.197.0, adminUserCreate](https://github.com/supabase/auth/blob/v2.197.0/internal/api/admin.go#L371): ordinea inserării, tranzacția și aplicarea ban-ului.
- [Supabase createUser](https://supabase.com/docs/reference/javascript/auth-admin-createuser) și [updateUserById](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid).
- [Algoritm CUI documentat în FinTPc, secțiunea 3.6.13.4.1](https://fintp.org/wp-content/uploads/2020/03/FinTPc-SRS.pdf).
- Documentația Next.js instalată: node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md.
