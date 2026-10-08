# Issue #107 — implementare și validare

7 octombrie 2026. Implementarea este gata pentru review pe `codex/issue-107-recovery`, peste PR #117 (`2471801629dbd444980f0f38b4493b6d89136a4e`). Planul este în [issue-107-implementation-plan.md](issue-107-implementation-plan.md), iar activarea în [issue-107-rollout.md](issue-107-rollout.md).

Codul a fost scris de trei subagenți **gpt-6-luna, xhigh**. Orchestratorul a făcut review-ul și a scris/rulat verificările independent. Subagenții nu au rulat validări. Nu există dependențe noi, migrare generală la SSR sau implementare a interfețelor #106/#108.

## Rezultatul

Linkul aplicației acordă numai dreptul de alegere a parolei. Finalizarea schimbă atomic parola, marcajul temporar, consumul dovezii, revocarea tuturor sesiunilor, auditul obligatoriu și înscrierea confirmării în coadă. Loginul normal este făcut după commit și sesiunea este returnată numai după verificarea proaspătă a profilului și a accesului.

Dezactivarea, schimbarea efectivă a emailului și resetarea administrativă invalidează permanent generația anterioară. Reactivarea și revenirea la emailul vechi nu o restaurează. Linkurile greșite, expirate, folosite sau invalidate afișează același mesaj:

> Linkul de resetare nu mai este valid. Solicită un link nou sau contactează administratorul.

Un rezultat deja finalizat poate fi recuperat timp de 24 ore, numai cu aceeași dovadă și încercare. Receipt-ul confirmă rezultatul fără a schimba din nou parola sau a emite o altă sesiune. Eșecul loginului/instalării după commit păstrează parola nouă și oferă autentificarea manuală, inclusiv când B era deja conectat.

## Dovezi independente — rularea inițială din 7 octombrie 2026

| Verificare | Rezultat |
| --- | --- |
| Integrare DB/Auth/API/browser | 20 grupuri trecute + 1 înregistrare cu măsurătorile R31; 21/21 în raport |
| Matrice R01–R35 | Toate cele 35 ID-uri au dovezi locale trecute |
| Regresii reale #105 | 9/9 teste API, REST, RPC, Storage, Realtime, lifecycle, ștergere și UI |
| Teste unitare | 269/269 |
| ESLint | 0 erori; 3 avertismente preexistente |
| TypeScript | Trecut, inclusiv în build |
| Build Next.js 16.3.5 | Trecut în mod production |
| Headere pe server production | Forgot/reset: HTTP 200 fără Auth, Cache-Control no-store, Referrer-Policy no-referrer |
| audit:check | Trecut; acțiuni renderabile și audit append-only |
| Lint SQL local | 0 erori; hook-ul ignoră intenționat parametrul event; restul avertismentelor provin din funcții existente |
| Securitate/performance locală | RLS FORCE, schema privată inaccesibilă, RPC-uri service-only, hook auth-only, FK-uri indexate |
| Migrație nouă | Instalare de la zero și activare probate în tranzacție cu rollback; un singur rând settings inițial dezactivat, toate parolele păstrate |

[Raportul JSON fără secrete](issue-107-implementation-results.json) conține acum rerularea completă după review, descrisă la final; rezultatele sunt generate de [verificarea executabilă](../scripts/issue-107-check.mjs). Grupele DB/Auth/API/browser au folosit serverul dev separat pe 3107. Headerele no-store/no-referrer au fost verificate pe build-ul production pe 3117; Next dev suprascrie Cache-Control cu no-cache, must-revalidate. Regresiile #105 au fost rerulate după corecția adaptorului nativ.

R31 folosește opt probe pentru fiecare stare, în ordine rotită, cu furnizorul simulat întârziat 1,8 secunde. Medianele active/inexistente/inactive/cooldown au fost **15/14/15/15 ms**. Statusul, corpul și headerele sunt identice. Acestea sunt măsurători locale; distribuția și headerele CDN se verifică din nou în preview înainte de activarea hosted.

## Trasabilitatea R01–R35

