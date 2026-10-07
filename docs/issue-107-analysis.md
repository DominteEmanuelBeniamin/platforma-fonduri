# Issue #107 — analiză de arhitectură și contract pentru recuperarea parolei

Data: 7 octombrie 2026. Documentul pregătește clarificarea issue-ului; nu este planul de implementare și nu declară funcționalitatea implementată.

**Verdict:** recuperarea prin link se potrivește cu Next.js + Supabase Auth + Resend. Implementarea descrisă acum în #107 nu acoperă contractul complet: acordă prea devreme o sesiune normală, lasă neprecizată invalidarea linkurilor la schimbarea stării contului și împarte operația între browser, Auth și DB fără o regulă pentru concurență sau eșecuri parțiale. Aceste aspecte trebuie corectate în cerințe înainte de planificare.

## 1. Baza verificată

- Checkout: main, commit 2257075648b67bbffa687653a4525ee816b073b5, inițial fără modificări locale.
- [#107](https://github.com/DominteEmanuelBeniamin/platforma-fonduri/issues/107): recuperare proprie prin link pentru client, consultant și admin. Nu are comentarii la data analizei.
- Dezactivarea este [#105](https://github.com/DominteEmanuelBeniamin/platforma-fonduri/issues/105), nu #103. [PR #117](https://github.com/DominteEmanuelBeniamin/platforma-fonduri/pull/117) este deschis, pe feat/safe-user-deletion, commit 2471801629dbd444980f0f38b4493b6d89136a4e. Branch-ul local coincide cu acest head; a fost citit fără schimbarea checkout-ului.
- [#103](https://github.com/DominteEmanuelBeniamin/platforma-fonduri/issues/103) privește parola temporară la creare. [PR #116](https://github.com/DominteEmanuelBeniamin/platforma-fonduri/pull/116) este merged și există în main.
- Au fost citite și [#106](https://github.com/DominteEmanuelBeniamin/platforma-fonduri/issues/106), pentru schimbarea emailului, și [#108](https://github.com/DominteEmanuelBeniamin/platforma-fonduri/issues/108), pentru resetarea de către admin.
- SDK-ul instalat și lockfile-ul folosesc supabase-js / auth-js 2.90.0. Clientul din lib/supabaseClient.ts folosește valorile implicite: implicit flow, detectarea sesiunii în URL și persistență în browser. Nu avem o arhitectură SSR cu sesiuni în cookie.
- Documentația Supabase, changelogul și sursele oficiale Auth au fost consultate. Sursele Auth de pe master ajută la identificarea riscurilor, dar nu dovedesc comportamentul versiunii din mediul țintă.
- Docker local nu este pornit. Nu au fost executate recovery-uri, trimise emailuri sau modificate conturi/baze de date. Verificările anterioare consemnate în #105/PR #117 nu au fost rerulate aici.

## 2. Ce reutilizăm și ce există deja

| Componentă | Constatare și implicație |
| --- | --- |
| app/login/page.tsx | Are numai login; redirecționează imediat la / dacă există token. Formularul forgot trebuie să funcționeze public. |
| app/providers/AuthProvider.tsx | La inițializare și la evenimente fără sesiune trimite la /login, indiferent de rută. Ignoră tipul evenimentului Auth. Va întrerupe un flux public de recovery dacă nu îi recunoaște rutele. |
| app/api/_utils/auth.ts în main | Validează utilizatorul și profilul, dar nu refuză explicit is_active = false și nu verifică existența sesiunii în DB. Nu poate asigura singur integrarea cerută. |
| Același helper în PR #117 | Refuză conturile inactive și folosește current_account_session_active() pentru sesiuni revocate. Acesta este mecanismul de acces care trebuie reutilizat. |
| current_account_session_active() din PR #117 | Verifică profilul activ, ban-ul Auth și session_id în auth.sessions; este integrat în protecțiile API/RLS/RPC/Storage/Realtime. Nu verifică dacă o sesiune recovery a finalizat alegerea parolei. |
| profiles.password_reset_requested_at | **Există deja în baseline**, la 20260918080000_baseline_public_schema.sql. Nu adăugăm încă o migrare cu aceeași coloană. Nu apare în cele două tipuri Profile și nu este folosit în main. |
| profiles.must_change_password | Există după #103; conturile noi primesc true. Recovery reușit trebuie să îl facă false printr-o scriere protejată pe server. |
| app/api/_utils/email.ts | Reutilizăm validarea emailului, escaping-ul, expeditorul și resolveReminderDelivery. Helper-ul deja refuză un override în producție și lipsa lui în development/preview. |
| app/api/_utils/audit.ts | Există IP, user-agent și redactare. logAction/logUserAction sunt best-effort; nu garantează auditul unei schimbări de parolă. Nu inventăm un endpoint de audit în care browserul doar declară succesul. |
| app/api/auth/audit/route.ts | Primește numai login/logout, cu profil autentificat. Nu este potrivit pentru o cerere anonimă și nu dovedește schimbarea parolei. |
| app/api/me/route.ts și requireProfile în main | Citesc profiles cu select('*'). O eventuală stare de recovery care conține credențiale native trebuie păstrată într-un loc privat, nu expusă automat în aceste răspunsuri. |

Există și branch-ul vechi password-reset, commit 87e7863: forgot trimite o solicitare adminilor, iar adminul alege manual parola numai pentru client/consultant. Nu implementează #107 și contrazice deciziile curente din #108. Poate oferi un exemplu de normalizare a emailului și de claim condiționat pentru cooldown; fluxul și vechea migrare nu trebuie integrate ca atare. Helper-ele actuale de email au prioritate față de copiile de pe acel branch.

## 3. Deciziile stabilite în această analiză

Confirmate de utilizator:

1. Dezactivarea, schimbarea emailului și resetarea de către admin invalidează toate linkurile și fluxurile recovery anterioare. **Reactivarea nu le face din nou valide.**
2. Linkul permite alegerea parolei. Accesul normal al contului recuperat începe **numai după salvarea cu succes**.
3. Resetarea propriei parole este activitate Auth. Ea nu blochează ștergerea unui cont fără date de business, conform intenției #105. Auditul rămâne păstrat.

Decizia de securitate solicitată de utilizator: pentru link greșit, expirat, folosit, înlocuit sau invalidat de lifecycle/email/admin, afișăm același mesaj:

> Linkul de resetare nu mai este valid. Solicită un link nou sau contactează administratorul.

Butonul este „Solicită un link nou”, către formularul forgot. Pagina nu afișează „cont dezactivat”, motivul exact, emailul asociat unui token invalid sau diferențe de răspuns care permit deducerea stării contului. Explicația este o decizie de protecție a informației: un link vechi sau transmis altcuiva nu trebuie să dezvăluie starea curentă a contului. Principiul răspunsurilor uniforme este susținut de [OWASP Forgot Password](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html); extinderea la motivele invalidării este decizia noastră.

Pentru forgot rămâne textul din #107:

> Dacă există un cont cu această adresă, vei primi un email cu instrucțiuni.

Nu raportăm public dacă emailul există, contul este activ, cooldown-ul s-a aplicat sau furnizorul a refuzat emailul. Validarea sintactică poate indica „Introdu o adresă de email validă”; aceasta nu depinde de existența contului. Indisponibilitatea serviciului la folosirea unui link se afișează separat ca eroare temporară, fără a declara tokenul invalid.

## 4. Cazurile de dezactivare și reactivare

| Caz | Comportamentul cerut |
| --- | --- |
| Contul este deja inactiv când cere resetarea | Același răspuns forgot; fără link și fără email. |
| Devine inactiv după lookup, înainte de generarea linkului sau înainte de predarea emailului | Eligibilitatea se revalidează. Dacă dezactivarea este deja efectivă, se omite trimiterea; un token creat între pași nu trebuie să poată fi folosit. |
| Emailul a fost deja predat furnizorului, apoi contul este dezactivat | Emailul poate sosi ulterior; nu îl putem retrage. Linkul este invalid și nu modifică parola, marcajul sau starea contului. |
| Deschide pagina validă, apoi este dezactivat înainte să salveze | Fluxul recovery se invalidează. Salvarea pe server este refuzată; câmpurile și credențialele tranzitorii sunt eliminate. Se afișează mesajul comun pentru link invalid. |
| Salvarea și dezactivarea sunt concurente | Există o ordine efectivă a mutațiilor, stabilită în DB. Dacă dezactivarea câștigă, parola nu se schimbă. Dacă resetarea câștigă, parola nouă rămâne, dar dezactivarea închide accesul și toate sesiunile. Nu se acordă acces după dezactivarea efectivă; un răspuns întârziat nu poate instala o sesiune care să ocolească această regulă. |
| Resetarea s-a terminat, apoi contul este dezactivat | Se aplică #105 tuturor sesiunilor, inclusiv celei create de recovery. |
| Dezactivarea blochează DB, dar sincronizarea Auth eșuează | Profilul inactiv refuză request, deschidere și salvare, chiar dacă Auth nu a aplicat încă ban-ul sau a păstrat un token. Retry-ul lifecycle nu revalidează linkuri vechi. |
| Reactivare în mai puțin de o oră, cu linkul vechi încă în email | Linkul vechi și formularul deschis anterior rămân invalide. Utilizatorul cere unul nou. |
| Reactivare urmată de forgot nou | Aceeași identitate și parola actuală; o cerere nouă poate crea un flux nou. Propunem resetarea cooldown-ului vechi la reactivare, astfel încât recuperarea să nu fie blocată de o cerere invalidată. |
| Mai multe cicluri activ/inactiv/activ sau retry-uri întârziate | Niciun ciclu nu restaurează tokenuri sau sesiuni dintr-o generație anterioară. |
| Alt ban Auth rămâne în vigoare după reactivarea profilului | Recovery nu acordă acces cât timp contul este blocat în Auth. is_active = true singur nu dovedește eligibilitatea. |

**Lipsa concretă din PR #117:** set_user_account_active() schimbă banned_until și șterge auth.sessions, dar nu revocă explicit tokenurile recovery neconsumate. Un asemenea token nu are încă sesiune de șters. Verificarea Auth refuză un utilizator banned, însă după scoaterea ban-ului tokenul poate redeveni utilizabil dacă nu a expirat. Acesta este un risc dedus din cod, nu un smoke demonstrat pe mediul țintă. [Sursele oficiale de verificare Auth](https://github.com/supabase/auth/blob/master/internal/api/verify.go) disting ban-ul și validitatea tokenului.

Invalidarea permanentă trebuie integrată în tranziția lifecycle și în starea controlată de aplicație. În Auth pot exista atât câmpuri legacy din auth.users, cât și rânduri în auth.one_time_tokens; nu presupunem că golirea unei singure coloane este suficientă pe toate versiunile. [Modelul oficial al tokenurilor](https://github.com/supabase/auth/blob/master/internal/models/one_time_token.go) confirmă această separare.

## 5. Problemele care cer schimbarea contractului tehnic din #107

**A. Recovery nu este o sesiune cu drepturi restrânse în arhitectura actuală.** SDK-ul salvează sesiunea și emite PASSWORD_RECOVERY. AuthProvider o tratează ca pe orice sesiune și poate încărca profilul, porni abonamente și afișa navigarea. Evenimentul este tranzitoriu; la refresh nu dovedește proveniența unui flux. Ascunderea navbarului sau un boolean în browser nu limitează accesul API/Data API. updateUser({ password }) poate fi folosit și cu o sesiune normală, deci simpla existență a unei sesiuni nu îndeplinește „numai din link”. [Supabase: fluxul de resetare](https://supabase.com/docs/guides/auth/passwords#resetting-a-password), [updateUser](https://supabase.com/docs/reference/javascript/auth-updateuser).

Direcția recomandată: finalizare recovery pe server, cu o dovadă dedicată fluxului, cu expirare și consum controlat. Nu returnăm browserului o sesiune Supabase utilizabilă înainte de succes. Dacă păstrăm generateLink, credențiala sa nativă rămâne protejată pe server în spatele unei dovezi opace a aplicației, ori folosim un mecanism echivalent care restricționează efectiv sesiunea pe toate suprafețele. Trimiterea action_link/hashed_token direct în email și consumarea lui în client nu satisface decizia confirmată. hashed_token este o credențială consumabilă prin Auth, chiar dacă numele conține „hash”.

O stare privată minimă a fluxului este justificată de expirare, invalidare, consum și retry; nu este motiv pentru un framework de workflow sau o migrare generală la SSR. Mecanismul concret trebuie demonstrat înainte să îi fixăm schema și pașii în plan.

**B. O oră pentru link nu limitează automat sesiunea obținută din el.** Tokenul nativ se consumă la verificare, înainte de schimbarea parolei; sesiunea rezultată poate dura și se poate reîmprospăta. Definim o oră pentru întregul drept de finalizare, de la emitere, măsurată pe server. La now >= expires_at salvarea este refuzată, chiar dacă pagina a fost deschisă la minutul 59. Refresh-ul, revenirea în pagină și retry-ul nu prelungesc termenul.

**C. Parola, marcajul, consumul, revocarea și auditul au nevoie de un rezultat coerent.** Secvența „updateUser în browser, PATCH profil, signOut, POST audit” poate lăsa o parolă schimbată cu must_change_password = true, audit lipsă sau acces vechi. Endpointul de finalizare trebuie să verifice identitatea din dovada recovery, contul activ și versiunea curentă a fluxului; un email/userId din body nu alege contul modificat. Ordinea în DB trebuie coordonată cu lifecycle, schimbarea emailului și resetarea adminului. Un check urmat de HTTP către Auth nu este o tranzacție comună și nu elimină cursa. Nici un advisory lock luat într-un RPC care se termină înaintea apelului Auth nu ține blocarea peste acel apel.

Nu fixăm în analiză un trigger sau un RPC care scrie parola în tabelele Auth fără demonstrație: lock order, hash-ul și schema Auth reală trebuie verificate. Contractul de produs este însă stabilit. Succesul este raportat numai când parola aleasă, must_change_password = false, consumul fluxului, invalidarea celorlalte recovery-uri, revocarea sesiunilor anterioare și auditul efectiv sunt confirmate. Dacă operația nu poate fi atomică, planul trebuie să precizeze stările parțiale, blocarea accesului, reconcilierea și retry-ul care nu schimbă încă o dată parola. Nu ascundem o stare parțială într-un „succes” sau „link invalid”.

**D. signOut({ scope: 'others' }) nu este singur garanția pentru JWT-uri deja emise.** Se reutilizează verificarea session_id introdusă de #105, inclusiv pentru RLS/Realtime/Storage. Identificarea sesiunii păstrate vine din fluxul verificat, nu din inputul browserului. Sursele Auth curente pot revoca deja celelalte sesiuni la update-ul parolei; demonstrăm comportamentul versiunii țintă înainte să adăugăm un al doilea mecanism redundant. [Supabase signOut](https://supabase.com/docs/reference/javascript/auth-signout), [sesiuni și JWT](https://supabase.com/docs/guides/auth/sessions#how-to-ensure-an-access-token-jwt-cannot-be-used-after-a-user-signs-out).

**E. Navigarea publică și identitatea browserului trebuie separate de identitatea recuperată.** AuthProvider trebuie să permită formularul forgot, pagina recovery și paginile de eroare fără sesiune normală. Un utilizator B deja logat poate deschide un link pentru A: formularul modifică numai A, iar B nu este schimbat sau deconectat înainte de confirmarea recuperării. La succes, instalarea sesiunii pentru A este explicită; profilul și cache-urile/abonamentele nu rămân ale lui B. Un link invalid nu modifică sesiunea existentă. Refresh/back/new tab sunt cazuri obligatorii. Nu migrăm automat la PKCE: schimbul PKCE standard depinde de browserul/dispozitivul care păstrează verifier-ul, ceea ce poate contrazice deschiderea emailului pe telefon. [Limitele PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow#limitations).

## 6. Contractul complet propus pentru request, link și finalizare

Acestea sunt recomandări pentru completarea #107, suplimentare deciziilor deja confirmate:

- Emailul este normalizat prin trim și comparație fără diferență între majuscule/minuscule, cu aceeași identitate canonică folosită de Auth. %, _ și backslash sunt date, nu wildcard-uri de lookup. Lipsa profilului, profiluri duplicate sau neconcordanța Auth/profil produc refuz sigur și diagnostic intern, fără alegerea arbitrară a unui cont.
- Cererea inițială nu schimbă parola, nu modifică marcajul temporar și nu închide sesiunile curente. Un atacator care cunoaște emailul nu trebuie să poată deloga utilizatorul doar apăsând forgot.
- Limita de 15 minute se rezervă atomic în DB, pe cont/adresa canonică, cu ceasul DB. Două cereri concurente nu pot trimite două emailuri. La limita exactă de 15 minute se permite o cerere nouă. Propunem ca invalidarea prin lifecycle/email/admin să închidă și rezervarea vechii generații: după reactivare, schimbarea emailului sau resetarea adminului se poate cere un link nou imediat, dacă acel cont este eligibil. O simplă cerere forgot nu primește această excepție.
- Cererile respinse de cooldown nu rotesc și nu invalidează linkul curent. O cerere nouă acceptată îl înlocuiește și invalidează inclusiv un formular vechi deja deschis: numai cel mai recent flux eligibil poate finaliza.
- La un eșec cert de generare/trimitere, cererea nu primește succes intern; cooldown-ul se poate elibera condiționat numai dacă aparține încă acelei încercări. Un retry nu poate elibera claim-ul unei cereri mai noi. Linkul vechi deja invalidat nu este restaurat dacă emiterea noului link eșuează; următoarea încercare creează unul nou. La timeout cu rezultat de livrare necunoscut se păstrează aceeași încercare și se folosește idempotency pentru predare; nu se generează un token nou pentru fiecare retry.
- Încercările de generare, livrare și retry sunt legate de UUID-ul contului și de versiunea curentă a fluxului. Rezultatul unui apel extern întârziat este revalidat înainte de publicare. O încercare veche nu poate deveni din nou curentă, reactiva un link după lifecycle sau suprascrie credențiala unui flux mai nou în Auth. Ultimul caz trebuie demonstrat explicit dacă se păstrează generateLink, deoarece verificarea stării aplicației după apel nu repară automat efectul deja produs în Auth.
- Un email deja acceptat, întârziat, bounced sau ajuns în spam nu poate fi garantat în inbox. Formularul păstrează răspunsul public comun; diagnosticul intern distinge stările. Expirarea pornește de la emitere, nu de la momentul citirii emailului.
- Uniformitatea răspunsului include timpul, statusul, body-ul și header-ele. Așteptarea Resend numai pentru conturi eligibile poate dezvălui existența/starea contului chiar cu text generic; un delay aleatoriu nu rezolvă singur diferența după mai multe probe. Planul trebuie să separe sau să controleze latența predării emailului și să verifice distribuția răspunsurilor pentru cazurile existente/inexistente/inactive/cooldown.
- GET-ul paginii și scanarea automată a linkului nu consumă recovery și nu creează sesiune normală. Consumul are loc prin acțiune explicită de salvare, după validarea celor două parole. Scanerele de email pot consuma linkurile native de verificare; acesta este un risc documentat de [Supabase Email Templates](https://supabase.com/docs/guides/auth/auth-email-templates#email-prefetching). Dezactivăm tracking-ul pentru aceste linkuri.
- Parolele trebuie să coincidă și să respecte minimul de 6 caractere din cerință. Nu le aplicăm trim și nu le schimbăm caracterele. Lungimea și regulile reale din Supabase se verifică pe toate mediile; o parolă identică celei curente se tratează prin eroare controlată dacă Auth o refuză, fără marcaj șters sau succes fals.
- Accesarea directă fără dovadă recovery trimite la login sau arată intrarea către forgot; un token prezent dar inutilizabil afișează mesajul comun, chiar dacă browserul are altă sesiune validă.
- Salvarea dublă, două taburi sau două dispozitive care folosesc același link permit o singură finalizare. Un retry după pierderea răspunsului recunoaște rezultatul încercării fără să redeschidă tokenul pentru o a doua parolă. Reconstituirea rezultatului nu transformă tokenul folosit într-o cale repetabilă de login.
- La succes, rolul și permisiunile se citesc din profilul curent. Linkul nu restaurează rolul din momentul emiterii și nu reactivează contul. Sesiunea păstrată/creată este verificată din nou înainte de acordarea accesului normal.
- Dacă auto-login sau instalarea sesiunii în browser eșuează după resetarea confirmată, parola rămâne schimbată. UI spune „Parola a fost schimbată. Autentifică-te cu noua parolă.”, fără refacerea operației. Dacă între timp contul a devenit inactiv, accesul rămâne blocat.
- Emailul de confirmare pornește numai după schimbarea confirmată, este în română și nu conține parola sau tokenuri. Eșecul său nu inversează resetarea; se consemnează rezultatul livrării și UI nu afirmă că parola a eșuat. Destinatarul se revalidează înainte de predare: dacă între timp contul este inactiv, se omite conform #105; o predare deja începută poate sosi ulterior.
- Regula publică de 15 minute are nevoie și de o limită de volum pe IP/serviciu, care nu depinde de existența contului. Pragul se fixează în plan conform mecanismului disponibil; nu introducem captcha. Pentru limita per adresă păstrăm răspunsul generic. Rate-limit-urile Supabase nu trebuie presupuse ca aplicându-se endpointului Next.js care folosește generateLink admin. [Supabase Rate limits](https://supabase.com/docs/guides/auth/rate-limits).
- Se verifică și suprafața publică nativă Auth: /recover, verificarea tokenurilor și eventualele metode alternative de login. Cerințele de dezactivare, email în română, limită și acces numai după salvare nu pot fi ocolite printr-un endpoint nativ rămas configurat cu alt comportament. Soluția se alege pe configurația reală; un guard numai în pagina React nu acoperă acest caz.

OWASP preferă login-ul normal după resetare pentru a reduce complexitatea sesiunilor. #107 cere explicit intrare directă, pe care o păstrăm, cu condițiile de mai sus; nu prezentăm acest comportament ca recomandarea OWASP. [Sursa](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html#user-resets-password).

## 7. Audit și integrarea cu ștergerea din #105

- Cererea forgot este anonimă: actorId = null, ținta poate fi UUID-ul contului găsit. Nu atribuim cererea titularului doar fiindcă cineva i-a introdus emailul. IP-ul și user-agent-ul nu dovedesc identitatea.
- Schimbarea efectivă are identitate dovedită prin recovery. Evenimentul include contul, operația, sursa self_recovery, IP/user-agent și momentul, fără credențiale. Este scris de server din rezultatul real, nu la declarația clientului.
- Propunem evenimente distincte pentru cerere și finalizare, de exemplu password_reset_requested și password_reset_completed, cu entity_type = user. Stările skipped/rate-limited/send-failed/confirmation-skipped rămân identificabile în payload-uri sigure și nu generează un audit fals de parolă schimbată. Cererile anonime pentru adrese fără cont nu necesită stocarea în auditul de business a tuturor adreselor arbitrare introduse; diagnosticăm volumul fără a crea identități sau retenție inutilă.
- Catalogul, filtrele, tipurile și prezentarea auditului trebuie să recunoască aceste evenimente. Sanitizarea existentă nu acoperă automat token_hash, hashed_token, action_link sau un secret interpolat într-un text de eroare; nu trimitem asemenea valori la logger.
- Excepția de ștergere din #105 se extinde **precis** pentru finalizarea propriei recuperări, actorul și ținta fiind același UUID și tipul user. Resetarea administrativă asupra altui cont și orice acțiune de business a autorului rămân blocante. Evenimentele anonime cu contul numai ca țintă păstrează regula existentă.
- Starea/tokenurile recovery sunt date operaționale tranzitorii. Un cont fără date de business nu trebuie să devină imposibil de șters doar pentru că are un link în așteptare. Ștergerea elimină/invalidează această stare în tranzacția relevantă și păstrează auditul istoric.
- După ștergere, linkurile vechi nu pot recupera un cont nou creat cu același email. Dovada se leagă de UUID/generație, nu numai de adresă.

## 8. Protecția secretelor și configurarea

Linkul folosește numai originea validată din NEXT_PUBLIC_APP_URL, cu HTTPS în preview/producție. Nu acceptă un redirectTo sau host ales de solicitant. Se verifică URL-urile permise, inclusiv diferența localhost/127.0.0.1; configurația locală are acum site_url = http://127.0.0.1:3000, dar additional redirect include numai o variantă HTTPS.

otp_expiry = 3600, minimum_password_length = 6, password_requirements = '' și secure_password_change = false sunt valorile locale curente. Nu dovedesc setările proiectului hosted. Modificarea config.toml nu actualizează automat dashboardul hosted; configurarea și verificarea mediului țintă sunt condiții de livrare. Termenul propriu al fluxului trebuie respectat chiar dacă o sesiune Auth este încă validă.

Pagini și răspunsuri recovery: fără cache partajat; fără tokenuri în analytics, mesaje de eroare, audit, request/response logs sau URL-uri trimise unor terți. Secretul se elimină din bara de adresă când poate fi păstrat în siguranță pentru continuarea fluxului; se evită query-uri care ajung în access logs, iar referrer-ul este restricționat. Nu se persistă parola. Pentru cookie-uri de flux se asigură protecția împotriva cererilor cross-origin; dovezile recovery nu autorizează alte endpointuri. Acestea sunt proprietăți verificabile ale implementării, nu doar o listă de chei redactate.

Override-ul Resend se aplică atât linkului, cât și confirmării. Mediul Resend și proiectul Supabase trebuie să coincidă; un recovery pentru identitatea din producție nu este trimis la inboxul comun de test printr-un preview. Nu păstrăm secrete native în profiles ori în răspunsuri select('*').

Linkurile Storage deja semnate rămân valabile până la expirare, ca în limita acceptată în #105. Închiderea sesiunilor nu retrage documente descărcate sau URL-uri semnate deja emise; blochează operațiile noi autentificate.

## 9. Matricea suplimentară de recepție

Matricea de lifecycle din secțiunea 4 se aplică tuturor rolurilor. Următoarele cazuri se adaugă criteriilor existente din #107:

| ID | Scenariu | Rezultat de verificat |
| --- | --- | --- |
| R01 | Client, consultant junior/senior, admin activ | Același flux, fără privilegii suplimentare din recovery. |
| R02 | Email inexistent, inactiv, profil lipsă, Auth banned | Același răspuns public; fără email eligibil. |
| R03 | Spații, majuscule, wildcard-uri, JSON invalid și corp prea mare | Validare sigură, lookup exact, fără token pentru alt cont. |
| R04 | Auth și profil au emailuri diferite sau date duplicate | Refuz sigur și diagnostic intern; nu se alege primul rezultat. |
| R05 | Cereri simultane și la 14:59 / 15:00 | O singură rezervare în fereastră; noua cerere este permisă la limită. |
| R06 | Cerere în cooldown, apoi cerere nouă acceptată | Prima păstrează linkul curent; a doua îl înlocuiește, inclusiv în formularul vechi. |
| R07 | Token absent, alterat, de alt tip, expirat, folosit sau invalidat | Fără schimbare; mesaj comun și cale spre forgot. |
| R08 | Link folosit pe alt browser/dispozitiv | Funcționează până la expirare fără dependență de browserul solicitării. |
| R09 | Scaner email, prefetch și simpla deschidere GET | Nu consumă linkul, nu schimbă parola, nu acordă acces normal. |
| R10 | Deschidere la minutul 59, salvare după minutul 60 | Salvare refuzată; sesiunea/refresh-ul nu extind dreptul recovery. |
| R11 | Refresh/back/tab în timpul formularului | Continuarea sigură respectă aceeași expirare; fără redirect accidental la login și fără acreditare dintr-o sesiune normală. |
| R12 | Acces direct cu sesiune normală, fără link | Nu oferă un nou ecran de schimbare a parolei și nu acceptă finalizarea recovery. |
| R13 | Contul B este logat, linkul aparține lui A | Numai A poate fi recuperat; B rămâne neatins înainte de succes; cache și profil corecte după schimbarea sesiunii. |
| R14 | Parole diferite, sub 6 caractere, cu spații, identice celei actuale | Validare corectă; fără trim; fără consum definitiv/succes fals la eroare de parolă. |
| R15 | Dublu submit, taburi/dispozitive concurente | O finalizare și un audit efectiv; nicio a doua parolă cu aceeași dovadă. |
| R16 | Marcaj temporar true și false | La succes este false; la refuz/eșec fără schimbare rămâne valoarea anterioară. |
| R17 | Sesiuni vechi, inclusiv token copiat și Realtime deja conectat | Acces nou refuzat pe API/Data API/RPC/Storage cu JWT/Realtime, cu limita URL-urilor semnate documentată. |
| R18 | Schimbare email înainte de folosire sau în formular | Link și flux vechi invalide; numai noua adresă poate primi un recovery nou. |
| R19 | Email A→B→A sau adresă reutilizată de un UUID nou | Linkul original nu redevine valid. |
| R20 | Resetare admin înainte de folosire sau în formular | Recovery vechi invalid; parola temporară și marcajul din #108 nu sunt suprascrise de el. |
| R21 | Recovery nou după resetarea adminului | Link nou valid; la succes parola aleasă înlocuiește parola temporară și golește marcajul. |
| R22 | Schimbarea rolului între emitere și succes | Permisiunile provin din profilul curent, fără snapshot de rol restaurat. |
| R23 | Ștergere definitivă înainte de folosire sau în formular | Nicio recuperare/creare implicită; audit istoric păstrat. |
| R24 | Resend lipsă/refuz/timeout/bounce și email întârziat | Răspuns public comun; retry/idempotency/cooldown conforme; nicio parolă trimisă ca fallback. |
| R25 | Auth/DB indisponibil la verificare sau salvare | Eroare temporară controlată; fără succes fals și fără sesiune normală prematură. |
| R26 | Eșec audit, marcaj, revocare sau consum la finalizare | Rollback ori stare parțială sigură, explicită; retry nu permite o resetare suplimentară cu token consumat. |
| R27 | Timeout/crash după schimbare, înainte de răspuns | Rezultatul poate fi reconstituit sigur; utilizatorul nu este trimis într-o buclă de resetări. |
| R28 | Auto-login/instalarea sesiunii eșuează după succes | Noua parolă rămâne; fallback către login, fără repetarea resetării. |
| R29 | Confirmarea email eșuează sau destinatarul devine inactiv | Parola nu este inversată; livrarea eșuată/omisă este consemnată. |
| R30 | Bypass prin API Auth nativ sau body cu alt userId | Nu ocolește regulile de eligibilitate, consum, destinatari și acces. |
| R31 | Timing, status, body, headers, limitare IP | Nu permit diferențierea conturilor după existență/stare/cooldown; se măsoară mai multe probe, nu un singur răspuns. |
| R32 | Audit anonim vs actor dovedit; cont cu numai recovery | Autor corect; ștergerea contului fără business permisă conform deciziei, fără pierdere de audit. |
| R33 | Local/preview/production, allowlist și override | Origine, proiect Auth, expirare, expeditor și destinatar corecte; fără livrare accidentală către adrese reale. |
| R34 | Loguri, analytics, HTML/email și accesibilitate | Fără secrete; escaping; tastatură/focus, autofill new-password, erori anunțate accesibil și mobil utilizabil. |
| R35 | generateLink/livrare/retry vechi terminat după un flux nou sau după lifecycle | Nu restaurează linkul vechi, nu suprascrie fluxul curent și nu eliberează cooldown-ul lui; eșecul emiterii noi nu revalidează credențialele anterioare. |

Nu toate rândurile cer teste separate. Se refolosește infrastructura node:test și Playwright existentă, plus verificările lifecycle din PR #117; cazurile de concurență, rollback și bypass au nevoie de teste de integrare pe Auth/DB real local, nu doar de mock-uri React.

## 10. Completările de dus în issue-uri și ce rămâne de demonstrat

În **#107** trebuie înlocuită implementarea exclusiv în browser cu contractul de finalizare pe server, adăugate regulile de invalidare și expirare pentru întregul flux, mesajul comun, matricea de lifecycle, concurența, recovery multiplu, eșecurile parțiale, auditul și revocarea efectivă. Descrierea trebuie să spună că password_reset_requested_at există deja și că marcajul temporar este livrat prin #103/PR #116.

În **#105 / PR #117** se integrează invalidarea permanentă a recovery-urilor și excepția precisă de audit pentru propria resetare, plus eliminarea stării recovery la ștergerea contului eligibil. Reactivarea păstrează parola actuală și nu restaurează linkuri sau sesiuni vechi. Extensia trebuie să păstreze comportamentul sigur în cazul auth_sync_pending.

În **#106** și **#108** se adaugă contractul comun de invalidare a linkurilor și a fluxurilor deja deschise, inclusiv concurența cu finalizarea recovery. În #106 schimbarea emailului prin doi pași HTTP cu compensare nu este atomicitate DB; nu bazăm coordonarea recovery pe o asemenea promisiune neverificată.

Înainte să fixăm mecanismul în plan trebuie demonstrate pe versiunile efective: (1) nicio sesiune normală înainte de salvare, (2) invalidare nereversibilă la lifecycle/email/admin, (3) ordinea resetare/dezactivare și rollback/reconciliere, (4) revocarea JWT și refresh pe toate suprafețele, (5) retry după pierderea răspunsului, (6) configurația endpointurilor native și a expirării. Acestea sunt dovezi tehnice încă necesare, nu decizii de produs rămase fără răspuns.

Documentul consemnează cele trei decizii confirmate și recomandările suplimentare, acceptate ulterior de utilizator la 7 octombrie 2026. Actualizarea autorizată a descrierilor și comentariilor GitHub este consemnată mai jos; dovezile tehnice rămân de realizat.

## 11. Actualizarea contractelor GitHub — 7 octombrie 2026

După aprobarea utilizatorului au fost actualizate direct descrierile și adăugat câte un comentariu scurt pentru trasabilitate:

| Issue | Contract actualizat | Comentariu |
| --- | --- | --- |
| [#107](https://github.com/DominteEmanuelBeniamin/platforma-fonduri/issues/107) | Fluxul complet, mesajele, accesul după salvare, 11 cazuri lifecycle și 35 suplimentare, audit și dovezile încă necesare. | [Decizii acceptate](https://github.com/DominteEmanuelBeniamin/platforma-fonduri/issues/107#issuecomment-6033579488) |
| [#105](https://github.com/DominteEmanuelBeniamin/platforma-fonduri/issues/105) | Invalidare permanentă la lifecycle, auth_sync_pending, excepția exactă pentru resetarea proprie și cleanup-ul stării operaționale. | [Integrare lifecycle](https://github.com/DominteEmanuelBeniamin/platforma-fonduri/issues/105#issuecomment-6033579887) |
| [#106](https://github.com/DominteEmanuelBeniamin/platforma-fonduri/issues/106) | Invalidarea la schimbarea emailului, concurența, livrarea către activi și demonstrarea coerenței Auth/profil. | [Integrare email](https://github.com/DominteEmanuelBeniamin/platforma-fonduri/issues/106#issuecomment-6033580276) |
| [#108](https://github.com/DominteEmanuelBeniamin/platforma-fonduri/issues/108) | Invalidarea la resetarea adminului, toate sesiunile, concurența, retry-ul și auditul distinct de propria recuperare. | [Integrare resetare admin](https://github.com/DominteEmanuelBeniamin/platforma-fonduri/issues/108#issuecomment-6033580678) |

Descrierea [PR #117](https://github.com/DominteEmanuelBeniamin/platforma-fonduri/pull/117) a fost aliniată: **Closes #105** a devenit **Refs #105**, astfel încât să nu închidă automat un issue încă incomplet. Sunt enumerate criteriile recovery încă neîndeplinite și responsabilitățile #105/#107/#106/#108. Head-ul rămâne 2471801629dbd444980f0f38b4493b6d89136a4e.

Toate cele patru descrieri, cele patru comentarii și descrierea PR au fost recitite din GitHub și comparate cu textele pregătite. Titlurile, starea, milestone-ul, etichetele și asignările issue-urilor sunt păstrate; PR-ul păstrează titlul, starea și commiturile. Verificările istorice din #105 sunt păstrate, iar noile criterii sunt nebifate.

Această etapă actualizează documentația și contractele. Următorul pas este validarea tehnică pe Auth/DB real, apoi planul final de implementare. Nu au fost efectuate mutații Auth/DB, trimiteri Resend sau modificări în implementarea aplicației în această etapă.


## 12. Dovezile locale — 7 octombrie 2026

Verificarea cerută după pornirea Docker și npm run dev este consemnată în [raportul fazei 0](issue-107-phase0.md) și [rezultatele fără credențiale](issue-107-phase0-results.json). Au trecut 31/31 probe Auth/DB și 1/1 probă E2E existentă pentru API/Data API/RPC/Storage/Realtime.

Pe Auth v2.197.0, au fost confirmate runtime revenirea linkului neconsumat după reactivare, accesul normal înainte de salvare și bypass-ul schimbării parolei prin Auth la auth_sync_pending. Schimbarea emailului prin API-ul admin invalidează deja linkul neconsumat, dar nu și sesiunea recovery deschisă. Resetarea adminului revocă deja tokenurile și sesiunile native pe această versiune.

Mecanismul demonstrat local este un secret opac al aplicației, stare privată și finalizare atomică în DB, urmată de login verificat. Nu necesită generateLink; un Send Email Hook poate suprima livrarea credențialelor native. Au fost probate rollback-ul auditului, concurența în ambele ordini cu lifecycle, cooldown-ul atomic, retry-ul fără a doua parolă/login, expirarea după așteptarea lock-ului și ștergerea cu email reutilizat.

Prototipul nu este implementarea #107. Planul final trebuie să precizeze retenția separată a rezultatelor finalizate, invalidarea credențialelor native existente la activare și verificarea configurației hosted. SQL-ul Auth a fost validat numai pentru schema, bcrypt și configurația locală testată. Bifele de recepție rămân nebifate.


Dovezile locale au fost adăugate și recitite din descrierile #105/#106/#107/#108 și PR #117; criteriile de recepție rămân nebifate. Comentariu: https://github.com/DominteEmanuelBeniamin/platforma-fonduri/issues/107#issuecomment-6035208852.

Verificarea căii native include și un adaptor DB: credențialele generate pentru recovery/magiclink nu sunt persistate și sunt refuzate atât ca hashed_token, cât și ca email OTP. Hook-ul singur blochează doar livrarea. Protecția finală trebuie să acopere toate conturile aplicației, independent de retenția stării private.


## Implementarea nativă finală

Adaptorul final acoperă și auth.flow_state, separat de tokenurile legacy și one_time_tokens. Codurile PKCE recovery/magiclink au emis sesiuni în controalele pozitive locale cu adaptorul dezactivat; după activare, aceleași coduri nu emit credențiale. Prima metodă AMR cere password, iar MFA suplimentar rămâne disponibil după parolă. Activarea prin Data API și cazul cererii native deja în curs au fost probate. Finalizarea șterge codurile legate prin user_id și linking_target_id, în aceeași tranzacție cu parola și auditul. Detaliile și dovezile 21/21 sunt în [raportul implementării](issue-107-implementation.md).

Programarea la minut este separată de Vercel Hobby, care permite doar cron zilnic: se folosește Supabase Cron pentru dispatch, iar preflight-ul cere RECOVERY_DISPATCH_EVERY_MINUTE_CONFIGURED=true numai după verificarea jobului real. Cronul zilnic existent rămâne în vercel.json. Configurarea hosted este descrisă în [rollout](issue-107-rollout.md), fără activare în acest task.
