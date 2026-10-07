# Issue #107 — dovezi locale înaintea planului de implementare

Raport istoric, anterior implementării. Pentru recepția codului final vezi [issue-107-implementation.md](issue-107-implementation.md) și scripts/issue-107-check.mjs. Probele de mai jos refuză rularea cu recovery activ.

Data: 7 octombrie 2026. **31/31 probe Auth/DB au trecut, plus 1/1 probă E2E existentă din #105.** Unele probe confirmă intenționat lipsuri ale implementării curente; numărul nu înseamnă că #107 este implementat sau recepționat.

Mecanismul verificat local: **secret aleatoriu al aplicației, stare privată, finalizare într-o singură tranzacție DB și login numai după commit**. Un Send Email Hook oprește livrarea linkurilor native; adaptorul DB verificat le face inutilizabile. Loginul cu parolă rămâne funcțional. Nu sunt necesare biblioteci noi sau migrarea generală la SSR.

## Mediul și limitele probei

| Componentă | Versiune/stare verificată |
| --- | --- |
| Auth local | supabase/gotrue v2.197.0 |
| PostgreSQL | 17.6, imagine Supabase 17.6.1.171; pgcrypto prezent |
| SDK instalat | @supabase/supabase-js și auth-js 2.90.0 |
| Next.js instalat | 16.3.5; server separat pe 127.0.0.1:3107 |
| Baza lifecycle | migrările #105 până la 20261006080652, deja prezente local |
| Cod API testat | PR #117, head 2471801629dbd444980f0f38b4493b6d89136a4e |
| Checkout utilizator | main, 2257075648b67bbffa687653a4525ee816b073b5; serverul de pe 3000 păstrat |
| Emailuri native în probele de bază | numai Mailpit local, către conturi temporare @example.invalid |
| Probe hook | a doua instanță Auth, același tag, port 3108; serviciul Auth existent nu a fost restartat |

Probe reproductibile: scripts/issue-107-phase0.mjs și scripts/issue-107-atomic-probe.sql. Rezultate fără credențiale: docs/issue-107-phase0-results.json.

Prototipul SQL este instalat temporar într-o schemă privată, apoi eliminat. **Nu este o migrare și nu reprezintă implementarea aplicației.** Nu au fost schimbate paginile, endpointurile sau codul PR-ului.

## Ce face deja Auth și unde nu ajunge

| Verificare reală | Rezultat observat | Consecință pentru plan |
| --- | --- | --- |
| generateLink + verifyOtp recovery, fără salvarea parolei | JWT cu amr=otp; /api/me=200, profil citibil prin Data API, garda sesiunii=true | Nu trimitem browserului credențiala nativă. PASSWORD_RECOVERY/ascunderea navigării nu restricționează accesul. |
| Link nefolosit → dezactivare → încercare → reactivare | Refuz user_banned cât timp este inactiv; același link funcționează după reactivare | Invalidarea permanentă trebuie adăugată în #105. |
| Sesiune recovery deschisă → dezactivare/reactivare | JWT vechi refuzat de API, RPC=false, refresh refuzat | Baza de revocare din #105 funcționează pentru sesiuni existente. |
| updateUser(password) din recovery | Celelalte sesiuni/refresh-uri revocate; sesiunea curentă păstrată | Nu adăugăm signOut(others) redundant ca explicație a revocării native. Tranzacția finală trebuie însă să includă toate stările aplicației. |
| JWT copiat după revocare | API și garda DB refuză; getUser(jwt) îl refuză și el pe versiunea locală | Data API/RLS/Realtime/Storage păstrează garda session_id; nu generalizăm comportamentul getUser la orice versiune hosted. |
| Token neconsumat mai vechi de o oră | Refuzat | Expirarea nativă a tokenului funcționează. |
| Sesiune deschisă, timpul emiterii/creării îmbătrânit peste 61 minute | Refresh real acceptat, același session_id; parola poate fi schimbată | Dreptul aplicației de finalizare trebuie să expire separat. Proba avansează timestampurile DB, fără o așteptare de 61 minute. |
| Link nativ nou | Cel vechi refuzat, cel nou valid | Rotirea nativă există, dar nu rezolvă starea deschisă și predările externe întârziate. |
| Resetare admin nativă | Linkul neconsumat și toate sesiunile vechi revocate | Marcajul, starea privată, auditul și concurența încă au nevoie de coordonarea comună. |
| Email A→B→A prin API admin Auth | Linkul nativ vechi rămâne invalid | Această invalidare nativă este deja disponibilă pe versiunea testată. |
| Email schimbat după deschiderea recovery | Sesiunea veche rămâne activă și poate schimba parola | #106 trebuie să invalideze și fluxurile deschise, nu doar tokenul neconsumat. |
| Verificare profil activ → dezactivare → apel HTTP admin password update | Apelul schimbă parola contului banned; noua parolă funcționează după reactivare | Check-ul urmat de HTTP nu garantează ordinea resetare/dezactivare. |
| Eroare injectată la ban-ul Auth | Profil inactiv, auth_sync_pending=true; native verifyOtp și updateUser(password) încă reușesc, garda aplicației=false | Starea privată trebuie invalidată în tranzacția profilului, fără dependență de reușita sincronizării Auth. |
| Endpointuri publice native /recover și /otp | Acceptă cereri direct | Fluxul nou trebuie să închidă calea de livrare a credențialelor native. |
| Parolă identică / peste 72 bytes UTF-8 | same_password / validation_failed | Validare controlată, fără trim și fără trunchiere. Limita este în bytes, nu 72 caractere Unicode. |
| Audit password_reset_completed, autor=țintă, source=self_recovery | Este blocant în user_account_blockers actual | #105 trebuie extins cu excepția exactă pentru resetarea proprie. |