| Cazuri | Dovezi din verificarea executabilă |
| --- | --- |
| R01, R05, R06, R14, R16, R22 | roles_cooldown_latest_and_invalid_passwords: client, junior, senior și admin; 15:00; 6 caractere Unicode; exact 72 bytes; spații; marcaj; refuz fără consum |
| R02, R03, R04 | private_state_and_http_boundaries, lookup_coherence_and_audit_auth_classification, api_email_delivery_retry_uniformity_and_postcommit_fallback: normalizare, lookup exact, duplicate/divergență, profil absent, ban Auth, JSON/limite/origine |
| R07, R18, R19, R20, R21, R23 | lifecycle_email_admin_invalidation_permanent: link/formular vechi, email A→B→A, reset admin, marcaj repetat, ștergere și reutilizare email cu alt UUID |
| R08, R09, R11, R12, R13 | browser_public_refresh_identity_mobile, native_recovery_and_magiclink_have_no_credentials, public_page_headers: alt browser, GET fără consum, refresh, B→A, lipsă proof și link invalid cu sesiune păstrată |
| R10 | expiry_after_wait_and_atomic_audit_rollback, delivery_deadline_after_job_row_wait, anonymous_request_ttl_after_account_lock_wait: ceas proaspăt după blocări, fără prelungirea expirării |
| R15 | two_requests_and_two_completions_one_commit: o rezervare, o parolă și un audit sub concurență |
| R17 | lifecycle_auth_failure_and_concurrent_order și suita #105: JWT copiat, REST/RPC/Storage/Realtime conectat, reactivare fără revalidarea sesiunii vechi |
| R24, R35 | lease_fencing_frozen_bytes_and_stale_generation și probele email/deadline: payload identic la rezultat necunoscut, idempotency, worker vechi, lease expirat, refuz cert fără restaurarea vechiului link/cooldown |
| R25, R26 | fault-uri DB/audit/login/ban: eroare temporară controlată, rollback complet și răspuns corect după commit |
| R27, R28 | browser_lost_response_fallback_and_installation_race: răspuns pierdut, receipt după refresh, instalare refuzată, login manual A cu B conectat, 401 întârziat al lui B |
| R29 | confirmation_state_and_temporary_api_errors: confirmare omisă după dezactivare sau refuzată de furnizor, fără anularea parolei |
| R30 | native_recovery_and_magiclink_have_no_credentials, native_pkce_legacy_and_inflight_credentials, private_state_and_http_boundaries, fresh_migration_disabled_activation_and_rollback: recovery/magiclink/email-change, OTP și coduri PKCE legacy inutilizabile; țintă din body refuzată; scriere nativă de parolă blocată |
| R31 | uniform_latency_and_atomic_volume_limits: răspuns uniform, IP 10/min atomic și global 1000/oră, independent de cont |
| R32 | lookup_coherence_and_audit_auth_classification și #105: autor anonim vs actor dovedit, excepție exactă self_recovery, lipsa source rămâne blocantă, audit păstrat după ștergere |
| R33, R34 | preflight real pozitiv/negativ, public_page_headers, browser și testul de redactare: origine/override, cheie, rol DB, tracking atestat, niciun secret în rezultate/trace; tastatură, mobil și autofill |

## Cele 11 cazuri de dezactivare

| Caz acceptat | Dovadă/rezultat |
| --- | --- |
| Deja inactiv când cere forgot | R02: răspuns generic, fără email eligibil |
| Dezactivat înainte de predarea emailului | R35: revalidare în delivery_ready; generația invalidată nu poate fi predată ca validă |
| Email deja acceptat, apoi dezactivat | R07/R35: linkul este invalid; un email deja acceptat nu poate fi retras |
| Formular deschis, apoi dezactivat | R07: salvare refuzată, parola și marcajul păstrate |
| Salvare și dezactivare concurente | R26/R28: ambele ordini; verificare suplimentară când dezactivarea intervine în emiterea sesiunii după commit |
| Finalizare urmată de dezactivare | R17 + #105: revocare și refuzul operațiilor noi |
| Ban-ul Auth eșuează | R26: profilul inactiv și auth_sync_pending blochează accesul și recovery |
| Reactivare înaintea expirării linkului | R07: vechiul link rămâne invalid |
| Reactivare și forgot nou | R21/R35: cooldown-ul vechi este eliberat, numai generația nouă este validă |
| Mai multe cicluri activ/inactiv | lookup_coherence_and_audit_auth_classification: două cicluri probate, fără restaurarea linkului |
| Alt ban Auth, profil activ | Aceeași probă: cererea nouă și salvarea sunt refuzate, fără mutații ale contului |

