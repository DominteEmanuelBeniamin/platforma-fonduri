# #108 — Implementare și acceptare locală

Implementat în worktree-ul separat cerut de utilizator, pe ramura `codex/issue-108-admin-password-reset`, pornită din `main` la `92f2f60`. Issue-ul #108 a fost actualizat cu regulile acceptate la 19 octombrie 2026. A doua amplasare acceptată este pagina existentă a utilizatorului; panoul #106 rămâne în afara implementării.

## Comportament livrat

- Aceeași acțiune și același dialog în lista de utilizatori și în `/admin/users/[id]`. Confirmarea folosește identitatea și emailul salvate. Contul propriu/inactiv și actorii fără drepturi nu primesc acțiunea.
- Parolă generată prin helperul existent #103, email welcome/reset compus în același helper. Nicio dependență nouă.
- Tranzacție DB canonică: parola bcrypt `$2a$10$`, marcaj temporar, invalidarea recovery/cooldown, credențialele native, toate sesiunile, receipt și audit obligatoriu. Refuz sigur pentru ținte/actori deveniți neeligibili.
- Receipt privat fără parolă, legat de actor/țintă/încercare. Retry-ul confirmă rezultatul fără încă o resetare, livrare sau parolă dezvăluită. Un rezultat pierdut nu se transformă într-un istoric de parole.
- Livrare bounded după commit: sent/failed/unknown/skipped. Numai eșecul cert/configurația imposibilă pot permite fallback în răspunsul inițial, după claim unic și revalidare. Un rezultat necunoscut nu declanșează automat altă resetare/livrare.
- Schimbarea emailului/parolei, recovery și ciclurile lifecycle invalidează livrarea/fallback-ul depășite. Predarea deja începută își păstrează rezultatul real.
- Auditul livrării este separat. Eșecul lui păstrează rezultatul cu marcaj de reparare; verificarea aceleiași încercări poate repara auditul fără email sau schimbare de parolă.
- Dialogul elimină parola la închidere/refresh/pierderea drepturilor. Răspunsul întârziat nu poate repopula un dialog închis sau redeschis.

## Responsabilitatea validării

Trei subagenți **gpt-6-luna, xhigh** au implementat DB, server și UI în fișiere distincte. Nu au rulat teste și nu și-au făcut review. Orchestratorul a citit schimbările, a trimis corecții concrete și a scris/rulat independent probele. Acceptarea se bazează pe codul final și verificările de mai jos.

## Rezultate

| Verificare | Rezultat |
| --- | --- |
| Matrice completă DB/Auth/API/browser | **14/14 grupe trecute** |
| Configurație email imposibilă, pe build production | **1/1 grupă trecută** |
| Teste unitare existente | **325/325 trecute** |
| TypeScript | Trecut |
| Build production Next.js | Trecut |
| ESLint | 0 erori, 3 avertismente preexistente |
| SQL lint account_recovery | 0 erori; numai parametrul event nefolosit din hook-ul #107 preexistent |
| Advisori securitate locali | 0 erori; 11 avertismente search_path pe funcții public existente; niciunul pe obiectele #108 |
| audit:check | Contract read-only valid, fără tipuri necunoscute |
| Preflight #107 read-only după teste | already_enabled, toate verificările trecute |
| git diff --check | Trecut |
| Curățare fixture-uri | 0 conturi #108 active rămase; 0 triggere temporare de fault |

Matricea și rezultatele redactate sunt în [issue-108-implementation-results.json](issue-108-implementation-results.json). Scriptul reproductibil este `scripts/issue-108-check.mjs`.

Cele 14 grupe verifică: privilegii și corpuri HTTP; roluri/parole/sesiuni/email/audit; fallback și concurență; timeout/5xx/ID absent; eligibilitate și sesiunea autorului; generații depășite; recovery vechi/nou; rollback și repararea auditului; ambele ordini cu dezactivarea; ștergerea și păstrarea auditului; Storage și abonament Realtime deja deschis; regresia welcome/escaping/metadata; expirarea/retrogradarea actorului și rezultat după predare; browser desktop/tactil, răspuns pierdut, răspuns întârziat, închidere și refresh.

