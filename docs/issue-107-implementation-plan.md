# Issue #107 — plan de implementare
Data: 7 octombrie 2026. Baza: PR #117, 2471801629dbd444980f0f38b4493b6d89136a4e. Branch izolat: codex/issue-107-recovery.

## Contract și ordine
1. Păstrăm mecanismul demonstrat în phase 0: dovadă aleatorie a aplicației, stare privată și schimbare atomică în PostgreSQL. Nicio sesiune Supabase înainte de salvare.
2. Implementăm schema și RPC-urile cu aceeași blocare (105,1) ca lifecycle. Parola bcrypt, marcajul, consumul, revocarea sesiunilor și auditul efectiv fac parte dintr-un singur commit. Expirarea se verifică după obținerea blocărilor.
3. Implementăm API-ul public, predarea emailurilor și mesajele uniforme. Requestul public inserează aceeași operație în coada privată înainte de lookup; identificarea contului și Resend se execută după răspuns. Astfel timpul contului/Resend nu intră în răspunsul public.
4. Implementăm paginile publice forgot/reset și instalarea explicită a sesiunii după succes. O sesiune B existentă rămâne neatinsă până la recuperarea lui A.
5. Orchestratorul revizuiește și integrează codul, aplică SQL iterativ local, rulează verificările reale DB/Auth/API/browser și controlul local SQL/RLS/privilegii/indexuri, apoi generează migrarea stabilă prin CLI. Advisorii hosted se rulează în etapa separată de deploy.
6. Documentăm activarea și verificarea hosted; nu efectuăm deploy sau scrieri hosted în această cerere. Activarea pe un mediu incompatibil este refuzată.

## Schema minimă
Schema account_recovery nu este expusă prin Data API. Tabelele au RLS și zero acces anon/authenticated.
- flows: numai generația curentă per UUID; flow_id, SHA-256 al dovezii, email canonic, emitere/expirare, stare.
- receipts: rezultat finalizat, separat de generația curentă, legat de flow/hash/attempt. Retenție 24 ore. Retry produce numai confirmarea schimbării, fără sesiune sau o a doua parolă.
- deliveries: operații strict pentru recovery și confirmare. Cererea anonimă are emailul și tokenul cifrate AES-256-GCM cu o cheie server separată. Lease DB, retry cu aceeași operație și aceeași cheie Resend; eliminarea payloadului la terminare/expirare. Fără infrastructură generică de joburi.
- rate_limits: ferestre independente de existența contului, IP pseudonimizat și plafon global.
- settings: activare explicită după preflight de compatibilitate; adaptorul nativ și endpointurile refuză sigur până la activare.

Cooldown-ul de 15 minute folosește coloana existentă profiles.password_reset_requested_at. Nu duplicăm coloana. Cazurile de lipsă profil/email divergent/duplicate/Auth banned sunt omise sigur în worker.

## API și interfață
- POST /api/auth/recovery/request: email sintactic valid, JSON limitat, origine verificată, răspuns identic pentru toate stările contului; programare prin Next after.
- POST /api/auth/recovery/exchange: token numai în corp, verificare fără consum/sesiune, cookie HttpOnly SameSite Strict separat pentru fiecare flow.
- GET /api/auth/recovery/status: identificator și attempt nesensibile; cookie dovedește recovery. Un rezultat confirmat este reconstituit fără login.
- POST /api/auth/recovery/complete: două parole identice, minimum 6 caractere, maximum 72 bytes UTF-8, fără trim. UUID/email/rol din browser nu aleg ținta.
- GET/POST /api/auth/recovery/dispatch: acces exclusiv cu secretul cron; recuperează livrările după restart/timeout și curăță operațiile expirate.
- /forgot-password și /reset-password sunt publice, fără navbar, cache partajat sau referrer. Linkul folosește fragmentul; acesta este eliminat imediat. sessionStorage păstrează doar flow_id/attempt_id, niciodată parola sau secretul.
- Loginul după commit este urmat de requireProfile/current_account_session_active. Doar atunci se returnează access/refresh token. Eșecul ulterior păstrează parola nouă și afișează fallback-ul acceptat.
- AuthProvider elimină imediat profilul și abonamentele vechii identități la schimbarea sesiunii. Detectarea automată a sesiunilor din URL este dezactivată.

## Integrare lifecycle/email/admin
Dezactivarea invalidează fluxul în tranzacția profilului, inclusiv când sincronizarea ban-ului Auth eșuează. Reactivarea nu îl restaurează. Schimbarea efectivă a emailului în profil sau Auth și orice scriere de parolă Auth invalidează recovery. Scrierea repetată a marcajului temporar true invalidează și ea. Viitoarele #106/#108 folosesc invalidatorul și ordinea de blocare comună; interfețele lor complete nu intră în #107.
Trigger-ele de integrare sunt înguste și nu înlocuiesc mutațiile canonice din #106/#108. Tranzacțiile native care țin deja un rând Auth și concurează cu operațiile canonice pot fi abortate de PostgreSQL; nu raportăm acel abort ca succes.