## Compatibilitate și integrarea #108

Adaptorul este demonstrat pentru **Auth v2.197.0**, SDK **2.90.0**, PostgreSQL **17.6** și hashuri necriptate bcrypt **$2a$ cu cost 05–10**. Parolele noi folosesc $2a$10$. Au fost probate loginul și refuzul aceleiași parole pentru costul 6 existent. Hashurile cu cost 4/peste 10 ar declanșa rehash-ul nativ, iar pgcrypto nu verifică prefixele 2b/2y; preflight-ul le refuză fără a modifica parolele. Eligibilitatea refuză și un format nesuportat apărut după activare.

După activare, schimbarea parolei prin Auth updateUser sau Admin HTTP este blocată. #108 trebuie să folosească tranzacția DB canonică, cu aceeași blocare (105,1), invalidare, marcaj, revocare și audit obligatoriu. Probe locale au validat integrarea, nu interfața completă #108. Crearea admin a unui cont confirmat și loginul normal prin parolă funcționează.

Activarea elimină toate credențialele native legacy, inclusiv auth.flow_state, și toate sesiunile existente, fără schimbarea parolelor. Necesită preflight explicit și fereastră de rollout anunțată. Rolul conexiunii native trebuie atestat efectiv ca supabase_auth_admin; simpla existență a rolului nu ajunge.