## Reproducere locală

Necesită baseline-ul existent, stack-ul local `supabase_db_platforma-fonduri`, Docker și configurația dedicată E2E. Nu crea un baseline improvizat și nu indica un proiect hosted.

1. `npm ci` din lockfile și `supabase migration up --local` după verificarea listei migrărilor.
2. Configurează `.env.local` numai cu proiectul Supabase local și setările #107 existente. Pentru probe: `NEXT_PUBLIC_APP_URL=http://127.0.0.1:6260`, `RESEND_BASE_URL=http://127.0.0.1:6261`, `RESEND_API_KEY=re_test_issue108`, `REMINDER_EMAIL_OVERRIDE_TO=issue108@example.invalid`.
3. Configurează `.env.e2e.localdb` explicit: `E2E_BASE_URL=http://127.0.0.1:6260`, URL/anon/service pentru același Supabase loopback, `E2E_WRITES=1`, `E2E_TEST_PROJECT=1` și un admin activ `E2E_STAFF_EMAIL` pentru curățare. Cheile/parolele rămân în fișiere ignorate.
4. Pornește în alt terminal: `node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 6260`.
5. Rulează `node scripts/issue-108-check.mjs`. Scriptul pornește singur mock-ul 6261; nu porni alt mock pe același port. Emailurile rămân numai în memoria procesului. Nu există trace sau screenshot care să captureze fallback-ul.
6. Pentru un grup folosește `ISSUE108_CHECK_ONLY` cu numele din raport. Nu rula două harness-uri pe același port mock.
7. Proba de configurație production: după build, pornește `next start` pe 6269 cu `RESEND_API_KEY` gol; rulează harness-ul cu `ISSUE108_BASE_URL=http://127.0.0.1:6269`, `ISSUE108_CONFIG_PROBE=1`, `ISSUE108_CHECK_ONLY=missing_configuration_fallback`. Configurația HTTP locală nu este un rollout production valid; proba verifică tocmai fallback-ul controlat.

Scriptul creează doar fixture-uri cu prefixul issue108 și curăță fișierul Storage, notificările și proiectul propriu. Conturile fără referințe sunt șterse prin mutația canonică; autorii cu audit administrativ rămân inactivi, păstrând istoricul. Trigger-ele de fault sunt tranzacționale și se anulează. Nu schimbă activarea recovery, nu revocă global sesiuni și nu restartează stack-ul partajat.

## Testare manuală cu Resend

Pentru testarea manuală, worktree-ul a fost configurat ulterior să folosească Resend direct, cu setările existente ale proiectului. Configurația și cheia rămân în fișierul ignorat .env.local și nu sunt incluse în commit. Simulatorul rămâne necesar numai pentru matricea automată descrisă mai sus. Livrarea reală nu este încă validată în raportul automat.

O resetare cu livrare necunoscută schimbă parola, dar nu afișează secretul. După remedierea configurației este necesară o resetare nouă, confirmată; verificarea aceleiași încercări nu retrimite emailul și nu recuperează parola.

## Limite verificate

Validarea este locală: Auth v2.197.0, PostgreSQL 17.6.1, SDK 2.90.0, Node 22.13.1 și Next.js 16.3.5 din lockfile. Migrarea #108 a fost aplicată numai local. Checkout-ul principal și serverul altui chat au rămas separate.

Gărzile #105 sunt reutilizate. Acestea permit intenționat citirea profilului propriu după revocare, pentru tratarea deconectării; proba Data API verifică refuzul accesului la alt profil. API-ul autentificat, RPC-ul, Storage și evenimentele Realtime noi sunt refuzate cu sesiunea veche. URL-urile semnate deja emise și datele deja descărcate păstrează limitele #105.

Nu s-a făcut deploy/activare hosted și nu s-a trimis email real. Preflight-ul, compatibilitatea și livrarea reală se verifică separat pe mediul de rollout. Interfața de editare #106 nu este inclusă.

**Review final al orchestratorului: acceptat pentru codul și verificările locale de mai sus.**