Cererea proprie anonimă verificată (source=self_recovery) și finalizarea proprie exactă sunt activitate Auth neblocantă pentru ștergerea unui cont gol. Auditul rămâne istoric. Alte acțiuni și resetări administrative rămân blocante.

## Livrare și eșecuri
Payloadul și cheia de idempotency rămân stabile la rezultat necunoscut. Un refuz cert invalidează numai generația acelei livrări și eliberează numai cooldown-ul ei; nu restaurează linkul precedent. Un worker vechi verifică lease, generație și destinatar înainte de predare și nu poate publica drept curent un flux invalidat.
Confirmarea este înscrisă atomic după finalizare și predată după commit. Destinatarul activ/consistent se revalidează; eșecul sau omisiunea sunt înregistrate fără anularea parolei.
Cronul este obligatoriu pentru recuperarea livrărilor după restart; Next after asigură predarea imediată, coada DB asigură durabilitatea. Retry-ul unui link nu creează o sesiune nouă.

## Securitate și activare
- Send Email Hook oprește emailurile native care pot produce proofuri alternative; adaptorul DB împiedică persistarea credențialelor native pentru toate conturile, indiferent de retenția flows.
- Preflight verifică versiunea Auth demonstrată, schema, pgcrypto, rolul DB nativ atestat, bcrypt necriptat $2a$ cost 05–10 și politica minim 6/fără reguli suplimentare. După activare, Auth updateUser/Admin HTTP nu pot schimba parola; #108 folosește tranzacția DB canonică.
- Activarea invalidează toate credențialele native legacy și sesiunile deja emise. Aceasta deconectează sesiunile existente; este o măsură explicită de rollout, fără schimbarea parolelor.
- Signup public și providerii alternativi nefolosiți sunt dezactivați. Conturile continuă să fie create prin API admin.
- NEXT_PUBLIC_APP_URL este explicit și HTTPS în preview/producție; nu folosim Host sau redirectTo primit de la solicitant.
- RECOVERY_SECRET este o cheie aleatorie de 32 bytes, server-only. CRON_SECRET protejează dispatch. REMINDER_EMAIL_OVERRIDE_TO păstrează regulile existente. Proiectul preview este separat de producție.
- Tracking-ul de linkuri Resend trebuie oprit în configurația expeditorului înainte de activare. Nu se înregistrează corpuri API sensibile sau emailuri în logger/test trace.
- Limita URL-urilor Storage deja semnate rămâne cea acceptată în #105.

## Împărțirea lucrului
Subagenți gpt-6-luna, reasoning xhigh; scriu codul în același worktree, pe fișiere distincte:
1. DB: candidat SQL schema/RPC/adaptor/hook/lifecycle/blocker; fără aplicare SQL, teste sau validare.
2. Server: helper recovery, endpointuri, email/dispatch, audit catalog/redactare; fără teste sau validare.
3. UI: pagini, AuthProvider/client/AppShell și headers Next; fără teste sau validare.
Orchestrator: acest plan și contractele, preflight, migrarea CLI, teste independente, review și corecții, integrare și raport.

## Verificări obligatorii ale orchestratorului
- Lint, TypeScript, node:test, build și audit:check.
- Integrare reală pe Auth v2.197.0/Postgres: limite 15/60 minute, request/completion concurente, audit fault rollback, parola exactă cu Unicode/spații, receipt după rotație, invalidare lifecycle/email/admin/ștergere.
- Native generateLink + verifyOtp recovery/magiclink și endpointuri publice: nicio credențială/sesiune înainte de salvare; loginul cu parolă funcționează.
- API: JSON/origin/body/target injection, lipsă cookie, erori temporare, no-store/no-referrer, status și distribuția latenței pe existente/inexistente/inactive/cooldown.
- Livrare simulată local: reject cert, timeout cu acceptare, retry aceeași payload/idempotency, worker vechi și confirmare omisă după dezactivare. Zero emailuri reale.
- Browser: link alt dispozitiv, GET/scanner, refresh/back/tab, B→A, invalid link cu B păstrat, expirare formular, fallback login, accesibilitate/tastatură și mobil.
- Regresie #105 pe API/REST/RPC/Storage/Realtime și cont gol cu numai activitate Auth.
Matricea R01–R35 și cele 11 cazuri lifecycle din issue sunt mapate în raportul final. Cazurile dependente de hosted se marchează ca preflight de deploy, fără a pretinde validare remote.