Proba E2E existentă a trecut: **deactivation keeps data, revokes API/REST/RPC/Storage and open realtime channels**. A verificat și canalul Realtime deschis înainte de dezactivare, păstrarea datelor și refuzul de a crea noi URL-uri Storage. Limita URL-urilor Storage deja semnate rămâne cea acceptată în #105.

## Ce a demonstrat prototipul tranzacțional

1. Secretul aplicației are 32 bytes aleatorii; DB păstrează doar SHA-256. Nu poate fi schimbat prin verifyOtp nativ în sesiune Auth. Emiterea și verificarea stării nu creează o sesiune normală.
2. Hash-ul bcrypt produs prin pgcrypto, cost 10, este acceptat de loginul Auth local. O parolă cu spații la extremități și caractere Unicode a fost păstrată exact.
3. Parola, must_change_password=false, consumul, ștergerea tokenurilor native, revocarea sesiunilor și auditul propriu se confirmă în aceeași tranzacție. După commit se poate crea o sesiune nouă prin login cu parola aleasă.
4. O eroare reală injectată înaintea inserării auditului face rollback inclusiv pentru parola deja scrisă, marcaj, sesiuni și tokenuri. Retry-ul ulterior reușește.
5. Două finalizări concurente produc un singur commit și un singur audit. Retrimiterea aceleiași încercări dă numai o chitanță de rezultat; nu schimbă parola și nu creează o sesiune.
6. Două rezervări concurente produc un issued și un cooldown. Cooldown-ul nu rotește secretul curent. La 15 minute se poate emite altul; numai cel mai recent poate finaliza.
7. Termenul este verificat cu ceasul DB după obținerea blocărilor. O salvare începută înainte de expirare, dar blocată până după expirare, este refuzată.
8. Dezactivarea/reactivarea, email A→B→A și invalidarea explicită a resetării adminului nu restaurează fluxul vechi. Generația invalidată își pierde și cooldown-ul.
9. Dacă dezactivarea obține prima blocarea #105, finalizarea nu schimbă parola și nu inserează audit de succes. Dacă finalizarea câștigă, schimbarea rămâne auditată, iar dezactivarea ulterioară blochează loginul.
10. La auth_sync_pending, dovada privată rămâne invalidă inclusiv după reactivare; parola nu se schimbă. Se poate cere imediat un flux nou.
11. Dacă resetarea s-a confirmat, apoi dezactivarea pierde sincronizarea ban-ului, Auth poate încă emite un JWT prin login. Verificarea aplicației după acest login îl refuză: API=401 și RPC=false. Serverul trebuie să facă această verificare înainte să instaleze/returneze sesiunea browserului.
12. O parolă nulă, prea scurtă, identică sau peste limita UTF-8 nu consumă dovada și nu modifică stările.
13. Ștergerea contului eligibil elimină starea privată prin FK; același email atribuit ulterior altui UUID nu revalidează secretul vechi.
14. Rolul authenticated nu poate citi schema privată. Extensia precisă a blockerului pentru propria resetare permite ștergerea și păstrează auditul. Modificarea funcției reale a fost testată într-o tranzacție încheiată prin ROLLBACK.
15. În instanța Auth separată, Send Email Hook PostgreSQL primește recovery și magiclink, întoarce succes fără livrare și produce **zero emailuri SMTP**. /recover pentru activ, inactiv și inexistent a răspuns 200; /otp a răspuns 200. Loginul cu parolă a răspuns în continuare 200.