Codurile PKCE native sunt păstrate separat în auth.flow_state și pot emite o sesiune prin [schimbul PKCE din Auth v2.197.0](https://github.com/supabase/auth/blob/v2.197.0/internal/api/token.go#L198). Verificarea native_pkce_legacy_and_inflight_credentials are controale pozitive reale: aceleași coduri recovery/magiclink emit JWT când adaptorul este dezactivat și sunt refuzate după activare, fără sesiune sau modificarea parolei. Adaptorul blochează persistarea flow_state și prima metodă de autentificare diferită de password; MFA suplimentar rămâne permis după autentificarea cu parolă. Nu permite înlocuirea claim-ului password cu OTP.

Activarea prin RPC service-role a fost probată inclusiv în timp ce o cerere nativă citise deja codul vechi și aștepta crearea sesiunii: după activare, emiterea eșuează și sesiunea se anulează. Revocarea globală are WHERE explicit pentru protecția safeupdate a Data API. Finalizarea recovery șterge flow_state legat atât prin user_id, cât și prin linking_target_id; fault-ul auditului restaurează și aceste coduri în rollback.

## Limite de recepție și starea mediilor

- **Nicio scriere sau activare hosted.** Compatibilitatea remote, advisorii Supabase, configurația reală Auth/Resend, scheduler-ul și comportamentul CDN rămân verificări de deploy documentate în rollout.
- Dispatch-ul durabil la minut este obligatoriu și se configurează prin Supabase Cron pentru proiectele Vercel Hobby existente. vercel.json păstrează cronul zilnic; preflight-ul cere atestarea explicită RECOVERY_DISPATCH_EVERY_MINUTE_CONFIGURED=true după verificarea programării reale. Scheduler-ul hosted rămâne un pas de deploy documentat. Tracking-ul domeniului Resend trebuie dezactivat.
- Testele de livrare folosesc exclusiv furnizorul HTTP simulat și adrese example.invalid. Acceptarea furnizorului nu dovedește ajungerea în inbox; la bounce nu există fallback cu parolă, iar linkul/cooldown-ul respectă expirarea normală. Nu s-au trimis emailuri reale.
- URL-urile Storage deja semnate păstrează limita TTL acceptată în #105.
- La încheierea validării inițiale din 7 octombrie, recovery local era din nou **enabled=false**, schema fixture și conturile issue107.impl sunt eliminate, iar containerele Auth și serverele de probă au fost oprite. Migrația este în istoricul local. Auditul istoric este păstrat.
- Serverul utilizatorului de pe 3000 și serviciul Auth principal nu au fost restartate; configurația Auth runtime principală necesită aplicarea setărilor noi înainte de activare. Modificările utilizatorului din checkout-ul D: sunt păstrate.

## Reproducere locală

Folosește un checkout și un Supabase Docker dedicate testelor, cu configurația Auth din [rollout](issue-107-rollout.md). Instalează versiunile din lockfile și browserul, apoi aplică inclusiv migrația de corecție:

```powershell
npm ci
npx playwright install chromium
npx supabase start
npx supabase migration up --local
```

În fișierul ignorat `.env.issue107.local` configurează valorile stack-ului local:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key local>
SUPABASE_SERVICE_ROLE_KEY=<service role key local>
NEXT_PUBLIC_APP_URL=http://127.0.0.1:6107
RECOVERY_SECRET=<32 bytes aleatorii, base64 canonic>
CRON_SECRET=<secret local separat>
RESEND_API_KEY=re_test_local_issue107
RESEND_BASE_URL=http://127.0.0.1:4017
RESEND_FROM_EMAIL=onboarding@resend.dev
REMINDER_EMAIL_OVERRIDE_TO=recovery-test@example.invalid
RESEND_LINK_TRACKING_DISABLED=true
RECOVERY_DISPATCH_EVERY_MINUTE_CONFIGURED=true
```

În checkout-ul de test, copiază aceleași valori în `.env.local`, încărcat automat de Next. Generează separat cheia recovery și secretul cron; păstrează-le numai în fișierele ignorate. În harness, atestarea dispatch este controlată pentru testarea gate-ului; nu creează și nu validează scheduler-ul hosted.

Fișierul ignorat `.env.e2e.localdb` declară explicit `E2E_BASE_URL=http://127.0.0.1:6107`, `E2E_SUPABASE_URL`, `E2E_SUPABASE_ANON_KEY`, `E2E_SUPABASE_SERVICE_ROLE_KEY`, `E2E_WRITES=1`, `E2E_TEST_PROJECT=1`, precum și perechile email/parolă `E2E_STAFF_*` (admin activ), `E2E_CLIENT_*` și `E2E_CLIENT2_*` (doi clienți activi). Folosește conturi fixture `test.local` sau `example.invalid` și verifică autentificarea fiecăruia. Pe o bază nouă, `npm run seed:local` pregătește conturile demo cu aplicația pornită și `SEED_APP_URL=http://127.0.0.1:6107`; rerularea seed-ului păstrează parolele conturilor existente.

Pornește aplicația de test și build-ul production în terminale separate:

```powershell
npm run dev -- --hostname 127.0.0.1 --port 6107
npm run build
npm run start -- --hostname 127.0.0.1 --port 6109
```

După preflight și activarea explicită pe proiectul local, rulează harness-ul:

```powershell
$env:E2E_ENV_FILE='.env.e2e.localdb'
$env:ISSUE107_BASE_URL='http://127.0.0.1:6107'
$env:ISSUE107_PUBLIC_HEADERS_BASE_URL='http://127.0.0.1:6109'
$env:ISSUE107_AUTH_PORT='6108'
$env:ISSUE107_PREFLIGHT_PORT='6111'
node scripts/issue-107-check.mjs
```

Porturile 6107–6111 evită intervalele 3107–3117 rezervate pe Windows în mediul verificat. Override-urile Auth/preflight păstrează binding-ul pe loopback; implicit rămân 3108/3111. Verificarea refuză hosturi nelocale, pornește singură furnizorul simulat pe 4017 și clona Auth, apoi le elimină. Proba AMR folosește o conexiune DB cu rolul nativ `supabase_auth_admin`, prin parola din Dockerul local transmisă pe stdin; nu o afișează. Probele de activare revocă sesiunile locale. Filtrul `ISSUE107_CHECK_ONLY` permite rerularea unui grup; pentru headere folosește `public_page_headers` și serverul production. Probele phase0 sunt istorice și refuză recovery activ.

Pentru suitele E2E, după încheierea harness-ului, pornește separat furnizorul simulat și apoi testele:

```powershell
node tests/e2e/helpers/resend-mock.mjs 4017 playwright-report/resend-local.jsonl
```

```powershell
$env:E2E_ENV_FILE='.env.e2e.localdb'
$env:E2E_RESEND_LOG=(Join-Path (Get-Location) 'playwright-report/resend-local.jsonl')
npx playwright test tests/e2e/recovery-fixtures.spec.ts tests/e2e/conturi-lifecycle.spec.ts tests/e2e/drepturi.spec.ts tests/e2e/drepturi-interfata.spec.ts tests/e2e/regresii-senior.spec.ts tests/e2e/verificare-modificari.spec.ts tests/e2e/matricea-acces.spec.ts
```

Mock-ul și harness-ul folosesc același port 4017 și se rulează succesiv. Testele păstrează auditul append-only; fixture-urile cu referințe istorice pot rămâne inactive după curățare.

## Verificarea configurației locale — 8 octombrie 2026

La aplicarea configurației reale prin CLI 2.118.0, auth.email.enable_signup=false dezactiva și providerul email/parolă: un cont confirmat și activ primea email_provider_disabled la login. Configurația păstrează acum auth.enable_signup=false și auth.email.enable_signup=true. Preflight-ul cere explicit settings.external.email=true; regresia negativă este inclusă în harness-ul existent.

Orchestratorul a verificat separat loginul cu parolă, /api/me HTTP 200 și refuzul înscrierii publice cu signup_disabled. Proba preflight pozitivă/negativă acceptă providerul activ și refuză numai settingsEmailProviderEnabled când acesta este dezactivat; credentialele tuturor conturilor sunt păstrate. Sintaxa, ESLint pentru cele două scripturi și git diff --check au trecut. Aceste probe se adaugă validării din 7 octombrie; suita completă nu a fost rerulată pentru această corecție de configurație.
## Corecții după review #119

Migrația `20261008095956_preserve_recovery_proofs_after_retry_exhaustion.sql` păstrează proof-ul și cooldown-ul până la expirarea normală când rezultatul livrării rămâne necunoscut sau workerul pierde ultimul lease. După opt încercări se oprește livrarea și se elimină payloadul cifrat; numai refuzul cert invalidează generația curentă. Migrația este separată, pentru stack-urile care au instalat deja versiunea inițială.

Regresia SQL se rulează pe stack-ul local dedicat, după aplicarea ambelor migrări, cu `Get-Content scripts/issue-107-retry-check.sql -Raw | docker exec -i supabase_db_platforma-fonduri psql -U postgres -d postgres -X -v ON_ERROR_STOP=1`. Toate datele fixture și schimbările de setări sunt anulate prin rollback. Harness-ul `issue-107-check.mjs` include aceeași verificare și instalarea proaspătă a ambelor migrări.

Suitele de drepturi și regresii pregătesc acum parolele prin `setLocalFixturePassword`, într-o tranzacție pe containerul DB local. Helper-ul cere configurația E2E explicită, `E2E_WRITES=1`, `E2E_TEST_PROJECT=1`, URL Supabase loopback și cont fixture cu domeniul `test.local` sau `example.invalid`. Nu citește parola conexiunii Auth. `npx playwright test tests/e2e/recovery-fixtures.spec.ts` verifică reutilizarea contului, parola temporară, revocarea sesiunii vechi și păstrarea blocării native, folosind același `E2E_ENV_FILE` dedicat.

Validarea de după review a aplicat persistent migrația nouă numai în stack-ul local. Testele UI au fost aliniate cu parola temporară generată automat și denumirile actuale ale dialogului de ștergere; importul unei atribuiri neeligibile verifică acum HTTP 409 `INACTIVE_ASSIGNMENT`, păstrând verificarea că refuzul nu importă faze și nu schimbă echipa.

## Verificare locală după review — 8 octombrie 2026

Rulare într-o copie izolată a PR-ului, cu `npm ci` din lockfile: Next.js 16.3.5, Playwright 1.62.1/Chromium și Supabase SDK 2.90.0; Auth Docker v2.197.0 și PostgreSQL 17.6. Server dev pe 6107, build production pe 6109, emailuri exclusiv simulate pe 4017.

| Verificare | Rezultat |
| --- | --- |
| Integrare DB/Auth/API/browser după review | 22/22 rezultate; toate cazurile R01–R35 și cele 11 cazuri lifecycle |
| Teste unitare | 270/270 |
| Cinci suite E2E modificate + fixture recovery + lifecycle | 103/103 teste unice trecute; ultimele rulări ale fiecărei suite, inclusiv 37/37 după corectarea așteptărilor vechi |
| Matrice API de drepturi | 278/278 verificări |
| Matrice UI de drepturi | 161/161 verificări; 6 observații preexistente de interfață |
| Verificarea modificărilor | 65/65 verificări, inclusiv emailurile simulate |
| Migrație nouă | Aplicată local prin `supabase migration up --local`; RPC preflight `compatible=true`, `enabled=true`, aceeași activare ca la început |
| TypeScript și build production | Trecute cu dependențele exacte din lockfile |
| ESLint | 0 erori; cele 3 avertismente preexistente |
| audit:check | Contractul read-only valid, fără tipuri de audit necunoscute |
| SQL lint account_recovery | 0 erori; un avertisment intenționat pentru parametrul nefolosit `event` din hook |
| Advisorii de securitate Studio local | 0 erori; 22 avertismente pe obiecte existente din public; 0 avertismente pe account_recovery |
| Headere production | Forgot/reset: HTTP 200, `no-store`, `no-referrer` |

Cele 22 avertismente de securitate provin din funcții existente cu search_path mutable (11), extensia pg_net din public (1) și funcții SECURITY DEFINER existente apelabile de authenticated (10); niciuna dintre aceste funcții nu este introdusă sau modificată de #119. Cele patru notificări INFO account_recovery despre RLS fără policy descriu interdicția intenționată de acces direct; privilegiile și RLS FORCE au fost probate în grupa de instalare proaspătă.

Cinci grupe din harness au fost rerulate separat și au trecut:

- `fresh_migration_disabled_activation_and_rollback`: instalarea ambelor migrări de la zero, privilegiile/RLS, activarea și păstrarea parolelor, cu rollback.
- `retry_exhaustion_preserves_possibly_delivered_proof`: retry 8, pierderea ultimului lease, generație veche, refuz cert și expirare normală.
- `lease_fencing_frozen_bytes_and_stale_generation`: fencing, bytes înghețați și generații vechi.
- `api_email_delivery_retry_uniformity_and_postcommit_fallback`: livrare simulată, rezultat necunoscut/retry și recuperare după commit.
- `public_page_headers`: headere pe build production.

Harness-ul complet a fost rerulat după aprobarea explicită a probei locale `supabase_auth_admin`: **22/22 rezultate trecute** (21 grupe și o înregistrare R31), cu acoperire R01–R35 și toate cele 11 cazuri lifecycle. Proba AMR folosește parola Docker locală exclusiv prin stdin, fără afișarea ei sau acces hosted. Raportul JSON principal conține această rerulare completă din 8 octombrie. Medianele R31 active/inexistente/inactive/cooldown au fost **15/15/14/14 ms**, cu opt probe per stare.

Matricea de acces păstrează două abateri deja marcate drept cunoscute: citirea publică a unui status individual și retrogradarea propriului rol de admin când există alt administrator activ. Nu au apărut abateri noi; protecția ultimului administrator a trecut în suita lifecycle.

După teste: schema și trigger-ele `issue107_check` sunt eliminate, nu există fixture-uri recovery active sau clonă Auth de test, iar cei doi clienți creați pentru validare au fost curățați prin API-ul canonic (unul șters, unul dezactivat pentru păstrarea auditului). Loginul adminului și `/api/me` HTTP 200 au fost verificate. Recovery local rămâne activ și compatibil. Checkout-ul principal și serverul existent pe 3000 au fost păstrate. Nu s-au făcut scrieri hosted.