Blocările folosesc aceeași ordine ca #105: advisory transaction lock (105,1), profiluri, rând Auth, stare privată. Nu există un apel HTTP extern ținut sub acel lock. Resetarea adminului invalidează explicit, independent de o schimbare false→true a marcajului; un trigger numai pe marcaj nu ar acoperi resetările repetate.

## Mecanismul de luat în plan și condițiile lui

- Requestul public emite un secret opac al aplicației și rezervă atomic cooldown-ul. Nu este necesar generateLink pentru această variantă; dispar efectele unui generateLink întârziat care ar suprascrie tokenul nativ curent.
- Emailul Resend conține numai linkul aplicației. Verificarea/GET-ul nu consumă dovada și nu creează sesiune. Pagina invalidă folosește mesajul comun acceptat, fără a spune că acel cont este dezactivat.
- Finalizarea este un RPC de server cu acces restrâns, care identifică ținta exclusiv din dovadă și confirmă coerent toate mutațiile. Wrapper-ul Data API, validarea HTTP, cookie/CSRF și pagina rămân de implementat; prototipul a folosit SQL local și rolul service_role.
- Loginul și emailul de confirmare sunt după commit. Sesiunea obținută se verifică din nou; o eroare la login nu inversează parola și nu repetă finalizarea.
- #105, #106 și #108 participă la aceeași invalidare și ordine a mutațiilor. Nu se încearcă o tranzacție comună prin două apeluri HTTP cu compensare. Proba A→B→A validează invalidarea; mutația completă #106 trebuie să reproducă și efectele asupra identităților Auth și unicitatea, care nu au fost implementate de acest prototip.

**Scrierea parolei în Auth folosește schema internă și formatul hash al versiunii testate.** #105 scrie deja ban-ul/sesiunile în Auth, deci se păstrează modelul existent de compatibilitate verificată. Totuși, validarea locală nu dovedește compatibilitatea unui proiect hosted cu altă versiune, DB encryption sau politici suplimentare. Planul trebuie să includă preflight și refuz sigur pe o configurație incompatibilă; nu se copiază necondiționat SQL-ul experimental.

Prototipul păstrează numai un flux curent per cont. **Schema finală trebuie să păstreze separat rezultatul încercării finalizate**, pentru retry după pierderea răspunsului chiar dacă între timp s-a emis o generație nouă. Rezultatul nu conține o sesiune reutilizabilă. Nu confundăm proba de idempotence locală cu implementarea completă a retenției rezultatelor.

Hook-ul oprește livrări noi; adaptorul DB împiedică persistarea credențialelor native noi. **Activarea lor nu anulează automat credențiale sau sesiuni native emise anterior**. Planul de activare include invalidarea acestora și verificarea că nici un link legacy nu poate redeschide accesul. Setările de signup/email providers și căile administrative de generateLink se verifică explicit pe mediul țintă.

## Ce rămâne pentru implementare și livrare

Acestea au contractul clar și nu cer alte decizii de produs:

- Integrarea completă în API/UI și audit-catalog; matricea din #107, inclusiv B logat/link A, refresh/back/dispozitive, scanere, accesibilitate și erori.
- Predarea Resend, rezultat necunoscut la timeout, idempotency și destinatari revalidați. Proba nu a trimis emailurile viitorului endpoint #107.
- Răspunsul public uniform și măsurarea distribuției de latență; limita IP și lipsa contului nu sunt demonstrate de simplul status 200 al Auth.
- Configurația hosted/preview: versiunea Auth, format/encryption hash, politicile parolei, hook, allowlist, origine HTTPS, expeditor și override. Nu au fost efectuate scrieri în hosted.
- Regresia completă pe endpointurile și schema finale, plus dovada că logurile/analytics nu captează secretul sau parola.

Putem construi planul de implementare pe mecanismul verificat local, cu aceste verificări explicite. Bifele de recepție ale funcționalității nu se completează pe baza prototipului.

## Reproducere și cleanup

Serverul trebuie să ruleze codul PR #117 sau o versiune care include gărzile sale, pe același Supabase local dedicat. Fișierul .env.e2e.localdb declară explicit E2E_WRITES=1 și E2E_TEST_PROJECT=1; scriptul refuză hosturi nelocale.

~~~powershell
$env:E2E_ENV_FILE='.env.e2e.localdb'
$env:ISSUE107_BASE_URL='http://127.0.0.1:3107'
$env:ISSUE107_ATOMIC='1'
node scripts/issue-107-phase0.mjs
~~~

Filtrul ISSUE107_ONLY permite rerularea unei probe, de exemplu native_email_hook. Numele schemei și al containerului de probă trebuie să fie libere; nu se preiau resurse existente. Rularea completă nu necesită Resend și nu livrează către adrese reale.

La verificarea finală: schema temporară absentă, zero funcții/triggere issue107_probe, zero conturi Auth issue107.*@example.invalid, containerul hook eliminat. Auditul este păstrat. Nu s-a schimbat istoricul migrărilor. Suita #105 păstrează conturile de test cu istoric conform cleanup-ului ei, dezactivate; nu am ocolit politica ei de ștergere.

Modificările utilizatorului în .gitignore, package.json, package-lock.json și e2e/ sunt păstrate.

Surse pentru interpretare: [modelul parolelor Auth v2.197.0](https://github.com/supabase/auth/blob/v2.197.0/internal/models/user.go), [hashing v2.197.0](https://github.com/supabase/auth/blob/v2.197.0/internal/crypto/password.go), [update user v2.197.0](https://github.com/supabase/auth/blob/v2.197.0/internal/api/user.go), [Send Email Hook](https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook), [sesiuni și JWT](https://supabase.com/docs/guides/auth/sessions).

Actualizarea GitHub cu dovezile a fost recitită și verificată exact: #105, #106, #107, #108 și descrierea PR #117. Head-ul PR este neschimbat, criteriile de recepție sunt nebifate. [Comentariul de trasabilitate](https://github.com/DominteEmanuelBeniamin/platforma-fonduri/issues/107#issuecomment-6035208852).

### Completare: credențialele native trebuie să fie inutilizabile

Hook-ul singur oprește livrarea, dar lasă Auth să genereze credențiale. A fost adăugată o probă pentru un adaptor DB care împiedică persistarea lor: câmpurile legacy recovery/confirmation rămân goale, iar tokenurile one-time de aceste tipuri nu sunt inserate.

Au fost generate credențiale native reale pentru recovery și magiclink; atât hashed_token, cât și codul email OTP au fost refuzate de verificarea Auth. Zero sesiuni native create; dovada opacă a aplicației a rămas validă. Cu hook-ul și adaptorul împreună, /recover și /otp au răspuns 200, au produs zero credențiale persistate și zero emailuri SMTP; loginul cu parolă a răspuns în continuare 200.

Prototipul limitează adaptorul la conturile fixture, folosind identitatea conexiunii DB native supabase_auth_admin. **În implementare, protecția trebuie să acopere toate conturile aplicației, independent de existența sau retenția unui flux privat.** Rolul DB, câmpurile legacy și tipurile one-time intră în preflight-ul de compatibilitate. Acest adaptor nu înlocuiește invalidarea la activare a credențialelor/sesiunilor legacy deja emise.
